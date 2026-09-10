#!/usr/bin/env node
/**
 * Validation single-source guard (Phase 3i).
 *
 * Phase 3 of the Questionnaire Path Consolidation deleted the FE+BE
 * `shared/validation/` mirrors. `@facio/validation` (this repo's
 * `packages/validation/`) is now the only validation implementation in
 * the codebase.
 *
 * This guard prevents anyone from accidentally resurrecting the deletion:
 *   1. No source file may exist under the retired paths.
 *   2. No source file anywhere may import from a retired path or alias.
 *
 * Markdown documentation under `docs/` and the package's README may name
 * the retired paths in *prose* (history, audit trails, the consolidation
 * baseline). Doc files are pure description; they don't execute. The
 * structural enforcement is restricted to source extensions.
 *
 * Exit codes:
 *   0 = clean
 *   1 = a retired path or import has reappeared
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const RETIRED_DIRS = [
  'frontend/src/shared/validation',
  'backend/shared/validation',
];

// Importer specifiers we forbid. These are the exact shapes consumers
// used to use before Phase 3:
//   - `@/src/shared/validation` and deep imports (FE alias)
//   - `@shared/validation` (alternate FE alias if anyone wired it)
//   - relative paths ending in `shared/validation` (BE relative imports)
const RETIRED_IMPORT_PATTERNS = [
  /from\s+['"]@\/src\/shared\/validation/,
  /from\s+['"]@shared\/validation/,
  /from\s+['"](?:\.\.?\/)+shared\/validation/,
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

// This guard file and the validation-purity guard are the only
// non-doc places where the retired strings legitimately appear (as
// guard rule definitions). Skip them to avoid self-flagging.
const SELF_REFERENCING_FILES = new Set([
  'tools/quality/check-validation-single-source.mjs',
  'tools/quality/check-validation-purity.mjs',
]);

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

// Rule 1: retired directories must not contain any tracked file.
for (const retired of RETIRED_DIRS) {
  const abs = path.join(ROOT, retired);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    violations.push({ kind: 'retired-file', path: toPosix(path.relative(ROOT, file)) });
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

if (violations.length > 0) {
  console.error('[validation-single-source] FAILED — retired shared/validation paths reappeared.');
  console.error('');
  console.error('Phase 3 of the Questionnaire Path Consolidation deleted the FE+BE');
  console.error('`shared/validation/` mirrors. `@facio/validation` (packages/validation/)');
  console.error('is now the only validation implementation. See');
  console.error('docs/architecture/questionnaire-consolidation/baseline.md (Phase 3h).');
  console.error('');
  console.error('Offenders:');
  for (const v of violations) {
    if (v.kind === 'retired-file') {
      console.error(`  - file under retired path: ${v.path}`);
    } else {
      console.error(`  - import of retired path:  ${v.path} (matched ${v.pattern})`);
    }
  }
  console.error('');
  console.error('Use `@facio/validation` (or `/frontend` / `/backend` subpaths) instead.');
  process.exit(1);
}

console.log('[validation-single-source] OK');
