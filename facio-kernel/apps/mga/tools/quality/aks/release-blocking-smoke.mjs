#!/usr/bin/env node
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const baseUrl = String(process.env.APP_BASE_URL || process.env.AKS_API_BASE_URL || '').replace(/\/$/, '');
const mode = String(process.env.SMOKE_MODE || 'release').trim().toLowerCase();
const artifactPath = String(
  process.env.RELEASE_SMOKE_ARTIFACT_PATH || `/tmp/${mode}-blocking-smoke.json`,
).trim();
const webhookSecret = String(process.env.INBOUND_WEBHOOK_SECRET || '').trim();
const configuredBoToken = String(process.env.SMOKE_BO_TOKEN || '').trim();
const boEmail = String(process.env.SMOKE_BO_EMAIL || '').trim();
const boPassword = String(process.env.SMOKE_BO_PASSWORD || '').trim();
const dryRun = ['1', 'true', 'yes'].includes(String(process.env.RELEASE_SMOKE_DRY_RUN || '').toLowerCase());
const strictAppJourneys = ['1', 'true', 'yes'].includes(
  String(process.env.RELEASE_SMOKE_STRICT_APP_JOURNEYS || (mode === 'release' ? 'true' : 'false')).toLowerCase(),
);
const requestTimeoutMs = Math.max(1000, Number(process.env.RELEASE_SMOKE_REQUEST_TIMEOUT_MS || 15000));
const requestRetryCount = Math.max(1, Number(process.env.RELEASE_SMOKE_RETRY_COUNT || 4));
const requestRetryDelayMs = Math.max(250, Number(process.env.RELEASE_SMOKE_RETRY_DELAY_MS || 2000));

if (!baseUrl) throw new Error('Missing APP_BASE_URL or AKS_API_BASE_URL');
if (!dryRun && !webhookSecret) throw new Error('Missing INBOUND_WEBHOOK_SECRET');

const checks = [];
const startedAt = Date.now();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOnce(url, init = {}) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(new Error(`Request timed out after ${requestTimeoutMs}ms`)), requestTimeoutMs);
  const res = await fetch(url, { ...init, signal: ctrl.signal });
  const bodyText = await res.text();
  let json = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    json = null;
  } finally {
    clearTimeout(timeout);
  }
  return { status: res.status, ok: res.ok, bodyText, json, serverTiming: res.headers.get('server-timing') || '' };
}

function parseServerTimingDuration(serverTiming, metricName) {
  const expectedName = String(metricName || '').trim().toLowerCase();
  for (const segment of String(serverTiming || '').split(',')) {
    const parts = segment.split(';').map((part) => part.trim());
    if (parts[0].toLowerCase() !== expectedName) continue;
    const durationPart = parts.find((part) => part.toLowerCase().startsWith('dur='));
    if (!durationPart) continue;
    const value = Number(durationPart.slice('dur='.length));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function backendDurationMs(res) {
  const appDuration = parseServerTimingDuration(res.serverTiming, 'app');
  if (appDuration === null) {
    throw new Error('Missing Server-Timing app duration for backend latency check');
  }
  return appDuration;
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function request(url, init = {}) {
  const start = Date.now();
  let lastError = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= requestRetryCount; attempt += 1) {
    try {
      const response = await requestOnce(url, init);
      const details = {
        ...response,
        durationMs: Date.now() - start,
        attempts: attempt,
      };
      if (attempt < requestRetryCount && isRetryableStatus(response.status)) {
        lastResponse = details;
        await wait(requestRetryDelayMs * attempt);
        continue;
      }
      return details;
    } catch (error) {
      lastError = error;
      if (attempt >= requestRetryCount) {
        break;
      }
      await wait(requestRetryDelayMs * attempt);
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'request failed'));
}

async function runCheck(name, fn, { blocking = true } = {}) {
  const start = Date.now();
  try {
    const details = await fn();
    checks.push({ name, blocking, status: 'passed', durationMs: Date.now() - start, details });
  } catch (error) {
    checks.push({
      name,
      blocking,
      status: blocking ? 'failed' : 'warning',
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
    if (blocking) {
      throw error;
    }
  }
}

async function runCheckDryAware(name, fn) {
  if (dryRun) {
    checks.push({ name, blocking: true, status: 'simulated', durationMs: 0, details: { dryRun: true } });
    return;
  }
  return runCheck(name, fn);
}

async function runAppJourneyCheck(name, fn) {
  if (dryRun) {
    checks.push({ name, blocking: strictAppJourneys, status: 'simulated', durationMs: 0, details: { dryRun: true } });
    return;
  }
  return runCheck(name, fn, { blocking: strictAppJourneys });
}

function signWebhook(payload, timestamp) {
  return crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${JSON.stringify(payload)}`)
    .digest('hex');
}

async function resolveBoToken() {
  if (boEmail && boPassword) {
    const res = await request(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: boEmail, password: boPassword }),
    });
    if (!res.ok) throw new Error(`BO smoke login failed (${res.status})`);
    const token = String(res.json?.data?.token || '').trim();
    if (!token) throw new Error(`BO smoke login response missing token (${res.status})`);
    return { token, source: 'login' };
  }

  if (configuredBoToken) {
    return { token: configuredBoToken, source: 'static-token' };
  }

  throw new Error('Missing SMOKE_BO_EMAIL/SMOKE_BO_PASSWORD or SMOKE_BO_TOKEN');
}

async function runQuoteBindIssueSmoke() {
  await new Promise((resolve, reject) => {
    const child = spawn('node', ['tools/quality/aks/quote-bind-issue-smoke.mjs'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        SMOKE_ARTIFACT_PATH: `/tmp/${mode}-quote-bind-issue.json`,
        APP_BASE_URL: baseUrl,
      },
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`quote-bind smoke failed (${code})`))));
  });
}

async function main() {
  const out = {
    mode,
    baseUrl,
    strictAppJourneys,
    releaseSha: process.env.GITHUB_SHA || process.env.RELEASE_SHA || '',
    startedAt: new Date(startedAt).toISOString(),
    checks,
    passed: false,
  };
  let boToken = '';

  try {
    await runCheckDryAware('bearer-auth-required', async () => {
      const res = await request(`${baseUrl}/api/users/me`);
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
      return { status: res.status };
    });

    await runCheckDryAware('query-token-rejected', async () => {
      const res = await request(`${baseUrl}/api/users/me?token=forbidden-token`);
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
      return { status: res.status };
    });

    await runCheckDryAware('inbound-webhook-invalid-signature-rejected', async () => {
      const payload = { from: 'smoke@example.com', text: 'invalid signature test' };
      const ts = String(Date.now());
      const res = await request(`${baseUrl}/api/webhooks/email/inbound`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-timestamp': ts,
          'x-webhook-signature': 'deadbeef',
        },
        body: JSON.stringify(payload),
      });
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
      return { status: res.status };
    });

    await runCheckDryAware('inbound-webhook-valid-signature-accepted', async () => {
      const payload = { from: 'smoke@example.com', text: 'valid signature test' };
      const ts = String(Date.now());
      const res = await request(`${baseUrl}/api/webhooks/email/inbound`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-timestamp': ts,
          'x-webhook-signature': signWebhook(payload, ts),
        },
        body: JSON.stringify(payload),
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      return { status: res.status };
    });

    await runCheckDryAware('bo-auth-token', async () => {
      const resolved = await resolveBoToken();
      boToken = resolved.token;
      return { source: resolved.source };
    });

    await runAppJourneyCheck('quote-bind-issue', async () => {
      await runQuoteBindIssueSmoke();
      return { artifact: `/tmp/${mode}-quote-bind-issue.json` };
    });

    await runAppJourneyCheck('claims-list-latency-threshold', async () => {
      const threshold = Number(process.env.SMOKE_CLAIMS_P95_MS || 300);
      const url = `${baseUrl}${String(process.env.SMOKE_CLAIMS_URL || '/api/claims?page=1&pageSize=20')}`;
      const res = await request(url, { headers: { authorization: `Bearer ${boToken}` } });
      if (!res.ok) throw new Error(`Claims endpoint failed (${res.status})`);
      const backendMs = backendDurationMs(res);
      if (backendMs > threshold) throw new Error(`Claims backend latency ${backendMs}ms > ${threshold}ms`);
      return { status: res.status, backendDurationMs: backendMs, e2eDurationMs: res.durationMs };
    });

    await runAppJourneyCheck('invoices-list-bounded', async () => {
      const maxBytes = Number(process.env.SMOKE_INVOICES_MAX_BYTES || 200 * 1024);
      const url = `${baseUrl}${String(process.env.SMOKE_INVOICES_URL || '/api/invoices?page=1&pageSize=50')}`;
      const res = await request(url, { headers: { authorization: `Bearer ${boToken}` } });
      if (!res.ok) throw new Error(`Invoices endpoint failed (${res.status})`);
      const bytes = Buffer.byteLength(res.bodyText || '', 'utf8');
      if (bytes > maxBytes) throw new Error(`Invoices payload ${bytes} bytes > ${maxBytes}`);
      return { status: res.status, bytes };
    });

    await runAppJourneyCheck('dashboard-latency-threshold', async () => {
      const threshold = Number(process.env.SMOKE_DASHBOARD_P95_MS || 1000);
      const url = `${baseUrl}${String(process.env.SMOKE_DASHBOARD_URL || '/api/reports/dashboard')}`;
      const res = await request(url, { headers: { authorization: `Bearer ${boToken}` } });
      if (!res.ok) throw new Error(`Dashboard endpoint failed (${res.status})`);
      const backendMs = backendDurationMs(res);
      if (backendMs > threshold) throw new Error(`Dashboard backend latency ${backendMs}ms > ${threshold}ms`);
      return { status: res.status, backendDurationMs: backendMs, e2eDurationMs: res.durationMs };
    });

    out.passed = true;
  } catch (error) {
    out.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    out.finishedAt = new Date().toISOString();
    out.totalDurationMs = Date.now() - startedAt;
    await fs.writeFile(artifactPath, JSON.stringify(out, null, 2), 'utf8');
    console.log(`[release-smoke] artifact written to ${artifactPath}`);
  }
}

main().catch((error) => {
  console.error(`[release-smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
