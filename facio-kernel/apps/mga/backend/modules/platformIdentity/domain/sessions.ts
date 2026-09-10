import type { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { digest, secret, IdentityError } from './identity.js';

export const PLATFORM_SESSION_MS = 8 * 60 * 60 * 1000;
const sessionSchema = z.object({ userId: z.string().uuid(), tokenVersion: z.number().int().nonnegative() }).strict();
export const platformSessionIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export type SessionIdentity = { userId: string; tokenVersion: number; sessionId: string; expiresAt: Date };
export function platformSessionCookie(key: string, maxAgeMs: number) {
  const origin = new URL(process.env.KERNEL_PUBLIC_URL || process.env.KERNEL_PUBLIC_BASE_URL || 'http://localhost:4326');
  const secure = origin.protocol === 'https:';
  if (process.env.NODE_ENV === 'production' && !secure) throw new Error('Platform identity requires HTTPS');
  return `${secure ? '__Host-facio_platform_session' : 'facio_platform_session_dev'}=${key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}${secure ? '; Secure' : ''}`;
}
export async function createPlatformSession(prisma: PrismaClient, user: { id: string; tokenVersion: number }) {
  const key = secret(), sessionId = digest(key), expiresAt = new Date(Date.now() + PLATFORM_SESSION_MS);
  await prisma.platformAuthEntry.create({ data: { kind: 'session', id: sessionId, body: { userId: user.id, tokenVersion: user.tokenVersion }, expiresAt } });
  return { key, sessionId, expiresAt, userId: user.id, tokenVersion: user.tokenVersion };
}
export async function readActivePlatformSession(prisma: PrismaClient, sessionId: string): Promise<SessionIdentity> {
  if (!platformSessionIdSchema.safeParse(sessionId).success) throw new IdentityError('UNAUTHORIZED', 'Invalid platform session.', 401);
  const row = await prisma.platformAuthEntry.findUnique({ where: { kind_id: { kind: 'session', id: sessionId } } });
  const body = sessionSchema.safeParse(row?.body);
  if (!row || row.consumed || row.expiresAt.getTime() <= Date.now() || !body.success) throw new IdentityError('UNAUTHORIZED', 'Your platform session has expired or been revoked.', 401);
  return { ...body.data, sessionId, expiresAt: row.expiresAt };
}
export function mintPlatformToken(session: SessionIdentity, tenantSlug?: string) {
  const signingSecret = process.env.JWT_SECRET;
  if (!signingSecret || signingSecret.length < 32) throw new Error('Platform JWT_SECRET must contain at least 32 characters');
  const exp = Math.min(Math.floor(session.expiresAt.getTime() / 1000), Math.floor((Date.now() + PLATFORM_SESSION_MS) / 1000));
  if (exp <= Math.floor(Date.now() / 1000)) throw new IdentityError('UNAUTHORIZED', 'Your platform session has expired.', 401);
  return jwt.sign({ id: session.userId, tokenVersion: session.tokenVersion, sessionId: session.sessionId, sessionKind: tenantSlug ? 'tenant' : 'platform', ...(tenantSlug ? { tenant_slug: tenantSlug } : {}), exp }, signingSecret, { algorithm: 'HS256' });
}
