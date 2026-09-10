#!/usr/bin/env node
// tools/quality/check-product-onboarding-canonical.mjs
//
// ADR-0033 — Product onboarding canonical checklist.
//
// For every productCode listed in `CANONICAL_PROGRAMS`
// (`backend/modules/policy/app/binders/canonicalProgramBinderSeed.ts`),
// assert that all nine canonical onboarding slots are filled. Fails
// closed with a per-product, per-slot diagnostic so a new-product PR
// (PET, MARINE, …) cannot merge with any spine slot empty.
//
// The guard reads the codebase as files (no TypeScript compilation,
// no runtime import) so it stays fast and survives `tsc` failures
// elsewhere. Each slot has a single inspection function that returns
// `{ ok, evidence?, hint }`. The caller aggregates and prints.
//
// Slot list (mirrors ADR-0033 §"Decision"):
//   1. ProductManifest in `packages/products/src/<lc>/manifest.ts` + index export
//   2. ValidationProfile in `packages/products/src/<lc>/profile.ts` + index export
//   3. Backend ProductRuntimeDefinition in `backend/products/<lc>/runtime.ts` +
//      registered in `backend/products/registerProducts.ts`
//   4. Doc-pack worker `backend/workers/handlers/DOC.GENERATE_<UC>_DOC_PACK.ts` +
//      imported in `backend/workers/registerBuiltInHandlers.ts`
//   5. Frontend `register.ts` imported transitively from `frontend/src/products/index.ts`
//   6. Pricing data + document templates COPY-staged in BOTH Dockerfile.api
//      and Dockerfile.worker production stages, with `RUN test -f` tripwires
//   7. `product_definitions` SQL migration (any `prisma/migrations/*.sql`)
//   8. Production binder/program migration OR allowlist exemption
//      (defaults to allowlist; HEALTH covered by `prisma/migrations/2026...
//      _seed_health_product_and_binder_overlay/migration.sql`)
//   9. Jurisdiction `CONFIGS` row in `backend/modules/jurisdiction/domain/productConfiguration.ts`

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isProductRuntimeAsset,
  missingDockerAssetTripwires,
} from './product-onboarding-docker-assets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function read(rel) {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(REPO_ROOT, rel));
}

function listFiles(rel) {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs);
}

function listFilesRecursive(rel) {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  const found = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) found.push(...listFilesRecursive(child));
    else if (entry.isFile()) found.push(child);
  }
  return found;
}

function readJson(rel, fallback) {
  const text = read(rel);
  if (!text) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

// ── Discover canonical product codes from the seed module ────────────
function discoverCanonicalProducts() {
  const seed = read('backend/modules/policy/app/binders/canonicalProgramBinderSeed.ts');
  if (!seed) return [];
  // The seed declares `CANONICAL_PROGRAMS: Record<CanonicalProductCode, ...>`;
  // we extract every `<UC>: { ... productCode: '<UC>' ... }` bucket key.
  const re = /^\s+([A-Z][A-Z0-9_]*):\s*\{[\s\S]*?productCode:\s*'([A-Z][A-Z0-9_]*)'/gm;
  const seen = new Set();
  let match;
  while ((match = re.exec(seed)) !== null) {
    if (match[1] === match[2]) seen.add(match[1]);
  }
  return Array.from(seen).sort();
}

// ── Slot inspectors ──────────────────────────────────────────────────

function slot1_manifest(productLc) {
  const manifestPath = `packages/products/src/${productLc}/manifest.ts`;
  if (!exists(manifestPath)) {
    return { ok: false, hint: `missing ${manifestPath} — every product needs a ProductManifest (ADR-0032 §3 reference)` };
  }
  const indexExport = read('packages/products/src/index.ts') || '';
  if (!new RegExp(`from\\s+'\\./${productLc}/manifest`).test(indexExport)) {
    return { ok: false, hint: `${productLc} manifest exists but is not exported from packages/products/src/index.ts — frontend cannot consume it` };
  }
  return { ok: true, evidence: manifestPath };
}

function slot2_profile(productLc) {
  const profilePath = `packages/products/src/${productLc}/profile.ts`;
  if (!exists(profilePath)) {
    return { ok: false, hint: `missing ${profilePath} — wizard step validation has no source of truth without a ValidationProfile` };
  }
  const indexExport = read('packages/products/src/index.ts') || '';
  if (!new RegExp(`from\\s+'\\./${productLc}/profile`).test(indexExport)) {
    return { ok: false, hint: `${productLc} profile exists but is not exported from packages/products/src/index.ts` };
  }
  return { ok: true, evidence: profilePath };
}

function slot3_runtime(productLc) {
  const runtimePath = `backend/products/${productLc}/runtime.ts`;
  if (!exists(runtimePath)) {
    return { ok: false, hint: `missing ${runtimePath} — backend ProductRuntimeDefinition required (ADR-0011 + ADR-0032 §3)` };
  }
  // Registration can land in either `registerProducts.ts` (validation
  // profile registration) OR `catalog.ts` (adapter list — the canonical
  // path since the catalog refactor). Check both. The product is
  // counted as registered if EITHER (a) `registerProducts.ts` mentions
  // its validation profile by name OR (b) `catalog.ts` imports its
  // adapter.
  const profileToken = `${productLc}ValidationProfile`;
  const adapterToken = `${productLc[0].toUpperCase()}${productLc.slice(1)}ProductAdapter`;
  const register = read('backend/products/registerProducts.ts') || '';
  const catalog = read('backend/products/catalog.ts') || '';
  const inRegister = register.includes(profileToken) || register.includes(`${productLc}/`);
  const inCatalog = catalog.includes(adapterToken) || catalog.includes(`${productLc}/`);
  if (!inRegister && !inCatalog) {
    return {
      ok: false,
      hint: `${productLc} runtime exists but neither registerProducts.ts nor catalog.ts wires it — adapter never registered, validation profile never published`,
    };
  }
  return { ok: true, evidence: `${runtimePath} (registered)` };
}

function slot4_docPackWorker(productUc) {
  const handlerPath = `backend/workers/handlers/DOC.GENERATE_${productUc}_DOC_PACK.ts`;
  if (!exists(handlerPath)) {
    return { ok: false, hint: `missing ${handlerPath} — every product needs a doc-pack worker (canonical issuance spine, ADR-0013)` };
  }
  const register = read('backend/workers/registerBuiltInHandlers.ts') || '';
  if (!new RegExp(`DOC\\.GENERATE_${productUc}_DOC_PACK`).test(register)) {
    return { ok: false, hint: `${handlerPath} exists but is not imported in backend/workers/registerBuiltInHandlers.ts — handler will never register at boot` };
  }
  return { ok: true, evidence: handlerPath };
}

function slot5_frontendRegister(productLc) {
  const registerPath = `frontend/src/products/${productLc}/register.ts`;
  if (!exists(registerPath)) {
    return { ok: false, hint: `missing ${registerPath} — frontend ProductRegistry will not see the product at boot` };
  }
  const productsIndex = read('frontend/src/products/index.ts') || '';
  if (!new RegExp(`${productLc}/register`).test(productsIndex)
      && !new RegExp(`${productLc}\\b`).test(productsIndex)) {
    return { ok: false, hint: `${registerPath} exists but is not imported transitively from frontend/src/products/index.ts` };
  }
  return { ok: true, evidence: registerPath };
}

function slot6_dockerCopy(productLc) {
  const dockerApi = read('infrastructure/docker/Dockerfile.api') || '';
  const dockerWorker = read('infrastructure/docker/Dockerfile.worker') || '';
  const assetDirs = [
    `backend/products/${productLc}/pricing/data`,
    `backend/products/${productLc}/documents/templates`,
    `backend/products/${productLc}/documents/static`,
  ].filter(exists);

  for (const assetDir of assetDirs) {
    if (!dockerApi.includes(assetDir)) {
      return { ok: false, hint: `Dockerfile.api does not COPY ${assetDir} — product runtime assets can be absent from the production image` };
    }
    if (!dockerWorker.includes(assetDir)) {
      return { ok: false, hint: `Dockerfile.worker does not COPY ${assetDir} — product runtime assets can be absent from the worker image` };
    }
  }

  const runtimeAssets = assetDirs.flatMap(listFilesRecursive).filter(isProductRuntimeAsset);
  for (const [dockerName, dockerText] of [['Dockerfile.api', dockerApi], ['Dockerfile.worker', dockerWorker]]) {
    const missingTripwires = missingDockerAssetTripwires(dockerText, runtimeAssets);
    if (missingTripwires.length > 0) {
      return {
        ok: false,
        hint: `${dockerName} lacks RUN test -f tripwires for: ${missingTripwires.join(', ')}`,
      };
    }
  }

  return { ok: true, evidence: `Dockerfile.{api,worker} COPY + tripwire ${runtimeAssets.length} ${productLc} runtime asset(s)` };
}

function slot7_productDefinitionMigration(productUc) {
  // Search every prisma/migrations/*.sql for an INSERT into
  // product_definitions referencing this productCode literal.
  const migrationsRoot = path.join(REPO_ROOT, 'prisma', 'migrations');
  if (!fs.existsSync(migrationsRoot)) {
    return { ok: false, hint: 'prisma/migrations/ not found — repo layout drifted' };
  }
  for (const dir of fs.readdirSync(migrationsRoot)) {
    const sqlPath = path.join(migrationsRoot, dir, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, 'utf8');
    if (
      sql.includes('product_definitions')
      && sql.includes(`'${productUc}'`)
      && /INSERT\s+INTO\s+"?product_definitions"?/i.test(sql)
    ) {
      return { ok: true, evidence: `prisma/migrations/${dir}/migration.sql` };
    }
  }
  return {
    ok: false,
    hint: `no prisma migration inserts the '${productUc}' row into product_definitions — production deploys cannot reference a Program with productType='${productUc}' until this migration lands`,
  };
}

function slot8_binderOverlayMigration(productUc, productLc, allowlist) {
  if (allowlist.bindersBy.includes(productUc)) {
    return { ok: true, evidence: `allowlist (per-product binder migration not required for ${productUc})` };
  }
  // Look for a migration that mentions the productCode + binder_product_authorities.
  const migrationsRoot = path.join(REPO_ROOT, 'prisma', 'migrations');
  if (!fs.existsSync(migrationsRoot)) {
    return { ok: false, hint: 'prisma/migrations/ not found' };
  }
  for (const dir of fs.readdirSync(migrationsRoot)) {
    const sqlPath = path.join(migrationsRoot, dir, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, 'utf8');
    if (
      sql.includes('binder_product_authorities')
      && sql.includes(`'${productUc}'`)
    ) {
      return { ok: true, evidence: `prisma/migrations/${dir}/migration.sql` };
    }
  }
  return {
    ok: false,
    hint: `no prisma migration creates a BinderProductAuthority(productCode='${productUc}') row — production wizard /api/public/${productLc}/session will return 503 "No active binder linked" on day one. Either ship the migration or add '${productUc}' to tools/quality/onboarding-canonical-allowlist.json with a follow-up ADR.`,
  };
}

function slot9_jurisdictionConfig(productUc) {
  const configs = read('backend/modules/jurisdiction/domain/productConfiguration.ts') || '';
  // Match either `'CY/<PRODUCT>'` or `"CY/<PRODUCT>"` as the lookup key.
  const re = new RegExp(`['"][A-Z]{2}\\/${productUc}['"]`);
  if (!re.test(configs)) {
    return {
      ok: false,
      hint: `no '<countryCode>/${productUc}' entry in productConfiguration.ts CONFIGS — jurisdiction-aware code (tax profile, IPT, BDX defaults) will fail-closed for any (country, ${productUc}) call`,
    };
  }
  return { ok: true, evidence: `productConfiguration.ts CONFIGS ⊇ ${productUc}` };
}

// ── Runner ───────────────────────────────────────────────────────────

const SLOTS = [
  { id: 1, name: 'ProductManifest', run: slot1_manifest, takes: 'lc' },
  { id: 2, name: 'ValidationProfile', run: slot2_profile, takes: 'lc' },
  { id: 3, name: 'Backend runtime', run: slot3_runtime, takes: 'lc' },
  { id: 4, name: 'Doc-pack worker', run: slot4_docPackWorker, takes: 'uc' },
  { id: 5, name: 'Frontend register', run: slot5_frontendRegister, takes: 'lc' },
  { id: 6, name: 'Dockerfile assets', run: slot6_dockerCopy, takes: 'lc' },
  { id: 7, name: 'product_definitions migration', run: slot7_productDefinitionMigration, takes: 'uc' },
  { id: 8, name: 'Binder overlay migration', run: slot8_binderOverlayMigration, takes: 'uc-lc-allowlist' },
  { id: 9, name: 'Jurisdiction CONFIGS', run: slot9_jurisdictionConfig, takes: 'uc' },
];

function main() {
  // The guard is repo-level: it inspects the FULL workspace
  // (`frontend/`, `backend/`, `prisma/`, `infrastructure/docker/`).
  // Inside the API docker build the working directory only carries
  // a partial copy of the repo (Dockerfile.api COPYs only
  // `frontend/src/modules/policies/list/`, NOT `frontend/src/products/`,
  // and certainly not `infrastructure/docker/` itself), so the guard
  // would false-positive on every slot it cannot see. Detect that
  // context and skip — the guard still runs in `gate:agent` (which
  // executes from the repo root), in `npm run build:api` from a dev
  // checkout, and in CI before the docker build step.
  const isPartialRepo =
    !fs.existsSync(path.join(REPO_ROOT, 'frontend/src/products'))
    || !fs.existsSync(path.join(REPO_ROOT, 'infrastructure/docker'));
  if (isPartialRepo) {
    console.log('[product-onboarding-canonical] SKIPPED — partial workspace (frontend/products or infrastructure/docker not present, e.g. inside the API docker build context).');
    process.exit(0);
  }

  const products = discoverCanonicalProducts();
  if (products.length === 0) {
    console.error('[product-onboarding-canonical] could not discover any canonical product codes — is canonicalProgramBinderSeed.ts intact?');
    process.exit(1);
  }
  const allowlist = readJson('tools/quality/onboarding-canonical-allowlist.json', { bindersBy: [] });

  let failures = 0;
  const lines = [];
  for (const productUc of products) {
    const productLc = productUc.toLowerCase().replace(/_/g, '-');
    lines.push(`\n## ${productUc}`);
    for (const slot of SLOTS) {
      let result;
      if (slot.takes === 'lc') result = slot.run(productLc);
      else if (slot.takes === 'uc') result = slot.run(productUc);
      else if (slot.takes === 'uc-lc-allowlist') result = slot.run(productUc, productLc, allowlist);
      else result = { ok: false, hint: 'invalid slot.takes' };
      if (result.ok) {
        lines.push(`  ✓ slot ${slot.id} (${slot.name}) — ${result.evidence || 'present'}`);
      } else {
        failures += 1;
        lines.push(`  ✗ slot ${slot.id} (${slot.name}) — ${result.hint}`);
      }
    }
  }

  console.log(lines.join('\n'));
  console.log('');
  if (failures === 0) {
    console.log(`[product-onboarding-canonical] OK — ${products.length} product(s) × 9 slots checked.`);
    process.exit(0);
  } else {
    console.error(`[product-onboarding-canonical] FAILED — ${failures} missing slot(s) across ${products.length} product(s). See ADR-0033 for the canonical checklist.`);
    process.exit(1);
  }
}

main();
