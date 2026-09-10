#!/usr/bin/env node
// tools/quality/__tests__/check-contracts-product-consistency.test.mjs
//
// Synthetic-drift coverage for `guard:contracts-product-consistency`.
//
// Each scenario clones the repo's canonical contract source / candidate
// callsites into a temp directory, mutates them to introduce ONE known
// drift, runs the guard against the clone, and asserts the guard fails
// with the expected message.
//
// Why a clone (not the live repo): the live repo passes the guard, by
// design. We need targeted, isolated mutations to prove the guard
// actually catches the bug class, not just that it returns 0 today.
//
// Run via `npm run guard:contracts-product-consistency:test`
// (registered in package.json by the validation PR). No test framework:
// the file is plain Node so it slots into the same `node tools/quality/...`
// pipeline as the guard itself.

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GUARD_REL = 'tools/quality/check-contracts-product-consistency.mjs';

async function copyTree(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyTree(srcPath, dstPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, dstPath);
    }
  }
}

async function makeClone() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'contracts-guard-'));
  // Copy only the files the guard reads to keep the clone tiny.
  const wantedDirs = [
    'packages/validation/src/nationality',
    'packages/products/src/home',
    'packages/products/src/motor',
    'packages/products/src/travel',
    'packages/products/src/shared',
    'tools/quality',
    'tools/migrations',
    'frontend/src/shared/config',
    'frontend/src/shared/lib/wizard/steps',
    'frontend/src/products/motor/wizard/config',
    'frontend/src/products/motor/wizard/utils',
    'frontend/src/products/motor/wizard/components/steps',
    'frontend/src/modules/policies/services',
    'frontend/src/surfaces/client/controller',
    'backend/products/motor',
    'backend/products/home',
    'backend/platform/test/fixtures',
    'backend/modules/jurisdiction/domain',
    'backend/modules/pricing/domain/__tests__',
    'backend/http/middleware/__tests__',
    'backend/http/routes/__tests__',
    'prisma',
  ];
  for (const rel of wantedDirs) {
    const src = path.join(REPO_ROOT, rel);
    try {
      await fs.access(src);
    } catch {
      continue;
    }
    await copyTree(src, path.join(tmp, rel));
  }
  // Also copy the seed/test files at repo root that the guard scans.
  for (const rel of ['backend/seed.ts']) {
    try {
      await fs.copyFile(path.join(REPO_ROOT, rel), path.join(tmp, rel));
    } catch {
      // file may not exist in every layout
    }
  }
  return tmp;
}

function runGuard(cwd) {
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, GUARD_REL)],
    {
      cwd,
      env: {
        ...process.env,
        CONTRACTS_GUARD_STRICT: '1',
        CONTRACTS_GUARD_REPO_ROOT: cwd,
      },
      encoding: 'utf8',
    },
  );
  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

async function patch(cwd, rel, mutate) {
  const fullPath = path.join(cwd, rel);
  const before = await fs.readFile(fullPath, 'utf8');
  const after = mutate(before);
  if (before === after) {
    throw new Error(`patch was a no-op for ${rel}`);
  }
  await fs.writeFile(fullPath, after, 'utf8');
}

async function assertCatches(scenarioName, cwd, expectedSubstring) {
  const result = runGuard(cwd);
  if (result.code === 0) {
    throw new Error(
      `[${scenarioName}] guard exited 0; expected drift detection.\nstdout=${result.stdout}\nstderr=${result.stderr}`,
    );
  }
  const combined = result.stdout + result.stderr;
  if (!combined.includes(expectedSubstring)) {
    throw new Error(
      `[${scenarioName}] guard failed but message did not mention ${JSON.stringify(expectedSubstring)}.\noutput=${combined}`,
    );
  }
  console.log(`  ✓ ${scenarioName}`);
}

const SCENARIOS = [
  {
    name: 'demonym default in prisma seed',
    apply: async (cwd) => {
      await patch(cwd, 'prisma/seed.ts', (s) =>
        s.replace(
          "defaultNationality: 'United Kingdom',",
          "defaultNationality: 'British',",
        ),
      );
    },
    expect: "legacy demonym 'British'",
  },
  {
    name: 'home profile drops nationality from bind stage',
    apply: async (cwd) => {
      await patch(cwd, 'packages/products/src/home/profile.ts', (s) =>
        s.replace(
          /bind: \{\s*fields: \[([\s\S]*?)\],\s*\},/,
          (match, fields) => {
            const cleaned = fields.replace(/\s*'proposer\.nationality',?\n?/g, '');
            return match.replace(fields, cleaned);
          },
        ),
      );
    },
    expect: "missing from `stages.bind.fields`",
  },
  {
    name: 'home profile downgrades nationality rule to nonEmptyString',
    apply: async (cwd) => {
      await patch(cwd, 'packages/products/src/home/profile.ts', (s) =>
        s.replace(
          "'proposer.nationality': { path: 'proposer.nationality', rule: 'nationality'",
          "'proposer.nationality': { path: 'proposer.nationality', rule: 'nonEmptyString'",
        ),
      );
    },
    expect: "uses rule 'nonEmptyString'",
  },
  {
    name: 'travel manifest re-introduces nationality despite collected:false',
    apply: async (cwd) => {
      await patch(cwd, 'packages/products/src/travel/manifest.ts', (s) =>
        s.replace(
          "{ path: 'proposer.dateOfBirth', label: 'Date of birth', type: 'date' },",
          "{ path: 'proposer.dateOfBirth', label: 'Date of birth', type: 'date' },\n        { path: 'proposer.nationality', label: 'Nationality', type: 'text' },",
        ),
      );
    },
    expect: 'manifest still exposes',
  },
  {
    name: 'flat quoteData.nationality in client portal endorsement',
    apply: async (cwd) => {
      await patch(
        cwd,
        'frontend/src/surfaces/client/controller/useClientProfileController.ts',
        (s) =>
          s.replace(
            /proposer: \{\s*nationality: formData\.nationality,?\s*\},/,
            'nationality: formData.nationality,',
          ),
      );
    },
    expect: 'flat `quoteData.nationality` is forbidden',
  },
];

async function main() {
  let failed = 0;
  for (const scenario of SCENARIOS) {
    const cwd = await makeClone();
    try {
      await scenario.apply(cwd);
      await assertCatches(scenario.name, cwd, scenario.expect);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${scenario.name}: ${err.message}`);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  }
  if (failed === 0) {
    console.log(
      `\n[contracts-product-consistency.test] OK — ${SCENARIOS.length} synthetic drift scenarios all caught.`,
    );
    process.exit(0);
  } else {
    console.error(
      `\n[contracts-product-consistency.test] FAIL — ${failed}/${SCENARIOS.length} synthetic drift scenarios slipped through the guard.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[contracts-product-consistency.test] unexpected error:', err);
  process.exit(2);
});
