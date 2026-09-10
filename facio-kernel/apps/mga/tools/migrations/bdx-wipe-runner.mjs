#!/usr/bin/env node
/**
 * BDX wipe runner — drives `POST /api/policies/imports/bdx/wipe`.
 *
 * Deliberately staging-only: the API endpoint refuses with 403 if the
 * receiving API process has NODE_ENV=production OR if `commit=true` is
 * sent without `ALLOW_DESTRUCTIVE_BDX_WIPE=1` on the API. See
 * docs/operate/bdx-recovery-rules.md for the rule.
 *
 * Required env:
 *   BDX_AUTH_TOKEN           Bearer token, OR
 *   API_SMOKE_EMAIL/_PASSWORD ADMIN login credentials.
 *
 * Optional env:
 *   BDX_API_BASE_URL    API base URL (default http://abbeygate-abbeygate-api).
 *   BDX_TENANT_SLUG     'abbeygate-cy' | 'abbeygate-pt' (default abbeygate-cy).
 *   BDX_PRODUCT_LINE    'motor' | 'travel' | 'home' (default: all products).
 *   BDX_WIPE_COMMIT     'true' to actually delete (default: false → dry-run).
 *   BDX_REQUEST_TIMEOUT_MS  HTTP request timeout (default 600000).
 */

const apiBaseUrl = (() => {
  const explicit = String(process.env.BDX_API_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  return 'http://abbeygate-abbeygate-api';
})();

const tenantSlug = String(process.env.BDX_TENANT_SLUG || 'abbeygate-cy').trim();
const productEnv = String(process.env.BDX_PRODUCT_LINE || '').trim().toUpperCase();
const product = productEnv === 'MOTOR' || productEnv === 'TRAVEL' || productEnv === 'HOME' ? productEnv : null;
const commit = String(process.env.BDX_WIPE_COMMIT || 'false').toLowerCase() === 'true';
const requestTimeoutMs = Math.max(10_000, Number(process.env.BDX_REQUEST_TIMEOUT_MS || 10 * 60 * 1000));

function log(line) {
  process.stdout.write(`[bdx-wipe] ${line}\n`);
}

function logError(line) {
  process.stderr.write(`[bdx-wipe] ${line}\n`);
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

async function postWipe(token) {
  const url = `${apiBaseUrl}/api/policies/imports/bdx/wipe`;
  log(`POST ${url} (tenantSlug=${tenantSlug} product=${product || 'ALL'} commit=${commit})`);
  const resp = await abortableFetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      tenantSlug,
      ...(product ? { product } : {}),
      commit,
    }),
  });
  const body = await readJsonOrThrow(resp, 'imports/bdx/wipe');
  return body?.data || {};
}

async function main() {
  log(`apiBaseUrl=${apiBaseUrl}`);
  log(`tenantSlug=${tenantSlug} product=${product || 'ALL'} commit=${commit}`);

  const token = await resolveAuthToken();
  log(`authenticated`);

  const result = await postWipe(token);

  const totals = result.totals || { total: 0, byProduct: {} };
  const productSummary = Object.entries(totals.byProduct || {})
    .map(([key, count]) => `${String(key).toLowerCase()}=${count}`)
    .join(' ') || '(none)';
  log(`tenant=${result.tenantSlug || tenantSlug} totals: total=${totals.total} ${productSummary}`);

  if (!result.committed) {
    log('dry-run mode — no deletions performed. Set BDX_WIPE_COMMIT=true to apply.');
  } else {
    log(`committed: deleted=${result.deleted ?? 0} failed=${result.failed ?? 0} of total=${totals.total}`);
    if (Array.isArray(result.failures) && result.failures.length > 0) {
      const sample = result.failures.slice(0, 10);
      logError(`failure sample (showing ${sample.length} of ${result.failures.length}):`);
      for (const f of sample) {
        logError(`  policyId=${f.policyId} policyNumber=${f.policyNumber || '?'} error=${f.error}`);
      }
      process.exitCode = 1;
    }
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main().catch((err) => {
  logError(`fatal: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
