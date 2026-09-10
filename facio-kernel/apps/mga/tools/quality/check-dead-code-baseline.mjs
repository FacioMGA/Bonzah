#!/usr/bin/env node
// Dead-code ratchet. Counts ts-prune real exports (excluding the
// emitted `packages/**/dist/**` artefacts which are noise) plus
// `madge --orphans` files imported by nobody (tests + entry points
// excluded). Fails when any number rises above the baseline.
//
// Lower-only: when debt drops, lower the ceiling in
// `tools/quality/dead-code-baseline.json` so the new floor is locked.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, 'tools', 'quality', 'dead-code-baseline.json');

if (!fs.existsSync(BASELINE_PATH)) {
  console.error(`[dead-code-baseline] missing baseline: ${BASELINE_PATH}`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));

function runTsPrune(tsconfig) {
  const res = spawnSync('npx', ['ts-prune', '-p', tsconfig], { encoding: 'utf8' });
  if (res.status !== 0 && !res.stdout) {
    console.error(`[dead-code-baseline] ts-prune ${tsconfig} failed:\n${res.stderr}`);
    process.exit(1);
  }
  const lines = String(res.stdout || '').split('\n').filter(Boolean);
  return lines.filter((l) => !l.includes('(used in module)') && !/packages\/.*\/dist\//.test(l)).length;
}

function runMadgeOrphans(tsconfig, root, exclude) {
  const res = spawnSync(
    'npx',
    ['madge', '--extensions', 'ts,tsx', '--ts-config', tsconfig, '--orphans', '--exclude', exclude, root],
    { encoding: 'utf8' },
  );
  if (res.status !== 0 && !res.stdout) {
    console.error(`[dead-code-baseline] madge ${root} failed:\n${res.stderr}`);
    process.exit(1);
  }
  const lines = String(res.stdout || '')
    .split('\n')
    .filter((l) => l && !l.startsWith('Processed ') && !l.startsWith('- Finding'));
  return lines.length;
}

const observed = {
  tsPrune: {
    backend: runTsPrune('backend/tsconfig.json'),
    frontend: runTsPrune('frontend/tsconfig.json'),
  },
  madgeOrphans: {
    backend: runMadgeOrphans(
      'backend/tsconfig.json',
      'backend',
      '^backend/dist|\\.d\\.ts$|__tests__|\\.test\\.ts$',
    ),
    frontend: runMadgeOrphans(
      'frontend/tsconfig.json',
      'frontend/src',
      '\\.test\\.(ts|tsx)$|__tests__|\\.d\\.ts$',
    ),
  },
};

const failures = [];
for (const tool of ['tsPrune', 'madgeOrphans']) {
  for (const surface of ['backend', 'frontend']) {
    const seen = observed[tool][surface];
    const cap = baseline[tool][surface];
    if (seen > cap) failures.push(`${tool}.${surface}: ${seen} > ${cap}`);
  }
}

if (failures.length > 0) {
  console.error('[dead-code-baseline] FAILED — dead-code grew above ceiling:');
  for (const f of failures) console.error('  - ' + f);
  console.error('');
  console.error('Either: (a) clean the new dead code, or');
  console.error('       (b) if a real export, ensure it is wired to a consumer, or');
  console.error('       (c) bump the ceiling in tools/quality/dead-code-baseline.json with a justification.');
  process.exit(1);
}

console.log(
  '[dead-code-baseline] ok ' +
  `(ts-prune: backend=${observed.tsPrune.backend}/${baseline.tsPrune.backend}, frontend=${observed.tsPrune.frontend}/${baseline.tsPrune.frontend}; ` +
  `orphans: backend=${observed.madgeOrphans.backend}/${baseline.madgeOrphans.backend}, frontend=${observed.madgeOrphans.frontend}/${baseline.madgeOrphans.frontend})`,
);
