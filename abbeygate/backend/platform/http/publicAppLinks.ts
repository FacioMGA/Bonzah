/**
 * Public app link builders.
 *
 * Resolution order for the public base URL — TENANT FIRST, ENV LAST:
 *   1. Per-request operating-tenant `publicBaseUrl` from ALS
 *      (`getOperatingTenantConfig().publicBaseUrl`). This is the canonical
 *      source for any HTTP request that has been through the
 *      `resolveOperatingTenant` middleware, and for any worker that uses
 *      `runWith{Policy,Binder,...}OperatingTenant`. It always points at
 *      the correct jurisdiction site (e.g. `https://abbeygate-pt.facio.io`
 *      for a Portugal request).
 *   2. Inbound request origin / `x-forwarded-*` host. Also tenant-correct
 *      because the request came from the actual tenant frontend.
 *   3. Process-wide env vars (`PUBLIC_APP_BASE_URL`, `FRONTEND_URL`, …).
 *      Single-tenant deploys, local dev, and CLI scripts use this.
 *   4. Hard-coded localhost fallback.
 *
 * Historical bug (2026-05): step 3 used to be FIRST, so multi-tenant
 * deployments where one set of pods serves several tenants always emitted
 * links pointing to whichever site was baked into env (typically
 * abbeygate-cy), regardless of which tenant the request belonged to. Email
 * recipients on `abbeygate-pt` were sent to `abbeygate-cy` and asked to
 * authenticate — which silently failed. Tenant-first ordering is the
 * fix and MUST stay that way.
 */

import { getOperatingTenantConfig } from '../tenant/tenantAls.js';

type RequestLike = {
  headers?: Record<string, unknown>;
  protocol?: string;
  get?: (name: string) => string | undefined;
};

const DEFAULT_PUBLIC_APP_BASE_URL = 'http://localhost:5173';

function configuredPublicBaseUrl(): string {
  return String(
    process.env.PUBLIC_APP_BASE_URL ||
      process.env.FRONTEND_URL ||
      process.env.APP_URL ||
      process.env.APP_BASE_URL ||
      ''
  ).trim();
}

/**
 * Tenant publicBaseUrl pulled from the per-request ALS context, if any.
 * Returns '' when called outside an operating-tenant scope (CLI, tests,
 * and any worker handler that hasn't yet bound a tenant). Callers must
 * always be prepared for the empty string and fall through to the next
 * source.
 */
function tenantPublicBaseUrl(): string {
  try {
    const cfg = getOperatingTenantConfig();
    return String(cfg?.publicBaseUrl || '').trim();
  } catch {
    return '';
  }
}

export function normalizePublicAppBaseUrl(raw: string, fallback = DEFAULT_PUBLIC_APP_BASE_URL): string {
  const input = String(raw || '').trim() || fallback;
  try {
    const url = new URL(input);
    if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.port === '3000') {
      url.port = '5173';
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return String(input).replace(/\/$/, '');
  }
}

export function resolvePublicAppBaseUrlFromRequest(req: RequestLike): string {
  // 1. Tenant ALS (most authoritative — set by resolveOperatingTenant
  //    middleware and by worker tenant-context wrappers).
  const tenantUrl = tenantPublicBaseUrl();
  if (tenantUrl) return normalizePublicAppBaseUrl(tenantUrl);

  // 2. Inbound request origin / forwarded host. We try each input
  //    independently and only return when one of them yields an actual
  //    host — otherwise fall through to env / localhost. (Don't synthesise
  //    `http://` from an empty host, that's a malformed URL.)
  const originHeader = typeof req.headers?.origin === 'string' ? req.headers.origin.trim() : '';
  if (originHeader) return normalizePublicAppBaseUrl(originHeader);

  const refererHeader = typeof req.headers?.referer === 'string' ? req.headers.referer.trim() : '';
  if (refererHeader) {
    try {
      const refererOrigin = String(new URL(refererHeader).origin || '');
      if (refererOrigin) return normalizePublicAppBaseUrl(refererOrigin);
    } catch {
      // Ignore unparseable Referer.
    }
  }

  const forwardedProtoRaw = req.headers?.['x-forwarded-proto'];
  const forwardedProto = Array.isArray(forwardedProtoRaw) ? forwardedProtoRaw[0] : forwardedProtoRaw;
  const forwardedHostRaw = req.headers?.['x-forwarded-host'];
  const forwardedHost = Array.isArray(forwardedHostRaw) ? forwardedHostRaw[0] : forwardedHostRaw;
  const directHost = String(forwardedHost || req.get?.('host') || '').trim();
  if (directHost) {
    const proto = String(forwardedProto || req.protocol || 'http').trim() || 'http';
    return normalizePublicAppBaseUrl(`${proto}://${directHost}`);
  }

  // 3. Env var fallback (single-tenant deploys, local dev).
  const envUrl = configuredPublicBaseUrl();
  if (envUrl) return normalizePublicAppBaseUrl(envUrl);

  // 4. Hard-coded localhost.
  return normalizePublicAppBaseUrl('');
}

export function resolvePublicAppBaseUrlFromContext(args: { origin?: string; protocol?: string; host?: string }): string {
  // 1. Tenant ALS first — workers running inside a `runWith*OperatingTenant`
  //    scope always have this.
  const tenantUrl = tenantPublicBaseUrl();
  if (tenantUrl) return normalizePublicAppBaseUrl(tenantUrl);

  // 2. Caller-supplied origin / host (used by orchestrators that pass an
  //    explicit context object instead of an Express Request).
  const origin = String(args.origin || '').trim();
  if (origin) return normalizePublicAppBaseUrl(origin);
  const host = String(args.host || '').trim();
  if (host) {
    return normalizePublicAppBaseUrl(`${String(args.protocol || 'http')}://${host}`);
  }

  // 3. Env var fallback.
  const envUrl = configuredPublicBaseUrl();
  if (envUrl) return normalizePublicAppBaseUrl(envUrl);

  // 4. Hard-coded localhost.
  return normalizePublicAppBaseUrl('');
}

/**
 * Background / non-HTTP entry point.
 *
 * Use from worker handlers, scheduled jobs, or any code path that has no
 * Request object and no caller-supplied origin. The result is still
 * tenant-correct so long as the caller is inside a `runWith*OperatingTenant`
 * ALS scope (which all production worker entry points are).
 *
 * Outside an ALS scope, falls back to the env var, then to localhost.
 */
export function resolvePublicAppBaseUrlFromTenant(): string {
  const tenantUrl = tenantPublicBaseUrl();
  if (tenantUrl) return normalizePublicAppBaseUrl(tenantUrl);
  const envUrl = configuredPublicBaseUrl();
  if (envUrl) return normalizePublicAppBaseUrl(envUrl);
  return normalizePublicAppBaseUrl('');
}

function productSlugForPublicQuoteUrl(productType: string): string {
  const normalized = String(productType || '').trim().toUpperCase();
  if (normalized === 'OPEN_MARKET') return 'open-market';
  return normalized.toLowerCase().replace(/_/g, '-');
}

export function buildPublicQuoteUrl(
  baseUrl: string,
  token: string,
  args?: { step?: string; productType?: string },
): string {
  const base = normalizePublicAppBaseUrl(baseUrl);
  const productType = String(args?.productType || '').trim();
  const step = String(args?.step || 'your-quote').trim()
    || 'your-quote';
  const url = new URL(`${base}/quote/${encodeURIComponent(String(token || '').trim())}`);
  if (productType) {
    url.searchParams.set('product', encodeURIComponent(productSlugForPublicQuoteUrl(productType)));
  }
  url.searchParams.set('step', step);
  return url.toString();
}

/**
 * Build the customer-dashboard entry link for a policy-confirmation email.
 *
 * Email OTP is the canonical customer-access boundary: after the recipient
 * proves control of this address, it creates or verifies their customer
 * account and attaches matching unassigned policies.  Do not send these
 * emails to the legacy signup/claim-token route — signup accepts that field
 * but has no policy-linking command behind it.
 */
export function buildPublicDashboardUrl(baseUrl: string, email: string): string {
  const base = normalizePublicAppBaseUrl(baseUrl);
  const customerEmail = String(email || '').trim();
  if (!customerEmail) throw new Error('Customer email is required for a dashboard link');
  const url = new URL(`${base}/verify-email`);
  url.searchParams.set('email', customerEmail);
  url.searchParams.set('redirect', '/client');
  return url.toString();
}

/**
 * Build an authenticated back-office deep link to a policy/quote workspace.
 *
 * Quotes and issued policies share the canonical BO `/policies/:id` workspace;
 * the optional hash selects a tab without changing the durable record target.
 * Callers remain responsible for resolving `baseUrl` from the operating tenant.
 */
export function buildBackOfficePolicyUrl(
  baseUrl: string,
  policyId: string,
  args?: { tab?: string },
): string {
  const base = normalizePublicAppBaseUrl(baseUrl);
  const url = new URL(`${base}/policies/${encodeURIComponent(String(policyId || '').trim())}`);
  const tab = String(args?.tab || '').trim().toLowerCase();
  if (tab) url.hash = tab;
  return url.toString();
}
