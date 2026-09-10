#!/usr/bin/env node
/**
 * Pre-go-live test-data reset runner — drives
 * `POST /api/policies/imports/bdx/test-data-reset` (ADR-0051).
 *
 * Deletes the NON-BDX (untagged) test policies/quotes on a go-live tenant,
 * keeping the imported book. The API endpoint refuses `commit=true` unless the
 * receiving API process has `ALLOW_DESTRUCTIVE_TESTDATA_RESET=1`, enforces the
 * tenant allowlist (cy/pt/gr), and refuses if the tenant has 0 BDX-tagged
 * policies (import-first invariant).
 *
 * Required env:
 *   RESET_AUTH_TOKEN            Bearer token, OR
 *   API_SMOKE_EMAIL/_PASSWORD  ADMIN login credentials.
 *
 * Optional env:
 *   RESET_API_BASE_URL     API base URL (default http://abbeygate-abbeygate-api).
 *   RESET_TENANT_SLUG      'abbeygate-cy' | 'abbeygate-pt' | 'abbeygate-gr' (default abbeygate-cy).
 *   RESET_PRODUCT_LINE     'motor' | 'travel' | 'home' (default: all products).
 *   RESET_COMMIT           'true' to actually delete (default: false → dry-run).
 *   RESET_REQUEST_TIMEOUT_MS  HTTP request timeout (default 600000).
 */

const apiBaseUrl = (() => {
  const explicit = String(process.env.RESET_API_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  return 'http://abbeygate-abbeygate-api';
})();

const tenantSlug = String(process.env.RESET_TENANT_SLUG || 'abbeygate-cy').trim();
const productEnv = String(process.env.RESET_PRODUCT_LINE || '').trim().toUpperCase();
const product = productEnv === 'MOTOR' || productEnv === 'TRAVEL' || productEnv === 'HOME' ? productEnv : null;
const commit = String(process.env.RESET_COMMIT || 'false').toLowerCase() === 'true';
const requestTimeoutMs = Math.max(10_000, Number(process.env.RESET_REQUEST_TIMEOUT_MS || 10 * 60 * 1000));

function log(line) {
  process.stdout.write(`[testdata-reset] ${line}\n`);
}
function logError(line) {
  process.stderr.write(`[testdata-reset] ${line}\n`);
}

function abortableFetch(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  // ADR-0019 fail-closed tenancy: internal ClusterIP traffic carries no
  // tenant-bearing Host, so add the explicit X-Tenant-Slug header.
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
  if (process.env.RESET_AUTH_TOKEN) return String(process.env.RESET_AUTH_TOKEN).trim();
  const email = process.env.API_SMOKE_EMAIL;
  const password = process.env.API_SMOKE_PASSWORD;
  if (!email || !password) {
    throw new Error('Missing RESET_AUTH_TOKEN and fallback API_SMOKE_EMAIL/API_SMOKE_PASSWORD');
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

async function postReset(token) {
  const url = `${apiBaseUrl}/api/policies/imports/bdx/test-data-reset`;
  log(`POST ${url} (tenantSlug=${tenantSlug} product=${product || 'ALL'} commit=${commit})`);
  const resp = await abortableFetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tenantSlug, ...(product ? { product } : {}), commit }),
  });
  const body = await readJsonOrThrow(resp, 'imports/bdx/test-data-reset');
  return body?.data || {};
}

async function main() {
  log(`apiBaseUrl=${apiBaseUrl}`);
  log(`tenantSlug=${tenantSlug} product=${product || 'ALL'} commit=${commit}`);

  const token = await resolveAuthToken();
  log('authenticated');

  const result = await postReset(token);
  const matched = result.matched || { total: 0, byProduct: {}, byStatus: {}, distinctEmails: [] };
  const remainder = result.remainderUntagged || { total: 0, byProductStatus: [] };
  const productSummary = Object.entries(matched.byProduct || {})
    .map(([key, count]) => `${String(key).toLowerCase()}=${count}`)
    .join(' ') || '(none)';
  const statusSummary = Object.entries(matched.byStatus || {})
    .map(([key, count]) => `${key}=${count}`)
    .join(' ') || '(none)';
  log(`bdx-tagged (never touched): ${result.bdxTaggedCount ?? '?'}`);
  log(`MATCHED test-email policies to delete: total=${matched.total} ${productSummary}`);
  log(`  by status: ${statusSummary}`);
  log(`  distinct emails: ${(matched.distinctEmails || []).length}`);
  for (const e of (matched.distinctEmails || []).slice(0, 40)) log(`    ${e.email} (${e.n})`);
  log(`REMAINDER (untagged, non-test email — NOT deleted): total=${remainder.total}`);
  for (const r of (remainder.byProductStatus || [])) log(`    ${r.product}/${r.status}=${r.n}`);

  if (!result.committed) {
    log('dry-run mode — no deletions performed. Set RESET_COMMIT=true to apply.');
  } else {
    log(`committed: deleted=${result.deleted ?? 0} failed=${result.failed ?? 0} of matched=${matched.total}`);
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
