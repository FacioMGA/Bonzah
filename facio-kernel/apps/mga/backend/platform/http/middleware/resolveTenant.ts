/**
 * resolveOperatingTenant middleware
 *
 * Resolves which MGA/jurisdiction tenant is operating on this request and binds
 * the corresponding TenantConfig into the per-request AsyncLocalStorage context.
 * All downstream calls to getTenantConfig() within the same request automatically
 * return the correct jurisdiction-scoped values.
 *
 * Resolution order (first truthy value wins):
 *   1. JWT claim `tenant_slug` on req.user  (requires authenticate to have run first)
 *   2. Request header `X-Tenant-Slug`
 *   3. Request host explicitly registered by this deployment
 *   4. Env var `TENANT_SLUG`                (single-tenant deployment slug-resolution
 *                                            convenience, NOT an env-singleton fallback;
 *                                            absence in production manifests is fine —
 *                                            requests then fail closed per ADR-0019)
 *
 * The resolved Tenant row is cached for 60 seconds to avoid per-request DB hits.
 *
 * Per ADR-0019, this middleware is the **only** path that can establish the
 * tenant ALS context for HTTP requests. When it cannot resolve a tenant the
 * request fails closed (`403 TENANT_UNRESOLVED` / `404 TENANT_UNKNOWN`); we
 * never seed the ALS with a deployment-default singleton.
 */

import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../../db/connection.js';
import { runWithOperatingTenant } from '../../tenant/tenantAls.js';
import type { TenantConfig } from '../../tenant/tenantConfig.js';
import { tenantRowToConfig } from '../../tenant/tenantConfigProjection.js';
import { TenantConfigurationIncompleteError } from '../../tenant/tenantRuntimeSettings.js';
import { logger } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// 60-second TTL cache  (simple Map; no external dep required)
// ---------------------------------------------------------------------------

type CacheEntry = { config: TenantConfig; expiresAt: number };
const CACHE_TTL_MS = 60_000;
const _cache = new Map<string, CacheEntry>();

function cacheGet(slug: string): TenantConfig | null {
  const entry = _cache.get(slug);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(slug);
    return null;
  }
  return entry.config;
}

function cacheSet(slug: string, config: TenantConfig): void {
  _cache.set(slug, { config, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Flush the in-process cache (for tests). */
export function resetResolveTenantCache(): void {
  _cache.clear();
}

// ---------------------------------------------------------------------------
// DB → TenantConfig conversion
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Slug resolution
// ---------------------------------------------------------------------------

/** Explicit deployment-owned host routes. No suffix inference or customer host fallback. */
function hostTenantRoutes(): Readonly<Record<string, string>> {
  const raw = process.env.KERNEL_TENANT_HOST_ROUTES_JSON;
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const routes: Record<string, string> = {};
    for (const [host, slug] of Object.entries(value)) {
      if (!/^[a-z0-9.-]+$/.test(host) || typeof slug !== 'string' || !/^[a-z][a-z0-9-]{1,99}$/.test(slug)) throw new Error();
      routes[host] = slug;
    }
    return routes;
  } catch { throw new TenantConfigurationIncompleteError('KERNEL_TENANT_HOST_ROUTES_JSON'); }
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeHost(rawHost: string | null): string | null {
  if (!rawHost) return null;
  const firstHost = rawHost.split(',')[0]?.trim().toLowerCase();
  if (!firstHost) return null;
  return firstHost.replace(/:\d+$/, '');
}

function resolveSlugFromHost(req: Request): string | null {
  const directHost = firstHeaderValue(req.headers.host);
  const host = normalizeHost(directHost);
  if (!host) return null;
  return hostTenantRoutes()[host] ?? null;
}

function resolveSlug(req: Request): string | null {
  // 1. JWT claim (authenticate middleware must have run before this for auth'd routes)
  const fromJwt = req.user?.['tenant_slug'];
  if (typeof fromJwt === 'string' && fromJwt.length > 0) return fromJwt;

  // 2. Explicit header (useful for multi-tenant BO switcher, synthops, tests)
  const fromHeader = req.headers['x-tenant-slug'];
  if (typeof fromHeader === 'string' && fromHeader.length > 0) return fromHeader;

  // 3. Host-based site resolution. Normal CY/PT staging traffic should not
  // rely on frontend callers remembering an explicit tenant header.
  const fromHost = resolveSlugFromHost(req);
  if (fromHost) return fromHost;

  // 4. Process-wide env var (single-tenant deployments / local dev)
  const fromEnv = process.env.TENANT_SLUG;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;

  return null;
}

// ---------------------------------------------------------------------------
// DB lookup with 60 s LRU cache
// ---------------------------------------------------------------------------

export async function loadTenantConfig(slug: string): Promise<TenantConfig | null> {
  const cached = cacheGet(slug);
  if (cached) return cached;

  try {
    const row = await prisma.tenant.findUnique({ where: { tenantSlug: slug } });
    if (!row) {
      logger.warn({ tenantSlug: slug }, 'resolveOperatingTenant: unknown tenant slug');
      return null;
    }
    if (row.status !== 'ACTIVE') return null;
    const config = tenantRowToConfig(row);
    cacheSet(slug, config);
    return config;
  } catch (err) {
    logger.error({ err, tenantSlug: slug }, 'resolveOperatingTenant: DB lookup failed');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------

/** Express error type with a numeric `status` field — picked up by the global error handler. */
class TenantHttpError extends Error {
  readonly status: number;
  readonly code: 'TENANT_UNRESOLVED' | 'TENANT_UNKNOWN';
  constructor(code: 'TENANT_UNRESOLVED' | 'TENANT_UNKNOWN', status: number, message: string) {
    super(message);
    this.name = 'TenantHttpError';
    this.code = code;
    this.status = status;
  }
}

export async function resolveOperatingTenant(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const slug = resolveSlug(req);

  if (!slug) {
    // ADR-0019: fail closed. No env-singleton fallback. Operators set
    // X-Tenant-Slug, deploy on a tenant-aware host, or use a JWT with a
    // tenant_slug claim. Single-tenant local-dev sets TENANT_SLUG in the
    // shell, which is read inside `resolveSlug` step 4.
    logger.warn(
      { path: req.path, host: req.headers.host },
      'resolveOperatingTenant: no tenant slug resolved — failing closed',
    );
    return next(
      new TenantHttpError(
        'TENANT_UNRESOLVED',
        403,
        'TENANT_UNRESOLVED: no tenant slug resolved from JWT/header/host/env. ' +
          'Production traffic must hit a tenant-aware host or include X-Tenant-Slug.',
      ),
    );
  }

  const config = await loadTenantConfig(slug);
  if (!config) {
    // ADR-0019: unknown slug fails closed rather than running on the
    // deployment-default tenant.
    logger.warn({ tenantSlug: slug }, 'resolveOperatingTenant: slug not found in DB — failing closed');
    return next(
      new TenantHttpError(
        'TENANT_UNKNOWN',
        404,
        `TENANT_UNKNOWN: slug "${slug}" is not a known tenant.`,
      ),
    );
  }

  return runWithOperatingTenant(config, () => next());
}
