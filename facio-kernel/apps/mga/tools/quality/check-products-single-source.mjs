#!/usr/bin/env node
/**
 * Products single-source guard (Phase 4 + motor-closure + Phase 5).
 *
 * Phase 4 of the Questionnaire Path Consolidation collapsed every
 * per-product manifest, validation profile, and manifest type module
 * into `@facio/products` (`packages/products/`). The motor-exception
 * closure (2026-04-28) removed the last FE-only carve-out by moving
 * `motorValidationProfile` into the package, leaving the FE wizard's
 * Zod schemas (`Step1..Step3Schema`) wired to the canonical profile
 * via an inversion-of-control hook. Phase 5 (2026-04-28) collapsed
 * the three generated motor validation contracts (BE products / BE
 * policy app / FE policies module) into a single canonical artifact
 * inside the package, surfaced through the package barrel. There is
 * exactly ONE generator (`tools/quality/generateValidationContractArtifacts.ts`)
 * and ONE generated artifact in the repo.
 *
 * Retired paths:
 *   - `frontend/src/products/{home,travel}/manifest.ts`
 *   - `frontend/src/products/{home,travel}/validation/profile.ts`
 *   - `frontend/src/products/motor/validation/profile.ts`
 *   - `frontend/src/products/motor/wizard/validation/wizardSchemaAdapter.ts`
 *   - `frontend/src/products/motor/questionnaire/stepOwnership.ts`
 *   - `frontend/src/modules/policies/questionnaire/contract/generated/motorValidationContract.generated.ts`
 *   - `backend/products/{home,travel}/manifest.ts`
 *   - `backend/products/{home,travel}/validation/profile.ts`
 *   - `backend/products/motor/manifest.ts`
 *   - `backend/products/motor/questionnaire/motorValidationContract.generated.ts`
 *   - `backend/modules/policy/app/questionnaire/generated/motorValidationContract.generated.ts`
 *   - `backend/modules/policy/domain/productManifest.ts`
 *   - `frontend/src/shared/products/manifest.types.ts`
 *
 * Carve-outs (intentional, scoped):
 *   - `frontend/src/products/motor/manifest.ts` — motor keeps a FE
 *     manifest because it depends on wizard-side schema fixtures. The
 *     6→3 manifest goal is met by deleting motor's BE mirror in 4b.
 *
 * This guard fails on:
 *   1. Any source file appearing under one of the retired exact paths.
 *   2. Any source file importing from a retired path or string-shaped
 *      retired path (relative or aliased).
 *   3. ANY product introducing a
 *      `frontend/src/products/<product>/validation/profile.ts` file.
 *      Profiles must live in `packages/products/src/<product>/profile.ts`
 *      and be consumed via `@facio/products`. There are no FE-only
 *      profile carve-outs.
 *   4. Any new `motorValidationContract.generated.ts` file outside the
 *      canonical location (`packages/products/src/motor/generated/`).
 *      The generator writes exactly one artifact; resurrecting any of
 *      the three retired copies is a guard failure.
 *   5. ANY product introducing a `frontend/src/products/<product>/wizard/
 *      schemas/` directory. Phase 8 (2026-04-28) absorbed motor's last
 *      FE-only Zod tree into `@facio/products`. Schemas must live in
 *      `packages/products/src/<product>/schemas/` and be consumed via
 *      `@facio/products`. Re-creating an FE-only `wizard/schemas/`
 *      directory is a regression.
 *
 * Markdown docs may name the retired paths in prose (audit history,
 * baseline, this header). The structural enforcement is restricted to
 * source extensions and scoped scan roots.
 *
 * Exit codes:
 *   0 = clean
 *   1 = a retired path or import has reappeared
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

// Exact retired files. Each must not exist as a tracked source file.
const RETIRED_FILES = [
  'frontend/src/products/home/manifest.ts',
  'frontend/src/products/home/validation/profile.ts',
  'frontend/src/products/travel/manifest.ts',
  'frontend/src/products/travel/validation/profile.ts',
  'frontend/src/products/motor/validation/profile.ts',
  'frontend/src/products/motor/wizard/validation/wizardSchemaAdapter.ts',
  'frontend/src/products/motor/questionnaire/stepOwnership.ts',
  'frontend/src/modules/policies/questionnaire/contract/generated/motorValidationContract.generated.ts',
  'backend/products/motor/manifest.ts',
  'backend/products/motor/questionnaire/motorValidationContract.generated.ts',
  'backend/products/home/manifest.ts',
  'backend/products/home/validation/profile.ts',
  'backend/products/travel/manifest.ts',
  'backend/products/travel/validation/profile.ts',
  'backend/modules/policy/app/questionnaire/generated/motorValidationContract.generated.ts',
  'backend/modules/policy/domain/productManifest.ts',
  'frontend/src/shared/products/manifest.types.ts',
];

// Importer specifiers we forbid. These are the exact import shapes
// consumers used to use before Phase 4. Each pattern matches a `from
// "..."` clause. Phase 4 also unified the country list into
// `@facio/products`; the previous FE shared data path is therefore
// also retired.
const RETIRED_IMPORT_PATTERNS = [
  // Manifest + profile re-imports under the retired product paths
  /from\s+['"][^'"]*products\/home\/manifest['"]/,
  /from\s+['"][^'"]*products\/home\/validation\/profile['"]/,
  /from\s+['"][^'"]*products\/travel\/manifest['"]/,
  /from\s+['"][^'"]*products\/travel\/validation\/profile['"]/,
  /from\s+['"][^'"]*products\/motor\/validation\/profile['"]/,
  // Retired motor wizard schema bridge (absorbed into ./schemas)
  /from\s+['"][^'"]*motor\/wizard\/validation\/wizardSchemaAdapter['"]/,
  // Retired motor stepOwnership FE path (now in @facio/products)
  /from\s+['"][^'"]*products\/motor\/questionnaire\/stepOwnership['"]/,
  // Retired generated motor validation contract artifacts (Phase 5)
  /from\s+['"][^'"]*products\/motor\/questionnaire\/motorValidationContract\.generated(?:\.js)?['"]/,
  /from\s+['"][^'"]*policy\/app\/questionnaire\/generated\/motorValidationContract\.generated(?:\.js)?['"]/,
  /from\s+['"][^'"]*policies\/questionnaire\/contract\/generated\/motorValidationContract\.generated(?:\.js)?['"]/,
  // Manifest type module aliases (BE + FE)
  /from\s+['"][^'"]*modules\/policy\/domain\/productManifest['"]/,
  /from\s+['"][^'"]*shared\/products\/manifest\.types['"]/,
  // Retired BE motor manifest path (kept FE-only post-4b)
  /from\s+['"][^'"]*backend\/products\/motor\/manifest['"]/,
  // Retired FE shared countries data (now in @facio/products)
  /from\s+['"]@\/src\/shared\/data\/countries['"]/,
  /from\s+['"](?:\.\.?\/)+shared\/data\/countries['"]/,
];

const SOURCE_EXT = /\.(ts|tsx|mjs|cjs|js|jsx)$/;

const SCAN_ROOTS = ['frontend/src', 'backend', 'packages', 'apps'];

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  'artifacts',
]);

// This guard file is the only non-doc place where the retired strings
// legitimately appear (as the rule definitions themselves). Skip it to
// avoid self-flagging.
const SELF_REFERENCING_FILES = new Set([
  'tools/quality/check-products-single-source.mjs',
]);

// Rule 3: NO FE-only profile carve-outs. After the motor-exception
// closure (2026-04-28) every product's validation profile lives in
// `packages/products/src/<product>/profile.ts`. The set is empty by
// design — adding to it requires changing this guard, which is a
// visible PR change reviewers will catch.
const ALLOWED_FE_ONLY_PROFILE_PRODUCTS = new Set();

const FE_PRODUCTS_DIR = 'frontend/src/products';

function toPosix(value) {
  return String(value || '').replaceAll('\\', '/');
}

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else if (entry.isFile()) yield abs;
  }
}

const violations = [];

// Rule 1: retired files must not exist on disk as source.
for (const retired of RETIRED_FILES) {
  const abs = path.join(ROOT, retired);
  if (fs.existsSync(abs)) {
    violations.push({ kind: 'retired-file', path: retired });
  }
}

// Rule 2: no source file may import a retired path.
for (const root of SCAN_ROOTS) {
  for (const file of walk(path.join(ROOT, root))) {
    if (!SOURCE_EXT.test(file)) continue;
    const rel = toPosix(path.relative(ROOT, file));
    if (SELF_REFERENCING_FILES.has(rel)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const pattern of RETIRED_IMPORT_PATTERNS) {
      if (pattern.test(src)) {
        violations.push({ kind: 'retired-import', path: rel, pattern: String(pattern) });
        break;
      }
    }
  }
}

// Rule 3: only the allow-listed products may keep a FE-only
// `validation/profile.ts`. Any other `frontend/src/products/<product>/
// validation/profile.ts` is a violation — that product must put its
// profile in `packages/products/src/<product>/profile.ts` instead.
const productsDirAbs = path.join(ROOT, FE_PRODUCTS_DIR);
if (fs.existsSync(productsDirAbs)) {
  for (const entry of fs.readdirSync(productsDirAbs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const product = entry.name;
    const profileRel = `${FE_PRODUCTS_DIR}/${product}/validation/profile.ts`;
    const profileAbs = path.join(ROOT, profileRel);
    if (!fs.existsSync(profileAbs)) continue;
    if (ALLOWED_FE_ONLY_PROFILE_PRODUCTS.has(product)) continue;
    violations.push({ kind: 'fe-only-profile-for-non-exempt-product', path: profileRel, product });
  }
}

// Rule 4: there is exactly ONE motor validation contract artifact in
// the repo, at the canonical location. Any other
// `motorValidationContract.generated.ts` file (a copy under any name,
// at any depth, in any scan root) is a Phase-5 regression — the
// generator was rerouted to a duplicate output, or the deleted copies
// have been resurrected.
const CANONICAL_MOTOR_ARTIFACT_REL = 'packages/products/src/motor/generated/motorValidationContract.generated.ts';
for (const root of SCAN_ROOTS) {
  for (const file of walk(path.join(ROOT, root))) {
    const rel = toPosix(path.relative(ROOT, file));
    if (path.basename(rel) !== 'motorValidationContract.generated.ts') continue;
    if (rel === CANONICAL_MOTOR_ARTIFACT_REL) continue;
    violations.push({ kind: 'duplicate-generated-artifact', path: rel });
  }
}

// Rule 5: NO FE-only product Zod-schema trees. After Phase 8 (2026-04-28)
// every product's wizard validation schemas live in
// `packages/products/src/<product>/schemas/`. Reintroducing an FE-only
// `frontend/src/products/<product>/wizard/schemas/` directory (even if
// just a barrel that re-exports from the package) re-creates the cross-
// boundary mirror Phase 8 deleted.
if (fs.existsSync(productsDirAbs)) {
  for (const entry of fs.readdirSync(productsDirAbs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const product = entry.name;
    const schemasRel = `${FE_PRODUCTS_DIR}/${product}/wizard/schemas`;
    const schemasAbs = path.join(ROOT, schemasRel);
    if (!fs.existsSync(schemasAbs)) continue;
    violations.push({ kind: 'fe-only-wizard-schemas-dir', path: schemasRel, product });
  }
}

if (violations.length > 0) {
  console.error('[products-single-source] FAILED — retired product manifest/profile paths reappeared.');
  console.error('');
  console.error('Phase 4 of the Questionnaire Path Consolidation collapsed every');
  console.error('per-product manifest + validation profile into `@facio/products`');
  console.error('(packages/products/). See');
  console.error('docs/architecture/questionnaire-consolidation/baseline.md (Phase 4).');
  console.error('');
  console.error('Offenders:');
  for (const v of violations) {
    if (v.kind === 'retired-file') {
      console.error(`  - file under retired path: ${v.path}`);
    } else if (v.kind === 'retired-import') {
      console.error(`  - import of retired path:  ${v.path} (matched ${v.pattern})`);
    } else if (v.kind === 'fe-only-profile-for-non-exempt-product') {
      console.error(`  - FE-only validation profile reintroduced for product '${v.product}': ${v.path}`);
      console.error('       After the motor-exception closure (2026-04-28) there are NO');
      console.error('       FE-only profile carve-outs. Move it to');
      console.error(`       packages/products/src/${v.product}/profile.ts and consume it via`);
      console.error('       `@facio/products`. If the profile needs FE-only validators (e.g.');
      console.error('       Zod schemas that import `react-phone-number-input`), expose an');
      console.error('       inversion-of-control hook from the canonical profile and have');
      console.error('       the FE adapter wire its validators at boot — see');
      console.error('       `packages/products/src/motor/profile.ts` for the pattern.');
    } else if (v.kind === 'duplicate-generated-artifact') {
      console.error(`  - duplicate motorValidationContract.generated.ts: ${v.path}`);
      console.error('       Phase 5 collapsed the three motor validation contract copies');
      console.error('       (BE products / BE policy app / FE policies module) into the');
      console.error('       single canonical artifact at');
      console.error(`       \`${CANONICAL_MOTOR_ARTIFACT_REL}\`.`);
      console.error('       Update `tools/quality/generateValidationContractArtifacts.ts` to');
      console.error('       write only to the canonical location, and consume the constants');
      console.error('       via `@facio/products`. Do not reintroduce a duplicate output.');
    } else if (v.kind === 'fe-only-wizard-schemas-dir') {
      console.error(`  - FE-only wizard schemas dir reintroduced for product '${v.product}': ${v.path}`);
      console.error('       Phase 8 (2026-04-28) absorbed motor\'s last FE-only Zod tree');
      console.error('       into `@facio/products`. Schemas must live in');
      console.error(`       packages/products/src/${v.product}/schemas/ and be consumed via`);
      console.error('       `@facio/products`. Even a barrel re-export under');
      console.error('       `frontend/src/products/<product>/wizard/schemas/` re-creates the');
      console.error('       cross-boundary mirror Phase 8 deleted.');
    }
  }
  console.error('');
  console.error('Use `@facio/products` instead.');
  process.exit(1);
}

console.log('[products-single-source] OK');
