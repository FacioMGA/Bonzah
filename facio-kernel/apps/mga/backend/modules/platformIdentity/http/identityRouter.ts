import { readEntraBindings, invitedEmail } from '../domain/invitationBinding.js';
import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { getClientIpForRateLimit } from '../../../platform/http/middleware/rateLimit.js';
import { resolveEffectivePermissionKeysForUser } from '../../accessControl/app/permissionService.js';
import { createPlatformSession, readActivePlatformSession, mintPlatformToken, platformSessionCookie } from '../domain/sessions.js';
import { z } from 'zod';
import { newLoginFlow, oidcProvider, type LoginFlow, type IdentityProvider } from '../domain/oidc.js';
import { digest, secret, IdentityError, type Principal } from '../domain/identity.js';

const SESSION_MS = 8 * 60 * 60 * 1000;
const FLOW_MS = 10 * 60 * 1000;
const flowBody = z.object({ provider: z.string(), nonce: z.string(), verifier: z.string() });

function cookieValue(header: string | undefined, name: string): string | undefined {
  const values = (header ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(name + '='));
  return values.length === 1 ? values[0]!.slice(name.length + 1) : undefined;
}

/** Existing Kernel PKCE/JWKS identity verification, now backed entirely by PostgreSQL. */
export function createPlatformIdentityRouter(prisma: PrismaClient) {
  const router = Router();
  router.use(['/auth/login', '/auth/callback', '/api/platform/auth/session', '/api/platform/auth/logout'], rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, keyGenerator: getClientIpForRateLimit, handler: (_req, res) => { res.status(429).json({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many sign-in requests. Try again shortly.' } }); } }));
  let lastCleanup = 0;
  async function cleanupExpiredEntries() {
    if (Date.now() - lastCleanup < 60_000) return;
    lastCleanup = Date.now();
    const before = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await prisma.platformAuthEntry.findMany({ where: { expiresAt: { lt: before } }, orderBy: { expiresAt: 'asc' }, take: 1000, select: { kind: true, id: true } });
    if (rows.length) await prisma.platformAuthEntry.deleteMany({ where: { OR: rows, expiresAt: { lt: before } } });
  }
  const publicUrl = new URL(process.env.KERNEL_PUBLIC_URL || process.env.KERNEL_PUBLIC_BASE_URL || 'http://localhost:4326');
  const secure = publicUrl.protocol === 'https:';
  if (process.env.NODE_ENV === 'production' && !secure) throw new Error('Platform identity requires HTTPS');
  const sessionCookieName = secure ? '__Host-facio_platform_session' : 'facio_platform_session_dev';
  const flowCookieName = secure ? '__Host-facio_platform_login' : 'facio_platform_login_dev';
  const providers: IdentityProvider[] = [];
  const entraBindings = readEntraBindings(process.env);
  const workspaceDomain = process.env.KERNEL_WORKSPACE_DOMAIN || 'facio.io';
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) throw new Error('Platform JWT_SECRET must contain at least 32 characters');

  if (process.env.KERNEL_GOOGLE_CLIENT_ID && process.env.KERNEL_GOOGLE_CLIENT_SECRET) {
    providers.push(oidcProvider({ id: 'google', clientId: process.env.KERNEL_GOOGLE_CLIENT_ID,
      clientSecret: process.env.KERNEL_GOOGLE_CLIENT_SECRET, publicUrl: publicUrl.origin, workspaceDomain }));
  }
  if (process.env.KERNEL_ENTRA_CLIENT_ID && process.env.KERNEL_ENTRA_CLIENT_SECRET && process.env.KERNEL_ENTRA_TENANT_ID) {
    providers.push(oidcProvider({ id: 'microsoft', clientId: process.env.KERNEL_ENTRA_CLIENT_ID,
      clientSecret: process.env.KERNEL_ENTRA_CLIENT_SECRET, tenantId: process.env.KERNEL_ENTRA_TENANT_ID,
      publicUrl: publicUrl.origin, workspaceDomain }));
  }
  const cookie = (name: string, value: string, maxAgeMs: number) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`;
  const sendError = (res: Response, error: unknown) => {
    const known = error instanceof IdentityError;
    return res.status(known ? error.status : 500).json({ success: false, error: {
      code: known ? error.code : 'SIGN_IN_FAILED',
      message: known ? error.message : 'Organization sign-in could not be completed. Please try again.',
    } });
  };

  async function admittedUser(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.isActive || user.suspendedAt || user.role === 'CUSTOMER') throw new IdentityError('SIGN_IN_DENIED', 'This account is not active.', 403);
    const membership = await prisma.platformOrganizationMembership.findFirst({
      where: { userId, active: true, organization: { active: true } }, select: { userId: true },
    });
    if (!membership) throw new IdentityError('SIGN_IN_DENIED', 'A platform organization invitation is required.', 403);
    return user;
  }

  async function bindIdentity(principal: Principal) {
    const existing = await prisma.platformIdentity.findUnique({
      where: { issuer_subject: { issuer: principal.issuer, subject: principal.subject } },
    });
    if (existing) return admittedUser(existing.userId);
    // Google uses verified Workspace email; Entra requires an exact trusted oid mapping.
    const email = invitedEmail(principal, entraBindings);
    if (!email) {
      throw new IdentityError('IDENTITY_NOT_LINKED', 'An administrator must link this organization identity.', 403);
    }
    const invited = await prisma.user.findUnique({ where: { email } });
    if (!invited) throw new IdentityError('SIGN_IN_DENIED', 'A platform organization invitation is required.', 403);
    const user = await admittedUser(invited.id);
    const linked = await prisma.platformIdentity.findUnique({ where: { userId_issuer: { userId: user.id, issuer: principal.issuer } } });
    if (linked && linked.subject !== principal.subject) throw new IdentityError('IDENTITY_CONFLICT', 'This invitation is already linked to another identity.', 403);
    try {
      await prisma.platformIdentity.create({ data: { issuer: principal.issuer, subject: principal.subject, userId: user.id, email } });
    } catch {
      const raced = await prisma.platformIdentity.findUnique({ where: { issuer_subject: { issuer: principal.issuer, subject: principal.subject } } });
      if (raced?.userId !== user.id) throw new IdentityError('IDENTITY_CONFLICT', 'The organization identity could not be linked.', 403);
    }
    return user;
  }

  router.get('/api/platform/auth/config', (_req, res) => res.json({ success: true, data: {
    providers: providers.map(({ id, label }) => ({ id, label })),
    passwordLoginEnabled: process.env.KERNEL_PASSWORD_LOGIN_ENABLED === 'true',
  } }));

  router.get('/auth/login', async (req, res) => {
    try {
      const provider = providers.find(item => item.id === req.query.provider);
      if (!provider) throw new IdentityError('IDENTITY_PROVIDER_UNAVAILABLE', 'Choose an available organization sign-in provider.', 400);
      await cleanupExpiredEntries();
      const state = secret();
      const flow = newLoginFlow(provider.id);
      await prisma.platformAuthEntry.create({ data: { kind: 'login', id: digest(state), body: flow, expiresAt: new Date(Date.now() + FLOW_MS) } });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Set-Cookie', cookie(flowCookieName, state, FLOW_MS));
      return res.redirect(303, provider.authorize(flow, state));
    } catch (error) { return sendError(res, error); }
  });

  router.get('/auth/callback', async (req, res) => {
    try {
      const query = z.object({ code: z.string().min(1).max(10000), state: z.string().min(32).max(200) }).safeParse(req.query);
      if (!query.success || cookieValue(req.headers.cookie, flowCookieName) !== query.data.state) {
        throw new IdentityError('SIGN_IN_FAILED', 'The sign-in state is invalid. Start sign-in again.', 401);
      }
      const id = digest(query.data.state);
      const row = await prisma.$transaction(async tx => {
        const claimed = await tx.platformAuthEntry.updateMany({ where: { kind: 'login', id, consumed: false, expiresAt: { gt: new Date() } }, data: { consumed: true } });
        if (claimed.count !== 1) throw new IdentityError('SIGN_IN_EXPIRED', 'Start sign-in again.', 401);
        return tx.platformAuthEntry.findUniqueOrThrow({ where: { kind_id: { kind: 'login', id } } });
      });
      const flow: LoginFlow = flowBody.parse(row.body);
      const provider = providers.find(item => item.id === flow.provider);
      if (!provider) throw new IdentityError('IDENTITY_PROVIDER_UNAVAILABLE', 'The sign-in provider is unavailable.', 503);
      const user = await bindIdentity(await provider.callback(query.data.code, flow));
      const session = await createPlatformSession(prisma, user);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Set-Cookie', [platformSessionCookie(session.key, SESSION_MS), cookie(flowCookieName, '', 0)]);
      return res.redirect(303, '/workspaces');
    } catch (error) { return sendError(res, error); }
  });

  async function readSession(req: Request) {
    const token = cookieValue(req.headers.cookie, sessionCookieName);
    if (!token) throw new IdentityError('UNAUTHORIZED', 'Sign in to Facio Platform.', 401);
    const session = await readActivePlatformSession(prisma, digest(token));
    const user = await admittedUser(session.userId);
    if (user.tokenVersion !== session.tokenVersion) throw new IdentityError('UNAUTHORIZED', 'Your session has been revoked.', 401);
    return { user, session };
  }

  router.get('/api/platform/auth/session', async (req, res) => {
    try {
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== publicUrl.origin)) throw new IdentityError('FORBIDDEN', 'Open Facio Platform directly.', 403);
      const { user, session } = await readSession(req);
      const token = mintPlatformToken(session);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ success: true, data: { token, user: {
        id: user.id, email: user.email, username: user.email, name: user.name || user.email, role: user.role,
        mfaEnabled: user.mfaEnabled, emailVerifiedAt: user.emailVerifiedAt, primaryAccountId: null, effectivePermissions: await resolveEffectivePermissionKeysForUser(user.id, user.role),
      } } });
    } catch (error) { return sendError(res, error); }
  });

  router.post('/api/platform/auth/logout', async (req, res) => {
    try {
      if (req.headers.origin !== publicUrl.origin) throw new IdentityError('FORBIDDEN', 'Invalid sign-out origin.', 403);
      const token = cookieValue(req.headers.cookie, sessionCookieName);
      const sessionIds = new Set<string>(token ? [digest(token)] : []);
      if (req.headers.authorization?.startsWith('Bearer ')) {
        try {
          const bearer = jwt.verify(req.headers.authorization.slice(7), jwtSecret, { algorithms: ['HS256'] });
          if (typeof bearer === 'object' && typeof bearer.sessionId === 'string' && /^[a-f0-9]{64}$/.test(bearer.sessionId)) sessionIds.add(bearer.sessionId);
        } catch { /* An expired bearer must not prevent revocation of the valid browser cookie. */ }
      }
      if (sessionIds.size) await prisma.platformAuthEntry.updateMany({ where: { kind: 'session', id: { in: [...sessionIds] } }, data: { consumed: true } });
      res.setHeader('Set-Cookie', cookie(sessionCookieName, '', 0));
      return res.json({ success: true });
    } catch (error) { return sendError(res, error); }
  });
  return router;
}
