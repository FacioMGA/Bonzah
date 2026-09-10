// tools/docs/generate-contracts.mjs
//
// Generator: docs/reference/contracts.md
// Walks the explicit contract surfaces across the codebase and writes
// the canonical inventory required by ADR-0010. Each row contains:
// owner, source file, products using it, last changed.
//
// Sources:
//   packages/validation/src/**/contract.ts        (validation contracts)
//   packages/products/*/src/**/profile.ts         (product profiles)
//   packages/products/src/*/profile.ts            (current monorepo layout)
//   backend/modules/*/domain/events/*.ts          (event constants)
//   backend/products/**/*Authority.ts             (authority contracts; the
//                                                  walker matches anywhere
//                                                  under backend/products/,
//                                                  not just an authority/
//                                                  subfolder)
//
// `packages/validation/src/**/contract.ts` does NOT exist yet; the
// nationality canonical contract lands in the validation PR. The
// generator must surface "0 validation contracts" cleanly until then.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastChangedFor } from './lib/git.mjs';
import { serializeFrontmatter } from './lib/frontmatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

async function pathExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function* walk(dir, predicate) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') continue;
      yield* walk(full, predicate);
    } else if (entry.isFile() && predicate(full)) {
      yield full;
    }
  }
}

async function readImportingProducts(contractRel) {
  // Quick grep across packages/products/* for files that import the contract.
  // The contracts column should answer "which products use this".
  const productsRoot = path.join(REPO_ROOT, 'packages', 'products');
  if (!(await pathExists(productsRoot))) return [];
  const matches = new Set();
  for await (const file of walk(productsRoot, (p) => /\.(ts|tsx)$/.test(p))) {
    let content = '';
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    // Match either path-based imports or @facio/validation sub-paths.
    const importsContract =
      content.includes(contractRel) ||
      content.includes(contractRel.replace(/^packages\/validation\/src\//, '@facio/validation/'));
    if (importsContract) {
      // Extract product name from path: packages/products/src/<product>/...
      const m = file.match(/packages\/products\/src\/([\w-]+)\//) ||
        file.match(/packages\/products\/([\w-]+)\//);
      if (m) matches.add(m[1]);
    }
  }
  return [...matches].sort();
}

function ownerFor(rel) {
  if (rel.startsWith('packages/validation/')) return 'platform-validation';
  if (rel.startsWith('packages/products/')) return 'platform-products';
  if (rel.startsWith('backend/modules/')) {
    const m = rel.match(/backend\/modules\/([^/]+)\//);
    return m ? `module:${m[1]}` : 'platform-eng';
  }
  if (rel.startsWith('backend/products/')) return 'platform-products';
  return 'platform-eng';
}

async function collectValidationContracts() {
  const root = path.join(REPO_ROOT, 'packages', 'validation', 'src');
  const rows = [];
  for await (const file of walk(root, (p) => /\/contract\.ts$/.test(p))) {
    const rel = path.relative(REPO_ROOT, file);
    const productsUsing = await readImportingProducts(rel);
    rows.push({
      contract: path.basename(path.dirname(rel)),
      family: 'Validation',
      owner: ownerFor(rel),
      source: rel,
      products: productsUsing,
      lastChanged: lastChangedFor(rel).raw,
    });
  }
  return rows;
}

async function collectProductProfiles() {
  const candidates = [
    path.join(REPO_ROOT, 'packages', 'products', 'src'),
    path.join(REPO_ROOT, 'packages', 'products'),
  ];
  const rows = [];
  for (const root of candidates) {
    if (!(await pathExists(root))) continue;
    for await (const file of walk(root, (p) => /\/profile\.ts$/.test(p))) {
      const rel = path.relative(REPO_ROOT, file);
      const m = rel.match(/packages\/products\/(?:src\/)?([\w-]+)\/profile\.ts$/);
      const productName = m ? m[1] : path.basename(path.dirname(rel));
      rows.push({
        contract: `${productName} profile`,
        family: 'Product Profile',
        owner: ownerFor(rel),
        source: rel,
        products: [productName],
        lastChanged: lastChangedFor(rel).raw,
      });
    }
  }
  // De-dupe in case both candidate roots match.
  const seen = new Map();
  for (const row of rows) {
    seen.set(row.source, row);
  }
  return [...seen.values()];
}

async function collectEventContracts() {
  const root = path.join(REPO_ROOT, 'backend', 'modules');
  const rows = [];
  if (!(await pathExists(root))) return rows;
  for await (const file of walk(root, (p) => /\/domain\/events\/[^/]+\.ts$/.test(p))) {
    const rel = path.relative(REPO_ROOT, file);
    const m = rel.match(/backend\/modules\/([^/]+)\/domain\/events\/([^/]+)\.ts$/);
    const moduleName = m ? m[1] : 'unknown';
    const eventName = m ? m[2] : path.basename(rel, '.ts');
    rows.push({
      contract: `${moduleName}: ${eventName}`,
      family: 'Event',
      owner: ownerFor(rel),
      source: rel,
      products: [],
      lastChanged: lastChangedFor(rel).raw,
    });
  }
  return rows;
}

async function collectAuthorityContracts() {
  const root = path.join(REPO_ROOT, 'backend', 'products');
  const rows = [];
  if (!(await pathExists(root))) return rows;
  for await (const file of walk(root, (p) => /Authority\.ts$/.test(p))) {
    const rel = path.relative(REPO_ROOT, file);
    const m = rel.match(/backend\/products\/([^/]+)\//);
    const productName = m ? m[1] : 'shared';
    rows.push({
      contract: path.basename(rel, '.ts'),
      family: 'Authority',
      owner: ownerFor(rel),
      source: rel,
      products: [productName],
      lastChanged: lastChangedFor(rel).raw,
    });
  }
  return rows;
}

export async function buildContractsInventory() {
  const [validation, profiles, events, authority] = await Promise.all([
    collectValidationContracts(),
    collectProductProfiles(),
    collectEventContracts(),
    collectAuthorityContracts(),
  ]);
  const rows = [...validation, ...profiles, ...events, ...authority];
  rows.sort(
    (a, b) =>
      a.family.localeCompare(b.family) ||
      a.contract.localeCompare(b.contract),
  );
  return rows;
}

function renderTable(rows) {
  if (rows.length === 0) {
    return '_No contracts discovered yet. Add a `contract.ts` under `packages/validation/src/<field>/`._';
  }
  const header = '| Contract | Family | Owner | Source | Products using it | Content revision |';
  const sep = '|----------|--------|-------|--------|-------------------|--------------|';
  const lines = rows.map((r) => {
    const products = r.products.length ? r.products.map((p) => '`' + p + '`').join(', ') : '_n/a_';
    return `| \`${r.contract}\` | ${r.family} | ${r.owner} | \`${r.source}\` | ${products} | ${r.lastChanged} |`;
  });
  return [header, sep, ...lines].join('\n');
}

export async function buildContractsDoc() {
  const rows = await buildContractsInventory();
  const frontmatter = serializeFrontmatter({
    title: 'Cross-Codebase Contracts Inventory',
    audience: 'agent',
    status: 'living',
    owner: 'platform-eng',
    reviewed: new Date().toISOString().slice(0, 10),
    binding: false,
    generated_by: 'tools/docs/generate-contracts.mjs',
  });

  const body = `<!--
  GENERATED FILE — DO NOT EDIT BY HAND.
  Run \`npm run docs:generate -- --only=contracts\` to regenerate.
  CI: \`npm run docs:generate -- --check\` fails on drift.
-->

# Cross-Codebase Contracts Inventory

The substrate \`guard:contracts-product-consistency\` will use to make Product field-contract drift impossible (ADR-0010). Each row is the canonical record of one contract that crosses module / package / surface boundaries.

## Sources

| Family | Pattern |
|--------|---------|
| Validation | \`packages/validation/src/**/contract.ts\` |
| Product Profile | \`packages/products/(src/)?<product>/profile.ts\` |
| Event | \`backend/modules/<module>/domain/events/*.ts\` |
| Authority | \`backend/products/**/*Authority.ts\` |

## Inventory (${rows.length} contracts)

${renderTable(rows)}
`;

  return frontmatter + body;
}

export const generator = {
  name: 'contracts',
  target: 'docs/reference/contracts.md',
  build: buildContractsDoc,
};
