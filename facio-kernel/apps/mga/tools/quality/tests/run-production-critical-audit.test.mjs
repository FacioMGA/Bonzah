import assert from 'node:assert/strict';
import test from 'node:test';

import { isTransientNpmAuditFailure, main, productionAuditArgs } from '../run-production-critical-audit.mjs';

test('uses a bounded transport timeout while keeping the audit mandatory', () => {
  assert.deepEqual(productionAuditArgs, [
    'audit',
    '--omit=dev',
    '--audit-level=critical',
    '--fetch-timeout=60000',
    '--fetch-retries=0',
  ]);
});

test('retries only a transient npm advisory registry failure', () => {
  assert.equal(
    isTransientNpmAuditFailure({
      status: 1,
      stderr: 'npm error audit endpoint returned an error\nnpm error 503 Service Unavailable - POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',
    }),
    true,
  );
});

test('retries an npm audit network timeout from the advisory endpoint', () => {
  assert.equal(
    isTransientNpmAuditFailure({
      status: 1,
      stderr: 'npm warn audit network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk\nnpm error audit endpoint returned an error',
    }),
    true,
  );
});

test('retries any transient 5xx response from the advisory endpoint', () => {
  assert.equal(
    isTransientNpmAuditFailure({
      status: 1,
      stderr: 'npm error audit endpoint returned an error\\nnpm error 500 Internal Server Error - POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',
    }),
    true,
  );
});

test('does not retry an actual critical vulnerability result', () => {
  assert.equal(
    isTransientNpmAuditFailure({
      status: 1,
      stdout: JSON.stringify({ metadata: { vulnerabilities: { critical: 1 } } }),
      stderr: 'npm error code 1',
    }),
    false,
  );
});

test('does not retry an unrelated npm failure', () => {
  assert.equal(
    isTransientNpmAuditFailure({ status: 1, stderr: 'npm error code EINVALIDTAGNAME' }),
    false,
  );
});

test('retries a transient audit endpoint failure and preserves a later success', async () => {
  let runs = 0;
  const status = await main({
    run: () => {
      runs += 1;
      if (runs === 1) {
        return {
          status: 1,
          stdout: '',
          stderr: 'npm error audit endpoint returned an error\nnpm error 503 Service Unavailable - POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk\n',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    sleepFor: async () => {},
  });

  assert.equal(status, 0);
  assert.equal(runs, 2);
});
