import { Router } from 'express';
import { prisma } from '../../../platform/db/connection.js';
import { resolveOperatingTenant } from '../../../platform/http/middleware/resolveTenant.js';
import { createMcpJsonRpcRouter } from './mcpJsonRpcRouter.js';

/** A workspace URL locates the key namespace; only its hashed key grants access. */
export function createPlatformMcpRouter(family: 'config' | 'operator') {
  const router = Router();
  router.use(async (req, res, next) => {
    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith('Bearer facio_')) return next('router');
    if (!/^Bearer facio_[a-f0-9]{64}$/.test(authorization)) return res.status(401).json({ error: 'Invalid MCP credential' });
    const query = req.query.workspace;
    const header = req.headers['x-tenant-slug'];
    const slug = query ?? header;
    if (typeof slug !== 'string' || !/^[a-z][a-z0-9-]{1,99}$/.test(slug) || (query && header && query !== header)) {
      return res.status(401).json({ error: 'Use the workspace-specific MCP endpoint issued with this key.' });
    }
    try {
      const tenant = await prisma.tenant.findFirst({ where: { tenantSlug: slug, status: 'ACTIVE',
        parentOrganization: { active: true } }, select: { id: true } });
      if (!tenant) return res.status(401).json({ error: 'MCP credential is unavailable for this workspace.' });
      req.headers['x-tenant-slug'] = slug;
      return resolveOperatingTenant(req, res, next);
    } catch (error) { return next(error); }
  });
  // This existing admission verifies the key against the selected RLS namespace
  // before exposing any tool. A URL or header alone never authorizes an actor.
  router.use(createMcpJsonRpcRouter({ family }));
  return router;
}
