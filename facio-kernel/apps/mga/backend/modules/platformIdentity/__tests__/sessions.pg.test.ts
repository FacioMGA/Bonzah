import { randomUUID } from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import type { Server } from 'node:http';
function request(baseUrl: string) {
  const call = (method: string, path: string) => {
    const headers = new Headers(); let body: string | undefined;
    return { send(value: unknown) { body = JSON.stringify(value); headers.set('Content-Type', 'application/json'); return this; }, set(key: string, value: string) { headers.set(key, value); return this; },
      then(resolve: (value: { status: number; headers: Record<string, any>; body: any }) => unknown, reject: (error: unknown) => unknown) {
        return fetch(baseUrl + path, { method, headers, body, redirect: 'manual' }).then(async response => {
          const text = await response.text(); let body: unknown = {}; try { body = JSON.parse(text); } catch { /* Redirect response. */ }
          return { status: response.status, headers: { ...Object.fromEntries(response.headers), 'set-cookie': response.headers.getSetCookie() }, body };
        }).then(resolve, reject);
      } };
  };
  return { get: (path: string) => call('GET', path), post: (path: string) => call('POST', path) };
}
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import { tenantRowToConfig } from '../../../platform/tenant/tenantConfigProjection.js';
import { digest } from '../domain/identity.js';
import { mintPlatformToken, readActivePlatformSession } from '../domain/sessions.js';

const upstream = vi.hoisted(() => ({ email: '', subject: '', calls: 0, entraTenant: '', entraOid: '' }));
vi.mock('../domain/oidc.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../domain/oidc.js')>(),
  oidcProvider: (options: { id: string }) => ({ id: options.id, label: 'Mock verified organization', authorize: (_flow: unknown, state: string) => `https://accounts.example.invalid/authorize?state=${state}`, callback: async () => { upstream.calls++; return { issuer: options.id === 'microsoft' ? `https://login.microsoftonline.com/${upstream.entraTenant}/v2.0` : 'https://accounts.google.com', subject: options.id === 'microsoft' ? upstream.entraOid : upstream.subject, email: options.id === 'microsoft' ? 'untrusted-email@external.invalid' : upstream.email, actorId: 'test', correlationId: 'test' }; } }),
}));

describe.runIf(process.env.PLATFORM_TENANT_PG_TEST === '1')('durable PostgreSQL identity sessions', () => {
  it('claims callback once, pins bearer expiry, revokes logout and rejects role/header tampering and revoked membership', async () => {
    const prisma = new PrismaClient({ log: [] });
    const userId = randomUUID(), tenantId = randomUUID(), accountId = randomUUID(), organizationId = '4a2de0b7-e6e4-4d07-95fb-f997dbe5b937';
    const trackedAuthIds: string[] = [];
    let server: Server | undefined;
    upstream.email = `auth-${userId}@facio.invalid`; upstream.subject = `synthetic-${userId}`; upstream.calls = 0;
    vi.stubEnv('KERNEL_GOOGLE_CLIENT_ID', 'synthetic-client'); vi.stubEnv('KERNEL_GOOGLE_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('KERNEL_PUBLIC_URL', 'http://localhost:4326');
    upstream.entraTenant = randomUUID(); upstream.entraOid = randomUUID();
    vi.stubEnv('KERNEL_ENTRA_CLIENT_ID', 'synthetic-entra-client'); vi.stubEnv('KERNEL_ENTRA_CLIENT_SECRET', 'synthetic-entra-secret');
    vi.stubEnv('KERNEL_ENTRA_TENANT_ID', upstream.entraTenant); vi.stubEnv('KERNEL_WORKSPACE_DOMAIN', 'facio.invalid');
    vi.stubEnv('KERNEL_ENTRA_IDENTITY_BINDINGS', JSON.stringify([{ tenantId: upstream.entraTenant, oid: upstream.entraOid, email: upstream.email }]));
    try {
      await prisma.user.create({ data: { id: userId, email: upstream.email, password: await bcrypt.hash('local-test-password', 4), role: 'UNDERWRITER', isActive: true } });
      await prisma.platformOrganizationMembership.create({ data: { organizationId, userId, role: 'BUILDER' } });
      const { runtimeSettingsForProfile } = await import('../../platformTenants/infra/templates.js');
      const tenant = await prisma.tenant.create({ data: { id: tenantId, tenantSlug: `auth-test-${tenantId}`, parentOrganizationId: organizationId, kind: 'SYNTHETIC', status: 'ACTIVE', countryCode: 'CY', country: 'Cyprus', currency: 'EUR', legalPack: 'cy', iptJson: { flatFee: 0 }, adminFee: 0, publicBaseUrl: 'http://localhost:4326', fromEmail: 'test@example.invalid', defaultBrokerName: 'Auth fixture', priorityCountries: ['Cyprus'], allowedRiskCountries: ['Cyprus'], defaultNationality: 'United Kingdom', defaultDriversLicenseCountry: 'Cyprus', runtimeSettings: runtimeSettingsForProfile({ displayName: 'Auth fixture', legalName: 'Auth fixture', locale: 'en-GB', timeZone: 'UTC', addressLines: ['Synthetic fixture'], declaredRole: 'MGA', contactEmail: 'test@example.invalid', contactPhone: 'Test only' }) } });
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', ${tenantId}, true)`;
        await tx.account.create({ data: { id: accountId, operatingTenantId: tenantId, name: 'Auth fixture', kind: 'INTERNAL' } });
      });
      await prisma.platformTenantMembership.create({ data: { operatingTenantId: tenant.id, userId, accountId, role: 'UNDERWRITER' } });
      const { createPlatformIdentityRouter } = await import('../http/identityRouter.js');
      const { authenticate } = await import('../../../platform/http/middleware/auth.js');
      const { createPlatformTenantAccess } = await import('../../../http/middleware/platformTenantAccess.js');
      const { createPlatformTenantService } = await import('../../platformTenants/index.js');
      const service = createPlatformTenantService({ prisma, publicBaseUrl: 'http://localhost:4326', fromEmail: 'noreply@example.invalid' });
      const { default: peopleRouter } = await import('../../people/http/peopleRouter.js');
      const { loginRouter } = await import('../../auth/http/authRouter/loginRoute.js');
      const app = express(); app.use(express.json()); app.use('/api/auth', loginRouter); app.use(createPlatformIdentityRouter(prisma));
      app.get('/protected', authenticate, (_req, res) => res.json({ ok: true }));
      app.get('/tenant', authenticate, createPlatformTenantAccess((id, slug) => service.resolveAccess(id, slug)), (req, res) => res.json({ role: req.user?.role, accountId: req.user?.['primaryAccountId'] }));
      app.use('/people', authenticate, createPlatformTenantAccess((id, slug) => service.resolveAccess(id, slug)), (_req, _res, next) => runWithOperatingTenant(tenantRowToConfig(tenant), next), peopleRouter);
      server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local test listener');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const passwordLogin = await request(baseUrl).post('/api/auth/login').send({ email: upstream.email, password: 'local-test-password' });
      expect(passwordLogin.status).toBe(200);
      const passwordToken = passwordLogin.body.data.token as string;
      const passwordSessionId = (jwt.verify(passwordToken, process.env.JWT_SECRET!) as jwt.JwtPayload).sessionId as string;
      trackedAuthIds.push(passwordSessionId);
      expect((await readActivePlatformSession(prisma, passwordSessionId)).userId).toBe(userId);
      expect((await request(baseUrl).get('/protected').set('Authorization', `Bearer ${passwordToken}`)).status).toBe(200);
      const login = await request(baseUrl).get('/auth/login?provider=google'); expect(login.status).toBe(303);
      const state = new URL(login.headers.location).searchParams.get('state')!; trackedAuthIds.push(digest(state));
      const flowCookie = String(login.headers['set-cookie'][0]).split(';')[0]!;
      expect((await request(baseUrl).get(`/auth/callback?code=synthetic&state=${state}`).set('Cookie', flowCookie.replace(state, 'bad'))).status).toBe(401);
      const callback = await request(baseUrl).get(`/auth/callback?code=synthetic&state=${state}`).set('Cookie', flowCookie); expect(callback.status).toBe(303);
      expect((await request(baseUrl).get(`/auth/callback?code=synthetic&state=${state}`).set('Cookie', flowCookie)).status).toBe(401);
      expect(upstream.calls).toBe(1);
      const sessionCookie = String(callback.headers['set-cookie'][0]).split(';')[0]!;
      const sessionId = digest(sessionCookie.slice(sessionCookie.indexOf('=') + 1)); trackedAuthIds.push(sessionId);
      const cappedExpiry = new Date(Date.now() + 90_000);
      await prisma.platformAuthEntry.update({ where: { kind_id: { kind: 'session', id: sessionId } }, data: { expiresAt: cappedExpiry } });
      const sessionResponse = await request(baseUrl).get('/api/platform/auth/session').set('Cookie', sessionCookie); expect(sessionResponse.status).toBe(200);
      const token = sessionResponse.body.data.token as string;
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
      expect(decoded.sessionId).toBe(sessionId); expect(decoded.exp).toBeLessThanOrEqual(Math.floor(cappedExpiry.getTime() / 1000));
      expect((await request(baseUrl).get('/protected').set('Authorization', `Bearer ${token}`)).status).toBe(200);
      const durable = await readActivePlatformSession(prisma, sessionId);
      const selected = mintPlatformToken(durable, tenant.tenantSlug);
      const outsider = await prisma.user.findUniqueOrThrow({ where: { email: 'amit@facio.io' }, select: { id: true } });
      const directory = await request(baseUrl).get('/people/staff-directory').set('Authorization', `Bearer ${selected}`);
      expect(directory.status).toBe(200);
      expect(directory.body.data.map((person: { id: string }) => person.id)).toContain(userId);
      expect(directory.body.data.map((person: { id: string }) => person.id)).not.toContain(outsider.id);
      expect((await request(baseUrl).post('/people/diary').set('Authorization', `Bearer ${selected}`).send({ ownerUserId: outsider.id, title: 'Forbidden cross-workspace diary', startAt: new Date().toISOString() })).status).toBe(403);
      expect((await request(baseUrl).post('/people/messages').set('Authorization', `Bearer ${selected}`).send({ toUserIds: [outsider.id], subject: 'Forbidden cross-workspace message', body: 'Synthetic test only' })).status).toBe(403);
      const assertedAdmin = jwt.sign({ ...decoded, role: 'ADMIN', sessionKind: 'tenant', tenant_slug: tenant.tenantSlug }, process.env.JWT_SECRET!, { algorithm: 'HS256' });
      const admitted = await request(baseUrl).get('/tenant').set('Authorization', `Bearer ${assertedAdmin}`); expect(admitted.status).toBe(200); expect(admitted.body.role).toBe('UNDERWRITER');
      expect((await request(baseUrl).get('/tenant').set('Authorization', `Bearer ${selected}`).set('X-Tenant-Slug', 'different-tenant')).status).toBe(403);
      const parts = selected.split('.'); parts[1] = Buffer.from(JSON.stringify({ ...jwt.decode(selected) as object, tenant_slug: 'different-tenant' })).toString('base64url');
      expect((await request(baseUrl).get('/tenant').set('Authorization', `Bearer ${parts.join('.')}`)).status).toBe(401);
      await prisma.platformTenantMembership.update({ where: { operatingTenantId_userId: { operatingTenantId: tenant.id, userId } }, data: { active: false } });
      expect((await request(baseUrl).get('/tenant').set('Authorization', `Bearer ${selected}`)).status).toBe(403);
      expect((await request(baseUrl).get('/api/platform/auth/session').set('Cookie', sessionCookie).set('Origin', 'https://evil.example')).status).toBe(403);
      expect((await request(baseUrl).post('/api/platform/auth/logout').set('Cookie', sessionCookie).set('Origin', 'https://evil.example')).status).toBe(403);
      expect((await request(baseUrl).get('/protected').set('Authorization', `Bearer ${token}`)).status).toBe(200);
      expect((await request(baseUrl).post('/api/platform/auth/logout').set('Cookie', sessionCookie).set('Authorization', `Bearer ${passwordToken}`).set('Origin', 'http://localhost:4326')).status).toBe(200);
      expect((await request(baseUrl).get('/protected').set('Authorization', `Bearer ${passwordToken}`)).status).toBe(401);
      expect((await request(baseUrl).get('/protected').set('Authorization', `Bearer ${token}`)).status).toBe(401);
      expect((await request(baseUrl).get('/tenant').set('Authorization', `Bearer ${selected}`)).status).toBe(401);
      expect((await request(baseUrl).get('/api/platform/auth/session').set('Cookie', sessionCookie)).status).toBe(401);
      // Microsoft accepts only the explicitly verified directory subject; its email
      // claim is deliberately different and cannot choose a different local user.
      const microsoftLogin = await request(baseUrl).get('/auth/login?provider=microsoft');
      expect(microsoftLogin.status).toBe(303);
      const microsoftState = new URL(microsoftLogin.headers.location).searchParams.get('state')!;
      trackedAuthIds.push(digest(microsoftState));
      const microsoftCallback = await request(baseUrl).get(`/auth/callback?code=synthetic&state=${microsoftState}`).set('Cookie', microsoftLogin.headers['set-cookie'][0].split(';')[0]);
      expect(microsoftCallback.status).toBe(303);
      const microsoftCookie = microsoftCallback.headers['set-cookie'][0].split(';')[0];
      trackedAuthIds.push(digest(microsoftCookie.slice(microsoftCookie.indexOf('=') + 1)));
      const microsoftSession = await request(baseUrl).get('/api/platform/auth/session').set('Cookie', microsoftCookie);
      expect(microsoftSession.status).toBe(200); expect(microsoftSession.body.data.user.id).toBe(userId);
      const mappedIdentity = await prisma.platformIdentity.findUniqueOrThrow({ where: { issuer_subject: { issuer: `https://login.microsoftonline.com/${upstream.entraTenant}/v2.0`, subject: upstream.entraOid } } });
      expect(mappedIdentity.userId).toBe(userId); expect(mappedIdentity.email).toBe(upstream.email);
      upstream.entraOid = randomUUID();
      const unknownLogin = await request(baseUrl).get('/auth/login?provider=microsoft');
      const unknownState = new URL(unknownLogin.headers.location).searchParams.get('state')!; trackedAuthIds.push(digest(unknownState));
      expect((await request(baseUrl).get(`/auth/callback?code=synthetic&state=${unknownState}`).set('Cookie', unknownLogin.headers['set-cookie'][0].split(';')[0])).status).toBe(403);
      // Revocation is persisted, not an in-memory cache side effect.
      const reopened = new PrismaClient({ log: [] });
      try { await expect(readActivePlatformSession(reopened, sessionId)).rejects.toMatchObject({ code: 'UNAUTHORIZED' }); } finally { await reopened.$disconnect(); }
    } finally {
      if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
      await prisma.platformAuthEntry.deleteMany({ where: { id: { in: trackedAuthIds } } });
      await prisma.platformIdentity.deleteMany({ where: { userId } });
      await prisma.platformTenantMembership.deleteMany({ where: { userId } });
      await prisma.platformOrganizationMembership.deleteMany({ where: { userId } });
      await prisma.$transaction(async tx => { await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', ${tenantId}, true)`; await tx.account.deleteMany({ where: { id: accountId } }); });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect(); vi.unstubAllEnvs();
    }
  }, 30_000);
});
