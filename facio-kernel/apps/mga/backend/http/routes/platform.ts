import { randomUUID } from 'node:crypto';
import { resolveEffectivePermissionKeysForUser } from '../../modules/accessControl/app/permissionService.js';
import { Router, type Request, type Response } from 'express';
import { readActivePlatformSession, mintPlatformToken } from '../../modules/platformIdentity/domain/sessions.js';
import { z } from 'zod';
import { prisma } from '../../platform/db/connection.js';
import { tenantRowToConfig } from '../../platform/tenant/tenantConfigProjection.js';
import { resetResolveTenantCache } from '../../platform/http/middleware/resolveTenant.js';
import {
  PlatformTenantError, platformTenantProfileSchema, provisionPlatformTenantSchema, platformPageSchema,
  type PlatformTenantService, type PlatformTenantView,
} from '../../modules/platformTenants/index.js';

const flatCreate = z.object({ ...provisionPlatformTenantSchema.omit({ profile: true }).shape, ...platformTenantProfileSchema.shape }).strict();
const update = z.object({ expectedVersion: z.number().int().positive(), profile: platformTenantProfileSchema, idempotencyKey: z.string().uuid() }).strict();
const id = z.string().uuid();

async function publicUser(user: Express.UserTokenPayload, role = user.role, accountId: string | null = null) {
  return { id: user.id, email: user['email'], username: user['email'], name: user['name'] || user['email'], role,
    mfaEnabled: user['mfaEnabled'], emailVerifiedAt: user['emailVerifiedAt'], primaryAccountId: accountId, effectivePermissions: await resolveEffectivePermissionKeysForUser(user.id, role) };
}

export function createPlatformRouter(service: PlatformTenantService) {
  const router = Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.user || req.user['sessionKind'] !== 'platform') return res.status(403).json({ success: false, error: { code: 'PLATFORM_SESSION_REQUIRED', message: 'Sign in to Facio Platform to manage workspaces.' } });
    return next();
  });
  const actor = (req: Request) => ({ userId: req.user!.id, correlationId: req.correlationId || randomUUID() });
  const fail = (res: Response, error: unknown) => {
    if (error instanceof z.ZodError) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Review the highlighted workspace fields.', issues: error.issues } });
    if (error instanceof PlatformTenantError) return res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
    return res.status(500).json({ success: false, error: { code: 'PLATFORM_REQUEST_FAILED', message: 'The workspace operation could not be completed.' } });
  };
  async function view(tenant: PlatformTenantView) {
    const row = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    return { ...tenant, displayName: tenant.profile.displayName, accountScopeId: tenant.accountId,
      region: process.env.KERNEL_REGION || 'westeurope',
      profile: { ...tenantRowToConfig(row), ...tenant.profile } };
  }
  router.get('/session', async (req, res) => {
    try {
      const [organizations, tenants] = await Promise.all([service.listOrganizations(req.user!.id), service.listTenants(req.user!.id)]);
      const catalog = organizations.organizations[0] ? await service.listTemplates(req.user!.id, organizations.organizations[0].id) : { templates: [] };
      return res.json({ success: true, data: { user: await publicUser(req.user!), organizations: organizations.organizations,
        tenants: await Promise.all(tenants.tenants.map(view)), templates: catalog.templates,
        region: process.env.KERNEL_REGION || 'westeurope', hasMore: tenants.hasMore || organizations.hasMore, tenantNextCursor: tenants.nextCursor, organizationNextCursor: organizations.nextCursor } });
    } catch (error) { return fail(res, error); }
  });
  router.get('/tenants', async (req, res) => {
    try {
      const result = await service.listTenants(req.user!.id, platformPageSchema.parse(req.query));
      return res.json({ success: true, data: { ...result, tenants: await Promise.all(result.tenants.map(view)) } });
    } catch (error) { return fail(res, error); }
  });
  router.get('/organizations', async (req, res) => {
    try { return res.json({ success: true, data: await service.listOrganizations(req.user!.id, platformPageSchema.parse(req.query)) }); } catch (error) { return fail(res, error); }
  });
  router.get('/organizations/:id/templates', async (req, res) => {
    try { return res.json({ success: true, data: await service.listTemplates(req.user!.id, id.parse(req.params.id)) }); } catch (error) { return fail(res, error); }
  });
  router.post('/tenants', async (req, res) => {
    try {
      const data = flatCreate.parse(req.body);
      const { organizationId, templateId, templateVersion, templateHash, tenantSlug, jurisdiction, currency, idempotencyKey, ...profile } = data;
      const result = await service.provisionTenant(actor(req), { organizationId, templateId, templateVersion, templateHash, tenantSlug, jurisdiction, currency, idempotencyKey, profile });
      return res.status(201).json({ success: true, data: { ...result, tenant: await view(result.tenant) } });
    } catch (error) { return fail(res, error); }
  });
  router.post('/tenants/:id/select', async (req, res) => {
    try {
      const tenantId = id.parse(req.params.id);
      await service.getProfile(req.user!.id, tenantId);
      const row = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const access = await service.resolveAccess(req.user!.id, row.tenantSlug);
      const session = await readActivePlatformSession(prisma, String(req.user!['sessionId'] || ''));
      if (session.userId !== req.user!.id || session.tokenVersion !== req.user!.tokenVersion) throw new Error('Platform session identity mismatch');
      const token = mintPlatformToken(session, access.tenantSlug);
      return res.json({ success: true, data: { token, user: await publicUser(req.user!, access.role, access.accountId),
        tenant: await view(access), accountScopeId: access.accountId } });
    } catch (error) { return fail(res, error); }
  });
  router.get('/tenants/:id/profile', async (req, res) => {
    try {
      const tenantId = id.parse(req.params.id);
      const result = await service.getProfile(req.user!.id, tenantId);
      const row = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      return res.json({ success: true, data: { version: result.version, profile: { ...tenantRowToConfig(row), ...result.profile } } });
    } catch (error) { return fail(res, error); }
  });
  router.patch('/tenants/:id/profile', async (req, res) => {
    try {
      const tenantId = id.parse(req.params.id);
      const result = await service.updateProfile(actor(req), { ...update.parse(req.body), tenantId });
      resetResolveTenantCache();
      const row = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      return res.json({ success: true, data: { version: result.version, profile: { ...tenantRowToConfig(row), ...result.profile } } });
    } catch (error) { return fail(res, error); }
  });
  return router;
}
