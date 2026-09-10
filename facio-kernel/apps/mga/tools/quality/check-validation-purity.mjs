#!/usr/bin/env node
/**
 * Validation purity guard (Phase 3i, post-consolidation).
 * (Amendment #6 — cross-layer contamination, repointed)
 *
 * `packages/validation/` (`@facio/validation`) is the canonical, ENV-AGNOSTIC
 * validation library. Its core (everything except `src/adapters/`) must stay
 * environment-free so it can be loaded from the customer wizard, the BO
 * Underwriting tab, AND the backend adapters with identical behaviour.
 *
 * The moment ANY file under `packages/validation/src/` starts importing:
 *   - from `@/src/...`, `@server/...`, `@shared/...`, `@web/...`
 *   - from `frontend/...`, `backend/...`, `apps/...`
 *   - from an alias that points to an environment-specific layer
 *
 * ...it stops being shared and becomes brittle glue. This script fails
 * CI the first time that happens.
 *
 * Allowed imports (environment-safe):
 *   - Third-party env-agnostic: `zod`, `vitest`.
 *   - The two adapter files (and ONLY them) may import the env-specific
 *     phone validators they wrap:
 *       - `src/adapters/frontend.ts` may import `react-phone-number-input`.
 *       - `src/adapters/backend.ts`  may import `libphonenumber-js`.
 *   - Node built-ins via the `node:` protocol (used in tests only).
 *   - Relative imports WITHIN `packages/validation/src/`.
 *
 * The guard scans `packages/validation/src/` (the single source of
 * truth). The pre-Phase-3 mirrors (`frontend/src/shared/validation/`
 * and `backend/shared/validation/`) were deleted in Phase 3h; if either
 * reappears, `check-validation-single-source.mjs` flags it separately.
 *
 * Exit codes:
 *   0 = clean
 *   1 = forbidden imports found
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const TARGETS = [
  'packages/validation/src',
];

// Always-allowed bare specifiers (env-agnostic everywhere in the package).
const ALLOWED_BARE_SPECIFIERS = new Set([
  'zod',
  'vitest',            // tests only
]);

// Env-specific phone validators are allowed in their dedicated adapter
// only. Importing either from anywhere else in the package would break
// the env-agnostic invariant of the core.
const ADAPTER_BARE_SPECIFIERS = new Map([
  ['react-phone-number-input', /(^|\/)src\/adapters\/frontend\.ts$/],
  ['libphonenumber-js',        /(^|\/)src\/adapters\/backend\.ts$/],
]);

const ALLOWED_PREFIXES = [
  'node:',              // node built-ins via node: protocol
];

const IMPORT_RE = /(?:^|\n)\s*import[^'"\n]*['"]([^'"]+)['"]|(?:^|\n)\s*(?:export\s+[^'"\n]*)?\s*from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(abs);
    } else if (entry.isFile() && /\.(ts|tsx|mjs|js)$/.test(entry.name)) {
      yield abs;
    }
  }
}

function extractSpecifiers(source) {
  const out = [];
  let match;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(source))) {
    const spec = match[1] || match[2] || match[3];
    if (spec) out.push(spec);
  }
  return out;
}

function isForbidden(spec, filePosixPath) {
  if (spec.startsWith('.')) return false;

  if (ALLOWED_BARE_SPECIFIERS.has(spec)) return false;
  for (const pkg of ALLOWED_BARE_SPECIFIERS) {
    if (spec.startsWith(`${pkg}/`)) return false;
  }

  // Adapter-only env-specific specifiers: allowed iff the importing file
  // matches the adapter pattern.
  for (const [pkg, adapterRe] of ADAPTER_BARE_SPECIFIERS) {
    if (spec === pkg || spec.startsWith(`${pkg}/`)) {
      return !adapterRe.test(filePosixPath);
    }
  }

  for (const prefix of ALLOWED_PREFIXES) {
    if (spec.startsWith(prefix)) return false;
  }

  return true;
}

const failures = [];

for (const target of TARGETS) {
  const absDir = path.join(ROOT, target);
  if (!fs.existsSync(absDir)) continue;

  for (const file of walk(absDir)) {
    const relPath = path.relative(ROOT, file).replaceAll('\\', '/');
    const source = fs.readFileSync(file, 'utf8');
    for (const spec of extractSpecifiers(source)) {
      if (isForbidden(spec, relPath)) {
        failures.push(`${relPath}  imports  ${spec}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('[validation-purity] FAILED — forbidden cross-layer imports in @facio/validation.');
  console.error('');
  console.error('`packages/validation/src/` MUST remain environment-agnostic. It cannot');
  console.error('pull in FE/BE app modules, surface code, or env-specific adapters.');
  console.error('Phone validators are allowed ONLY in their dedicated adapter file');
  console.error('(`adapters/frontend.ts`, `adapters/backend.ts`). See');
  console.error('docs/engineering/VALIDATION.md -> "Cross-layer hygiene".');
  console.error('');
  console.error('Offending imports:');
  for (const line of failures) console.error(`  ${line}`);
  console.error('');
  console.error('If the import is legitimately environment-safe (a pure third-party');
  console.error('package with no DOM/Node-only side effects), add it to');
  console.error('ALLOWED_BARE_SPECIFIERS in tools/quality/check-validation-purity.mjs.');
  process.exit(1);
}

console.log('[validation-purity] OK');
