import type { RequestHandler } from 'express';
import type { PlatformTenantAccess } from '../../modules/platformTenants/index.js';

type AccessResolver = (userId: string, tenantSlug: string) => Promise<PlatformTenantAccess>;

/** Verified session selects a tenant; current PostgreSQL membership authorizes it. */
export function createPlatformTenantAccess(resolveAccess: AccessResolver): RequestHandler {
  return async (req, res, next) => {
    const user = req.user;
    const slug = user?.['tenant_slug'];
    if (!user || user['sessionKind'] !== 'tenant' || typeof slug !== 'string' || !slug) {
      res.status(403).json({ success: false, error: { code: 'TENANT_SELECTION_REQUIRED', message: 'Select an authorized MGA workspace.' } });
      return;
    }
    const requestedSlug = req.headers['x-tenant-slug'];
    if (requestedSlug && requestedSlug !== slug) {
      res.status(403).json({ success: false, error: { code: 'TENANT_SESSION_MISMATCH', message: 'This session belongs to another MGA.' } });
      return;
    }
    try {
      const access = await resolveAccess(user.id, slug);
      req.user = {
        ...user,
        role: access.role,
        primaryAccountId: access.accountId,
        operatingTenantId: access.id,
        platformTenantAuthorized: true,
      };
      next();
    } catch {
      res.status(403).json({ success: false, error: { code: 'TENANT_ACCESS_DENIED', message: 'Active membership of this MGA is required.' } });
    }
  };
}
