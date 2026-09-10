#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5_000, 10_000];
const AUDIT_FETCH_TIMEOUT_MS = 60_000;

export const productionAuditArgs = [
  'audit',
  '--omit=dev',
  '--audit-level=critical',
  `--fetch-timeout=${AUDIT_FETCH_TIMEOUT_MS}`,
  '--fetch-retries=0',
];

/**
 * An npm audit must remain fail-closed for audit findings. Retry only the
 * registry transport failure observed in CI, never an audit result.
 */
export function isTransientNpmAuditFailure({ status, stdout = '', stderr = '' }) {
  if (status === 0) return false;

  const output = `${stdout}\n${stderr}`;
  const auditEndpointFailed =
    /audit endpoint returned an error/i.test(output) ||
    /\/npm\/v1\/security\/advisories\/bulk/i.test(output);
  const transientTransportFailure =
    /\b5\d\d\b|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(output) ||
    /npm warn audit network timeout at:/i.test(output);

  return auditEndpointFailed && transientTransportFailure;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runAudit() {
  return spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', productionAuditArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function writeOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

export async function main({ run = runAudit, sleepFor = sleep } = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = run();
    const status = result.status ?? 1;
    const failure = {
      status,
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || ''),
    };

    writeOutput(result);
    if (status === 0) return 0;

    if (!isTransientNpmAuditFailure(failure) || attempt === MAX_ATTEMPTS) {
      return status;
    }

    const delayMs = RETRY_DELAYS_MS[attempt - 1];
    console.warn(
      `[audit-prod-critical] npm advisory registry transport failed; retrying once in ${delayMs / 1000}s (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
    );
    await sleepFor(delayMs);
  }

  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const status = await main();
  process.exitCode = status;
}
