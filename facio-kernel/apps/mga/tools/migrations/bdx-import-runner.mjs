#!/usr/bin/env node
/**
 * BDX import runner — canonical job spine (POST /imports/bdx/dry-run -> commit).
 *
 * Drives the admin-gated job lane registered in
 * `backend/modules/policy/http/importsRouter.ts`:
 *
 *   1. Authenticate (BDX_AUTH_TOKEN or API_SMOKE_EMAIL / API_SMOKE_PASSWORD).
 *   2. POST multipart `file` to `/imports/bdx/dry-run` with productLine + tenantSlug.
 *   3. Poll `/imports/bdx/jobs/:jobId/status` until `ready_for_commit`.
 *   4. If BDX_DRY_RUN=true, print the dry-run summary and exit.
 *   5. Otherwise POST `/imports/bdx/commit` with the dryRunJobId.
 *   6. Poll the commit job until `completed` / `completed_with_failures` / `failed`.
 *   7. Pull `/result` for the final summary; loop again if BDX_COMMIT_LOOPS > 1
 *      (each loop drains up to ~1000 new policies — see bdxImportJobRunner).
 *
 * Required env:
 *   BDX_SOURCE_FILE      Path to the BDX XLSX inside the pod.
 *   BDX_AUTH_TOKEN       Bearer token, OR
 *   API_SMOKE_EMAIL/_PASSWORD  Login credentials for the ADMIN user.
 *
 * Optional env:
 *   BDX_API_BASE_URL     API base URL (default http://abbeygate-abbeygate-api).
 *                        BDX_ENDPOINT is also accepted for backward compat with
 *                        existing K8s wrappers; the legacy /imports/bdx suffix
 *                        is stripped.
 *   BDX_TENANT_SLUG      'abbeygate-cy' | 'abbeygate-pt' (default abbeygate-cy).
 *   BDX_PRODUCT_LINE     'motor' | 'travel' | 'home' (default motor).
 *   BDX_DRY_RUN          'true' to stop after dry-run validation (default false).
 *   BDX_COMMIT_LOOPS     Max number of dry-run+commit cycles (default 1). Each
 *                        commit imports up to ~1000 new policies; set higher
 *                        when re-importing a freshly-wiped staging tenant.
 *   BDX_POLL_INTERVAL_MS Poll cadence for job status (default 5000).
 *   BDX_POLL_TIMEOUT_MS  Per-job poll budget (default 21600000 = 6h).
 *   BDX_REQUEST_TIMEOUT_MS  Per-HTTP-request timeout (default 600000 = 10min).
 */

import fs from 'node:fs';
import path from 'node:path';

const apiBaseUrl = (() => {
  const explicit = String(process.env.BDX_API_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const legacyEndpoint = String(process.env.BDX_ENDPOINT || '').trim();
  if (legacyEndpoint) return legacyEndpoint.replace(/\/api\/policies\/imports\/bdx\/?$/i, '').replace(/\/+$/, '');
  return 'http://abbeygate-abbeygate-api';
})();

const sourceFile = String(process.env.BDX_SOURCE_FILE || '').trim();
const tenantSlug = String(process.env.BDX_TENANT_SLUG || 'abbeygate-cy').trim();
const productLine = String(process.env.BDX_PRODUCT_LINE || 'motor').trim().toLowerCase();
const dryRunOnly = String(process.env.BDX_DRY_RUN || 'false').toLowerCase() === 'true';
const commitLoops = Math.max(1, Number(process.env.BDX_COMMIT_LOOPS || 1));
const pollIntervalMs = Math.max(500, Number(process.env.BDX_POLL_INTERVAL_MS || 5000));
const pollTimeoutMs = Math.max(60_000, Number(process.env.BDX_POLL_TIMEOUT_MS || 6 * 60 * 60 * 1000));
const requestTimeoutMs = Math.max(10_000, Number(process.env.BDX_REQUEST_TIMEOUT_MS || 10 * 60 * 1000));

const TERMINAL_STATUSES = new Set(['ready_for_commit', 'completed', 'completed_with_failures', 'failed', 'cancelled']);
const SUCCESS_DRY_RUN = new Set(['ready_for_commit']);
const SUCCESS_COMMIT = new Set(['completed', 'completed_with_failures']);

function log(line) {
  process.stdout.write(`[bdx-import] ${line}\n`);
}

function logError(line) {
  process.stderr.write(`[bdx-import] ${line}\n`);
}

function abortableFetch(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  // ADR-0019 fail-closed tenancy: internal ClusterIP traffic does not carry
  // a tenant-bearing Host, so the resolver depends on the explicit
  // X-Tenant-Slug header. Add it to every request.
  const headers = { 'x-tenant-slug': tenantSlug, ...(init.headers || {}) };
  return fetch(url, { ...init, headers, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function readJsonOrThrow(resp, contextLabel) {
  const bodyText = await resp.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch (_) {
    throw new Error(`${contextLabel} returned non-JSON (status ${resp.status}): ${bodyText.slice(0, 500)}`);
  }
  if (!resp.ok || (body && body.success === false)) {
    const code = body?.error?.code || `HTTP_${resp.status}`;
    const message = body?.error?.message || resp.statusText || 'request failed';
    throw new Error(`${contextLabel} failed: ${code} — ${message}`);
  }
  return body;
}

async function resolveAuthToken() {
  if (process.env.BDX_AUTH_TOKEN) return String(process.env.BDX_AUTH_TOKEN).trim();
  const email = process.env.API_SMOKE_EMAIL;
  const password = process.env.API_SMOKE_PASSWORD;
  if (!email || !password) {
    throw new Error('Missing BDX_AUTH_TOKEN and fallback API_SMOKE_EMAIL/API_SMOKE_PASSWORD');
  }
  const url = `${apiBaseUrl}/api/auth/login`;
  log(`authenticating against ${url}`);
  const resp = await abortableFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await readJsonOrThrow(resp, 'auth/login');
  const token = body?.data?.token;
  if (!token) throw new Error(`auth/login returned no token: ${JSON.stringify(body).slice(0, 200)}`);
  return String(token);
}

async function postDryRunJob(token) {
  if (!sourceFile) throw new Error('BDX_SOURCE_FILE is required');
  const stat = fs.statSync(sourceFile);
  if (!stat.isFile()) throw new Error(`BDX_SOURCE_FILE is not a regular file: ${sourceFile}`);
  const bytes = fs.readFileSync(sourceFile);
  const form = new FormData();
  form.set(
    'file',
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    path.basename(sourceFile),
  );
  form.set('productLine', productLine);
  form.set('tenantSlug', tenantSlug);
  const url = `${apiBaseUrl}/api/policies/imports/bdx/dry-run`;
  log(`POST ${url} (${path.basename(sourceFile)}, ${(stat.size / 1024).toFixed(1)} KiB, productLine=${productLine}, tenantSlug=${tenantSlug})`);
  const resp = await abortableFetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await readJsonOrThrow(resp, 'imports/bdx/dry-run');
  return String(body?.data?.jobId || '');
}

async function postCommitJob(token, dryRunJobId) {
  const url = `${apiBaseUrl}/api/policies/imports/bdx/commit`;
  log(`POST ${url} (dryRunJobId=${dryRunJobId})`);
  const resp = await abortableFetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ dryRunJobId, approved: true }),
  });
  const body = await readJsonOrThrow(resp, 'imports/bdx/commit');
  return String(body?.data?.jobId || '');
}

async function getJobStatus(token, jobId) {
  const url = `${apiBaseUrl}/api/policies/imports/bdx/jobs/${jobId}/status`;
  const resp = await abortableFetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await readJsonOrThrow(resp, `jobs/${jobId}/status`);
  return body?.data || {};
}

async function getJobLogs(token, jobId) {
  const url = `${apiBaseUrl}/api/policies/imports/bdx/jobs/${jobId}/logs`;
  const resp = await abortableFetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await readJsonOrThrow(resp, `jobs/${jobId}/logs`);
  return Array.isArray(body?.data) ? body.data : [];
}

async function getJobResult(token, jobId) {
  const url = `${apiBaseUrl}/api/policies/imports/bdx/jobs/${jobId}/result`;
  const resp = await abortableFetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
  if (resp.status === 404) return null;
  const body = await readJsonOrThrow(resp, `jobs/${jobId}/result`);
  return body?.data || null;
}

async function pollJobUntilTerminal(token, jobId, label) {
  const startedAt = Date.now();
  let lastReport = '';
  while (true) {
    const status = await getJobStatus(token, jobId);
    const reportLine = `${label} job ${jobId}: status=${status.status} step="${status.currentStep || ''}" rows=${status.processedRows ?? 0}/${status.totalRows ?? '?'} ok=${status.successRows ?? 0} fail=${status.failedRows ?? 0}`;
    if (reportLine !== lastReport) {
      log(reportLine);
      lastReport = reportLine;
    }
    if (TERMINAL_STATUSES.has(String(status.status || ''))) return status;
    if (Date.now() - startedAt > pollTimeoutMs) {
      throw new Error(`${label} job ${jobId} did not reach a terminal status within ${pollTimeoutMs}ms (last status=${status.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

async function dumpFailureLogs(token, jobId, label) {
  try {
    const logs = await getJobLogs(token, jobId);
    if (logs.length === 0) {
      logError(`${label} job ${jobId} reported no log entries`);
      return;
    }
    const failures = logs.filter((entry) => entry.level === 'error');
    const sample = (failures.length > 0 ? failures : logs).slice(0, 20);
    logError(`${label} job ${jobId} log sample (showing ${sample.length} of ${logs.length}):`);
    for (const entry of sample) {
      logError(`  [${entry.level}] ${entry.code}${entry.policyRef ? ` policy=${entry.policyRef}` : ''}${entry.rowNumber ? ` row=${entry.rowNumber}` : ''} — ${entry.message}`);
    }
  } catch (err) {
    logError(`${label} job ${jobId} log fetch failed: ${err.message}`);
  }
}

function summarizeStatus(label, status) {
  log(`${label}: status=${status.status} processed=${status.processedRows ?? 0} success=${status.successRows ?? 0} failed=${status.failedRows ?? 0} step="${status.currentStep || ''}"`);
}

function summarizeResult(label, result) {
  if (!result || typeof result !== 'object') return;
  const s = result.summaryJson || {};
  log(
    `${label} summary: total=${s.totalRows ?? '?'} pass=${s.passRows ?? '?'} fail=${s.failRows ?? '?'} ` +
      `imported=${s.importedRows ?? '?'} alreadyImported=${s.alreadyImportedRows ?? '?'} ` +
      `policyCandidates=${s.policyImportCandidateRows ?? '?'} endorsementReplays=${s.endorsementReplayRows ?? '?'}`,
  );
}

async function runOneCycle(token, cycleIndex) {
  const dryRunJobId = await postDryRunJob(token);
  if (!dryRunJobId) throw new Error('dry-run did not return a jobId');
  const dryRunStatus = await pollJobUntilTerminal(token, dryRunJobId, `dry-run[${cycleIndex}]`);
  summarizeStatus(`dry-run[${cycleIndex}]`, dryRunStatus);
  if (!SUCCESS_DRY_RUN.has(String(dryRunStatus.status || ''))) {
    await dumpFailureLogs(token, dryRunJobId, `dry-run[${cycleIndex}]`);
    throw new Error(`dry-run[${cycleIndex}] did not reach ready_for_commit (status=${dryRunStatus.status})`);
  }
  const dryRunResult = await getJobResult(token, dryRunJobId);
  summarizeResult(`dry-run[${cycleIndex}]`, dryRunResult);

  if (dryRunOnly) {
    log(`BDX_DRY_RUN=true — stopping after dry-run`);
    return { cycleIndex, dryRunJobId, commitJobId: null, committed: 0, terminalStatus: dryRunStatus.status };
  }

  const commitJobId = await postCommitJob(token, dryRunJobId);
  if (!commitJobId) throw new Error('commit did not return a jobId');
  const commitStatus = await pollJobUntilTerminal(token, commitJobId, `commit[${cycleIndex}]`);
  summarizeStatus(`commit[${cycleIndex}]`, commitStatus);
  if (!SUCCESS_COMMIT.has(String(commitStatus.status || ''))) {
    await dumpFailureLogs(token, commitJobId, `commit[${cycleIndex}]`);
    throw new Error(`commit[${cycleIndex}] did not complete (status=${commitStatus.status})`);
  }
  const commitResult = await getJobResult(token, commitJobId);
  summarizeResult(`commit[${cycleIndex}]`, commitResult);
  if (commitStatus.status === 'completed_with_failures') {
    await dumpFailureLogs(token, commitJobId, `commit[${cycleIndex}]`);
  }
  return {
    cycleIndex,
    dryRunJobId,
    commitJobId,
    committed: Number(commitStatus.successRows || 0),
    terminalStatus: commitStatus.status,
  };
}

async function main() {
  log(`apiBaseUrl=${apiBaseUrl}`);
  log(`sourceFile=${sourceFile} productLine=${productLine} tenantSlug=${tenantSlug}`);
  log(`dryRunOnly=${dryRunOnly} commitLoops=${commitLoops}`);
  if (!sourceFile) throw new Error('BDX_SOURCE_FILE is required');
  if (!fs.existsSync(sourceFile)) throw new Error(`BDX_SOURCE_FILE not found: ${sourceFile}`);

  const token = await resolveAuthToken();
  log(`authenticated`);

  const cycles = [];
  for (let i = 1; i <= commitLoops; i += 1) {
    const cycle = await runOneCycle(token, i);
    cycles.push(cycle);
    if (dryRunOnly) break;
    if (cycle.committed === 0) {
      log(`commit[${i}] imported 0 new policies — no further loops needed`);
      break;
    }
  }

  log(`final report:`);
  process.stdout.write(JSON.stringify({ cycles }, null, 2) + '\n');

  const lastCycle = cycles[cycles.length - 1];
  if (!lastCycle) throw new Error('no cycles completed');
  if (dryRunOnly) {
    if (!SUCCESS_DRY_RUN.has(String(lastCycle.terminalStatus || ''))) process.exitCode = 1;
    return;
  }
  if (!SUCCESS_COMMIT.has(String(lastCycle.terminalStatus || ''))) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  logError(`fatal: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
