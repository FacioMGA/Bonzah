#!/usr/bin/env node
/**
 * Guardrail: forbid direct `zod` imports in product wizard schema/validation
 * folders.
 *
 * The unified validation architecture (see docs/engineering/VALIDATION.md)
 * requires every product to compose validation from the shared rule library
 * (`@facio/validation`) and to ship its profile + Zod tree in
 * `@facio/products`. Phase 8 (2026-04-28) absorbed motor's last FE-only
 * Zod copy, so the grandfathered list is now empty.
 *
 * Usage:
 *   node tools/quality/check-no-zod-in-product-wizard-schemas.mjs
 *
 * Exit codes:
 *   0 = clean
 *   1 = one or more forbidden imports found
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PRODUCTS_DIR = path.join(ROOT, 'frontend', 'src', 'products');

// Products allowed to import `zod` directly during a migration window. The
// set is empty by design after the Phase 8 motor absorption — adding to it
// requires a guarded PR with a clear deletion plan.
const GRANDFATHERED_PRODUCTS = new Set();

// Folders under `frontend/src/products/<code>/` that MUST NOT contain a
// direct `zod` import for non-grandfathered products.
const FORBIDDEN_SUBPATHS = [
  path.sep + 'wizard' + path.sep + 'schemas' + path.sep,
  path.sep + 'wizard' + path.sep + 'validation' + path.sep,
];

const ZOD_IMPORT_RE = /\bfrom\s+['"]zod['"]|require\(['"]zod['"]\)/;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(absPath);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      yield absPath;
    }
  }
}

const failures = [];

if (fs.existsSync(PRODUCTS_DIR)) {
  for (const entry of fs.readdirSync(PRODUCTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const productCode = entry.name;
    if (GRANDFATHERED_PRODUCTS.has(productCode)) continue;
    const productDir = path.join(PRODUCTS_DIR, productCode);

    for (const file of walk(productDir)) {
      const relative = path.relative(ROOT, file);
      const relWithSep = path.sep + relative + path.sep;
      const isInForbiddenSubpath = FORBIDDEN_SUBPATHS.some((sub) => relWithSep.includes(sub));
      if (!isInForbiddenSubpath) continue;

      const source = fs.readFileSync(file, 'utf8');
      const lines = source.split('\n');
      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        // Ignore commented-out lines.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (ZOD_IMPORT_RE.test(line)) {
          failures.push(`${relative}:${idx + 1}  ${line.trim()}`);
        }
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Direct `zod` imports found in product wizard schema/validation folders.');
  console.error('');
  console.error('The unified validation architecture requires products to compose rules');
  console.error('from `@facio/validation` (packages/validation/) — Phase 3 deleted the');
  console.error('`frontend/src/shared/validation/` mirror. See');
  console.error('docs/engineering/VALIDATION.md for how to add a ValidationProfile.');
  console.error('');
  console.error('Offending files:');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('');
  console.error('If the import is intentional and the product is large/mature, add it to');
  console.error('GRANDFATHERED_PRODUCTS in this script with an accompanying TODO.');
  process.exit(1);
}

console.log('OK: no direct zod imports in non-grandfathered product wizard schemas.');
