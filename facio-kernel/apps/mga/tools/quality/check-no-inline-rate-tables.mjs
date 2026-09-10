#!/usr/bin/env node
/**
 * Guard: no inline rate-table .ts files under product `pricing/matrices/`
 * dirs OR product-level `pricing/*RateCards*.ts` files (excluding shims
 * that are pure re-exports of `data/loader.ts`).
 *
 * Per `docs/architecture/contracts/canonical-ownership.md` and ADR-0014:
 *   Rate tables (and other large literal data) belong under
 *   `backend/products/<product>/pricing/data/<dataset>.json`, with a sibling
 *   `.schema.ts` (zod) and `loader.ts` (validates, freezes, caches).
 *   Motor (PR-of-record) and home (PR7) both comply; travel adopts the
 *   same layout when its rate tables grow.
 *
 * What this guard forbids:
 *   - Any new `.ts` file under `backend/products/* /pricing/matrices/`.
 *   - Any new `*RateCards*.ts` / `*Matrix*.ts` at the product `pricing/`
 *     root that is not a thin re-export of `data/loader.ts`.
 *
 * Grandfathered files live in `tools/quality/inline-rate-tables-baseline.json`.
 * Shrink that list; never grow it.
 *
 * If you need to add a rate table:
 *   1. Add `backend/products/<product>/pricing/data/<dataset>.json`.
 *   2. Add `backend/products/<product>/pricing/data/<dataset>.schema.ts` (zod).
 *   3. Add `backend/products/<product>/pricing/data/loader.ts` (validates + freezes).
 *   4. Have your consumer call the loader.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, 'tools/quality/inline-rate-tables-baseline.json');
// ADR-0014 / ADR-0018: rate cards live as JSON + zod + loader. The
// regex catches the legacy inline-`.ts` shapes that the program has
// retired:
//   - `pricing/matrices/*.ts` (motor-shaped)
//   - `pricing/*RateCards*.ts` (home-shaped, retired in PR 5)
//   - `pricing/*Matrix.ts` (motor-shaped subdirs)
//   - `pricing/*RateTable*.ts` / `pricing/*Rates*.ts` (travel-shaped, retired
//     in PR 3) — explicitly added so the deleted `travelRateTable.ts` filename
//     and any `*Rates*.ts` analogue can never come back.
const FORBIDDEN_GLOB = /^backend\/products\/[^/]+\/pricing\/(matrices\/.+\.ts|.*[Rr]ate[Cc]ards?.*\.ts|.*[Mm]atrix\.ts|.*[Rr]ate[Tt]able.*\.ts|.*[Rr]ates\.ts)$/;

// PR 5 (closing ADR-0014) deleted the last `*RateCards*.ts` shim that
// pure-re-exported from `data/loader.js`. The previous `isPureReExportShim`
// exemption is no longer needed; if a future PR resurrects the pattern,
// the deleted-identifiers guard will catch the import path and the
// inline-rate-tables baseline will catch any new file with a forbidden
// name.

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return new Set();
  const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  return new Set(Array.isArray(raw.files) ? raw.files : []);
}

function listTrackedFiles() {
  const trackedOut = execSync('git ls-files -z', {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const deletedOut = execSync('git ls-files -z --deleted', {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const deleted = new Set(
    deletedOut
      .toString('utf8')
      .split('\0')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replaceAll('\\', '/')),
  );
  return trackedOut
    .toString('utf8')
    .split('\0')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replaceAll('\\', '/'))
    .filter((p) => !deleted.has(p));
}

const baseline = loadBaseline();
const tracked = listTrackedFiles();
const violations = [];
const staleBaseline = [];

for (const file of tracked) {
  if (!FORBIDDEN_GLOB.test(file)) continue;
  if (baseline.has(file)) continue;
  violations.push(file);
}

for (const file of baseline) {
  if (!tracked.includes(file)) staleBaseline.push(file);
}

if (violations.length > 0) {
  console.error('\n[no-inline-rate-tables] Forbidden inline rate-table file(s) found:\n');
  for (const v of violations) console.error('  - ' + v);
  console.error(
    '\nMove the data to `backend/products/<product>/pricing/data/<dataset>.json` and add a sibling\n' +
      '`.schema.ts` (zod) + `loader.ts`. See `docs/architecture/contracts/canonical-ownership.md`.\n' +
      '\nIf the file is genuinely transitional, add it to\n' +
      '`tools/quality/inline-rate-tables-baseline.json` (then shrink that list).\n',
  );
  process.exit(1);
}

if (staleBaseline.length > 0) {
  console.error('\n[no-inline-rate-tables] Stale baseline entries (file no longer exists):\n');
  for (const s of staleBaseline) console.error('  - ' + s);
  console.error('\nRemove these from `tools/quality/inline-rate-tables-baseline.json`.\n');
  process.exit(1);
}

console.log('[no-inline-rate-tables] ok (' + baseline.size + ' grandfathered)');
