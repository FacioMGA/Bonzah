import { Router } from 'express';
import { prisma } from '../../platform/db/connection.js';
import { getTenantConfig } from '../../platform/tenant/tenantConfig.js';
import { requirePermission } from '../../modules/accessControl/http/permissionMiddleware.js';

/** Legacy global user mutations cannot change people or roles in another organization. */
export function createPlatformUserDirectory() {
  const router = Router();
  router.get(['/users', '/access-control/users'], requirePermission('users', 'view'), async (req, res, next) => {
    try {
      const memberships = await prisma.platformTenantMembership.findMany({ // guard:cross-tenant-intentional — control-plane membership lookup explicitly scoped by server-authorized tenant below
        where: { operatingTenantId: getTenantConfig().id, active: true }, take: 101,
        include: { user: { select: { id: true, name: true, email: true, firstName: true, lastName: true, phone: true, userType: true, isActive: true, mfaEnabled: true, lastLogin: true, createdAt: true } } },
        orderBy: { userId: 'asc' },
      });
      const data = memberships.slice(0, 100).map(({ user, role }) => ({ ...user, username: user.email, role, accessAssignments: [] }));
      return req.path.startsWith('/access-control')
        ? res.json({ success: true, items: data, hasMore: memberships.length > 100, nextCursor: null })
        : res.json({ success: true, data });
    } catch (error) { return next(error); }
  });
  router.use(['/users', '/access-control'], (req, res, next) => {
    if (req.method === 'GET' && (req.path === '/me' || req.path === '/permissions')) return next();
    return res.status(403).json({ success: false, error: { code: 'PLATFORM_MEMBERSHIP_REQUIRED', message: 'Manage access through this workspace’s platform membership.' } });
  });
  return router;
}
