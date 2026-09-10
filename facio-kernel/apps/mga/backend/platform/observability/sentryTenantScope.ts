/**
 * Express middleware: tag the request's Sentry isolation scope with the
 * operating tenant.
 *
 * Mounted immediately after `resolveOperatingTenant`, so the tenant ALS
 * context is already bound. Setting the tags on the per-request isolation
 * scope means every error captured for this request — including those raised
 * by `Sentry.setupExpressErrorHandler` at the end of the chain — is attributed
 * to the correct territory. The shared backend Sentry project can then be
 * filtered and alerted per tenant (`tenant:abbeygate-cy`) without needing a
 * separate project per territory.
 *
 * This is read-only observability metadata: if no tenant is resolved (the
 * request will fail closed upstream) or Sentry is disabled, it is a no-op.
 */

import type { NextFunction } from 'express';
import * as Sentry from '@sentry/node';

import { getOperatingTenantConfig } from '../tenant/tenantAls.js';

import { getSentryStatus } from './sentry.js';

// This middleware derives everything it needs from the tenant ALS context and
// the Sentry isolation scope; it never reads the request or response. The two
// unused positional params are typed `unknown` rather than Express's
// `Request`/`Response` (whose resolved types are loosely typed and move the
// resolved-type ratchet). `unknown` stays Express-compatible via parameter
// contravariance, so `router.use(sentryTenantScope)` still type-checks.
export function sentryTenantScope(_req: unknown, _res: unknown, next: NextFunction): void {
  if (!getSentryStatus().initialized) return next();
  const tenant = getOperatingTenantConfig();
  if (tenant) {
    const scope = Sentry.getIsolationScope();
    scope.setTag('tenant', tenant.tenantSlug);
    scope.setTag('tenant.country', tenant.countryCode);
  }
  return next();
}
