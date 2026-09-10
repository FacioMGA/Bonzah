#!/usr/bin/env node
// tools/quality/__tests__/check-no-deleted-identifiers.test.mjs
//
// Self-test for `guard:no-deleted-identifiers`.
//
// We assert two things:
//   1. The guard fails (non-zero exit) when a fixture file contains every
//      banned identifier from `tools/quality/deleted-identifiers.json`.
//   2. The current production tree passes the guard (so this test cannot
//      mask a regression in the guard JSON itself).
//
// (1) prevents a silent regression where a regex in the JSON gets
// rewritten in a way that no longer matches the thing it was supposed to
// catch. (2) prevents the test from going green just because the regex is
// always-false.
//
// No test framework — plain Node, same shape as
// check-contracts-product-consistency.test.mjs.

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPatterns, runDeletedIdentifiersCheck } from '../check-no-deleted-identifiers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GUARD_REL = 'tools/quality/check-no-deleted-identifiers.mjs';

let failures = 0;

function expect(cond, message) {
  if (cond) {
    console.log(`  ok  ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${message}`);
  }
}

function buildFixtureContent(patterns) {
  const lines = [
    '// __sentinel-fixture__.ts',
    '// Synthetic fixture used by the no-deleted-identifiers guard self-test.',
    '// Every line below is intentionally a banned pattern.',
    '',
  ];
  for (const p of patterns) {
    lines.push(`// id=${p.id}`);
    lines.push(synthesizeMatchFor(p.regex.source));
    lines.push('');
  }
  return lines.join('\n');
}

// Produce a string guaranteed to match the regex. The patterns we use are
// either literal substrings or use trivial char classes / escaped chars,
// so a small synthesizer is enough; if a future pattern needs a richer
// generator, switch to a real regex synthesiser.
function synthesizeMatchFor(source) {
  const samples = {
    'generateUMR|policyNumberGenerator':
      "const umr = await generateUMR();",
    'runWithOperatingTenant\\(\\s*getTenantConfig\\(\\)':
      'runWithOperatingTenant(getTenantConfig())',
    'process\\.env\\.TENANT_SLUG':
      "const slug = process.env.TENANT_SLUG;",
    'STRICT_BINDER_PRODUCT_AUTHORITY':
      "const flag = process.env.STRICT_BINDER_PRODUCT_AUTHORITY;",
    'STRICT_PERMISSION_ENFORCEMENT':
      "const flag = process.env.STRICT_PERMISSION_ENFORCEMENT;",
    'synthetic-nonstrict':
      "return { authorityId: 'synthetic-nonstrict' };",
    'FALLBACK_POLICY_LIST_REGISTRY':
      "raw = FALLBACK_POLICY_LIST_REGISTRY;",
    'QUOTE_TOKEN_SECRET[^;]*\\|\\|[^;]*JWT_SECRET|JWT_SECRET[^;]*\\|\\|[^;]*QUOTE_TOKEN_SECRET':
      'const secret = process.env.QUOTE_TOKEN_SECRET || process.env.JWT_SECRET;',
    '__electricEngineSizeNormalized':
      "policy.__electricEngineSizeNormalized = true;",
    '__electricEngineSizeNormalized':
      "policy.__electricEngineSizeNormalized = true;",
    'home\\/pricing\\/homeRateCards':
      "from '../home/pricing/homeRateCards.js'",
    'PAYMENT_INDEMNITY':
      "eventType: 'PAYMENT_INDEMNITY'",
    'PAYMENT_FEES':
      "eventType: 'PAYMENT_FEES'",
  };
  if (samples[source]) return samples[source];
  // Fallback: try a string that literally matches the regex source after
  // unescaping common metacharacters.
  return source
    .replace(/\\([().\][{}|+*?$^\\])/g, '$1')
    .replace(/\\s\*/g, ' ')
    .replace(/\\s\+/g, ' ')
    .replace(/\\b/g, '');
}

async function injectFixtureAndRun(patterns) {
  // Write the fixture into a tmp directory so its path does NOT match
  // any allowedPaths prefix in the JSON — otherwise the guard would skip
  // the fixture and the self-test would silently green.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-'));
  const fixtureAbs = path.join(tmpDir, 'sentinel-fixture.ts');
  const content = buildFixtureContent(patterns);
  await fs.writeFile(fixtureAbs, content, 'utf8');
  try {
    // Use the in-process API with the absolute fixture path. The guard
    // resolves absolute paths as-is, and isAllowed() never matches an
    // OS-tmp path against any of our repo-relative allowlists.
    const violations = runDeletedIdentifiersCheck({
      patterns,
      rootDir: REPO_ROOT,
      files: [fixtureAbs],
    });
    return violations;
  } finally {
    await fs.unlink(fixtureAbs).catch(() => undefined);
    await fs.rmdir(tmpDir).catch(() => undefined);
  }
}

(async () => {
  console.log('Test 1 — fixture injection trips the guard');
  const patterns = loadPatterns();
  expect(patterns.length > 0, 'JSON has at least one pattern row');

  const violations = await injectFixtureAndRun(patterns);
  for (const p of patterns) {
    const hits = violations.filter((v) => v.id === p.id);
    expect(hits.length > 0, `pattern '${p.id}' triggers at least one violation in fixture`);
  }

  console.log('');
  console.log('Test 2 — current tree passes the guard');
  const result = spawnSync(process.execPath, [GUARD_REL], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error('Guard stdout:\n' + (result.stdout || ''));
    console.error('Guard stderr:\n' + (result.stderr || ''));
  }
  expect(result.status === 0, 'guard exits 0 against the live tree');

  console.log('');
  if (failures > 0) {
    console.error(`FAILED — ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log('PASSED — no-deleted-identifiers self-test');
})().catch((err) => {
  console.error('self-test crashed:', err);
  process.exit(1);
});
