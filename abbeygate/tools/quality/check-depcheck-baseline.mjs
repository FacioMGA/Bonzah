#!/usr/bin/env node
// depcheck ratchet. Counts unused/missing deps and fails when any
// number rises above the baseline. The repo's `.depcheckrc.json`
// captures the curated ignore set for runtime-loaded packages —
// this guard reads from depcheck's filtered output directly.
//
// Lower-only: when debt drops, lower the ceiling in
// `tools/quality/depcheck-baseline.json` so the new floor is locked.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, 'tools', 'quality', 'depcheck-baseline.json');

if (!fs.existsSync(BASELINE_PATH)) {
  console.error(`[depcheck-baseline] missing baseline: ${BASELINE_PATH}`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));

const res = spawnSync('npx', ['depcheck', '--json'], { encoding: 'utf8' });
if (!res.stdout) {
  console.error(`[depcheck-baseline] depcheck failed:\n${res.stderr}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(res.stdout);
} catch (err) {
  console.error('[depcheck-baseline] failed to parse depcheck output:', err.message);
  process.exit(1);
}

const observed = {
  unusedDependencies: (report.dependencies || []).length,
  unusedDevDependencies: (report.devDependencies || []).length,
  missingDependencies: Object.keys(report.missing || {}).length,
};

const failures = [];
if (observed.unusedDependencies > baseline.maxUnusedDependencies) {
  failures.push(`unused dependencies: ${observed.unusedDependencies} > ${baseline.maxUnusedDependencies}`);
}
if (observed.unusedDevDependencies > baseline.maxUnusedDevDependencies) {
  failures.push(`unused devDependencies: ${observed.unusedDevDependencies} > ${baseline.maxUnusedDevDependencies}`);
}
if (observed.missingDependencies > baseline.maxMissingDependencies) {
  failures.push(`missing dependencies: ${observed.missingDependencies} > ${baseline.maxMissingDependencies}`);
}

if (failures.length > 0) {
  console.error('[depcheck-baseline] FAILED — dependency cleanliness regressed:');
  for (const f of failures) console.error('  - ' + f);
  console.error('');
  console.error('Either: (a) wire/uninstall the offender, or');
  console.error('       (b) add it to the curated `.depcheckrc.json` ignore set, or');
  console.error('       (c) bump the ceiling in tools/quality/depcheck-baseline.json with a justification.');
  process.exit(1);
}

console.log(
  '[depcheck-baseline] ok ' +
  `(unused deps=${observed.unusedDependencies}/${baseline.maxUnusedDependencies}, ` +
  `unused devDeps=${observed.unusedDevDependencies}/${baseline.maxUnusedDevDependencies}, ` +
  `missing=${observed.missingDependencies}/${baseline.maxMissingDependencies})`,
);
