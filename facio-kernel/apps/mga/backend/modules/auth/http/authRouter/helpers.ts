// Auth router helpers + module-scope state.
// Extracted from `../authRouter.ts` in PR 2.3d of the errors-and-warnings
// cleanup so the composer file stays under the file-size cap. Sub-route
// files (`./loginRoute.ts`, `./emailOtpRoutes.ts`, etc.) import from here.

import type { NextFunction, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import type { WithoutTenantScope } from '../../../../platform/db/tenantExtension.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma, tenantScopedPrisma, logger } from '../../app/authDeps.js';
import { getOperatingTenantConfig } from '../../../../platform/tenant/tenantAls.js';
import { getTenantConfig } from '../../../../platform/tenant/tenantConfig.js';
import { runTenantScopedTransaction } from '../../../../platform/db/connection.js';

// --- Layered Rate Limiting ---
const ipLimitStore = new Map<string, { count: number; windowStart: number }>();
const EMAIL_COOLDOWN_MAP = new Map<string, { attempts: number; lockedUntil: number }>();

export function applyIpRateLimit(req: Request, _res: Response, next: NextFunction) {
  // `req.headers` can be missing in unit tests that mock a partial Request,
  // so guard before indexing into it. Real Express always populates headers.
  const fwd = req.headers ? req.headers['x-forwarded-for'] : undefined;
  const ip = req.ip || fwd || 'unknown';
  const ipKey = String(ip);
  const now = Date.now();
  const WINDOW_MS = 15 * 60_000;
  
  let record = ipLimitStore.get(ipKey);
  if (!record || now > record.windowStart + WINDOW_MS) {
    record = { count: 0, windowStart: now };
  }
  record.count += 1;
  ipLimitStore.set(ipKey, record);

  if (record.count > 100) {
    logger.warn({ ip: ipKey, count: record.count }, 'RATE_LIMIT_WARNING: Soft-blocked IP');
    // SOFT BLOCK: Return next() anyway (log only for Go-Live)
  }
  next();
}

export function handleEmailFail(email: string) {
  const e = normalizeEmail(email);
  const now = Date.now();
  let record = EMAIL_COOLDOWN_MAP.get(e);
  if (!record || now > record.lockedUntil) {
    record = { attempts: 0, lockedUntil: 0 };
  }
  record.attempts += 1;
  if (record.attempts >= 10) {
    record.lockedUntil = now + 5 * 60_000;
  } else if (record.attempts >= 5) {
    record.lockedUntil = now + 60_000;
  }
  if (record.lockedUntil > now) {
    logger.warn({ email: e, attempts: record.attempts }, 'AUTH_COOLDOWN_APPLIED');
  }
  EMAIL_COOLDOWN_MAP.set(e, record);
}

export function handleEmailSuccess(email: string) {
  const e = normalizeEmail(email);
  EMAIL_COOLDOWN_MAP.delete(e);
}

export function checkEmailCooldown(email: string): boolean {
  const e = normalizeEmail(email);
  const record = EMAIL_COOLDOWN_MAP.get(e);
  if (record && Date.now() < record.lockedUntil) {
    return true; // is locked
  }
  return false;
}


export const isProd = (process.env.NODE_ENV || 'development') === 'production' || process.env.KERNEL_PLATFORM_MODE === 'true';
if (!process.env.JWT_SECRET) {
  if (isProd) {
    throw new Error('FATAL: JWT_SECRET environment variable is not defined.');
  }
  process.env.JWT_SECRET = 'dev-jwt-secret-change-me';
  logger.warn('⚠️  [Auth] JWT_SECRET not set; using insecure dev default. Set JWT_SECRET in .env for a stable local secret.');
}
export const JWT_SECRET = process.env.JWT_SECRET!;

// Trim whitespace so a Kubernetes Secret pasted with a trailing newline
// (e.g. "otp-secret\n") still matches the value used by sibling modules
// (accessControl/userLifecycleService.ts, users/http/usersRouter.ts) which
// both `.trim()` before hashing. Without this, an admin-issued reset code
// would never verify against the user-issued reset confirm endpoint.
export let OTP_SECRET: string | null = process.env.OTP_SECRET ? String(process.env.OTP_SECRET).trim() : null;
if (!OTP_SECRET) {
  if (isProd) {
    logger.error({ err: 1_000_000 }, '❌ [Auth] OTP_SECRET is not set. Email OTP verification is DISABLED until configured.');
  } else {
    OTP_SECRET = 'dev-otp-secret-change-me';
    logger.warn('⚠️  [Auth] OTP_SECRET not set; using insecure dev default. Set OTP_SECRET in .env for a stable local secret.');
  }
}


export function normalizeEmail(input: unknown): string {
  return String(input || '').trim().toLowerCase();
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export function randomOtpCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashOtp(code: string): string {
  if (!OTP_SECRET) {
    throw new Error('OTP is not configured (missing OTP_SECRET)');
  }
  return crypto.createHash('sha256').update(`${code}:${OTP_SECRET}`).digest('hex');
}

export function toAuthUser(user: {
  id: string;
  email: string;
  role: string;
  name: string | null;
  mfaEnabled: boolean;
  emailVerifiedAt: Date | null;
  primaryAccountId: string | null;
}) {
  return {
    id: user.id,
    username: user.email,
    email: user.email,
    role: user.role,
    name: user.name,
    mfaEnabled: user.mfaEnabled,
    emailVerifiedAt: user.emailVerifiedAt || null,
    primaryAccountId: user.primaryAccountId || null,
  };
}

export type TenantBootstrapUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  primaryAccountId: string | null;
};

export
async function ensurePrimaryAccountIdForLogin(user: TenantBootstrapUser): Promise<string | null> {
  // Platform sign-in has no selected MGA and must not adopt another tenant's account.
  if (process.env.KERNEL_PLATFORM_MODE === 'true' && !getOperatingTenantConfig()) return null;
  const existingPrimary = String(user.primaryAccountId || '').trim();
  if (existingPrimary) return existingPrimary;
  const existingMembership = await prisma.accountUser.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
    select: { accountId: true },
  });
  const membershipAccountId = String(existingMembership?.accountId || '').trim();
  if (membershipAccountId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { primaryAccountId: membershipAccountId },
    });
    return membershipAccountId;
  }

  const roleUpper = String(user.role || '').toUpperCase();
  const isCustomer = roleUpper === 'CUSTOMER';
  if (isCustomer && isProd) return null;

  let accountId = '';
  if (isCustomer) {
    const customerAccountData: WithoutTenantScope<Prisma.AccountUncheckedCreateInput> = {
      kind: 'CUSTOMER',
      name: String(user.name || user.email || '').trim() || user.email,
    };
      const created = await tenantScopedPrisma.account.create({
      data: customerAccountData as Prisma.AccountUncheckedCreateInput,
      select: { id: true },
    });
    accountId = created.id;
  } else {
    const existingInternalAccount = await tenantScopedPrisma.account.findFirst({
      where: { kind: 'INTERNAL' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existingInternalAccount?.id) {
      accountId = existingInternalAccount.id;
    } else {
      const internalAccountData: WithoutTenantScope<Prisma.AccountUncheckedCreateInput> = {
        kind: 'INTERNAL',
        name: 'Local Development Internal Account',
      };
      const createdInternalAccount = await tenantScopedPrisma.account.create({
        data: internalAccountData as Prisma.AccountUncheckedCreateInput,
        select: { id: true },
      });
      accountId = createdInternalAccount.id;
    }
  }

  if (!accountId) return null;

  await prisma.accountUser.createMany({
    data: [{ accountId, userId: user.id, role: 'OWNER' }],
    skipDuplicates: true,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { primaryAccountId: accountId },
  });

  return accountId;
}

/**
 * Resolve (or create) the customer account scoped to the current operating
 * tenant. Multi-jurisdiction customers may hold separate account rows per
 * tenant; policy linking and portal RLS must target the tenant the request
 * is operating in, not whichever account happens to be `primaryAccountId`.
 */
export async function ensureCustomerAccountInOperatingTenant(args: {
  userId: string;
  userName: string;
  email: string;
}): Promise<string> {
  const tenantId = getTenantConfig().id;
  const lockKey = `customer-account:${tenantId}:${args.userId}`;

  return runTenantScopedTransaction(async (tx) => {
    // AccountUser cannot express a uniqueness constraint through Account's
    // operatingTenantId. Serialise this exact user/tenant pair so concurrent
    // OTP verifications cannot create competing tenant-local customer accounts.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const memberships = await tx.accountUser.findMany({
      where: {
        userId: args.userId,
        account: { operatingTenantId: tenantId },
      },
      select: { accountId: true },
      take: 2,
    });
    if (memberships.length > 1) {
      throw new Error('CUSTOMER_ACCOUNT_TENANT_INVARIANT_BREACH');
    }
    const existingAccountId = String(memberships[0]?.accountId || '').trim();
    if (existingAccountId) return existingAccountId;

    const customerAccountData: WithoutTenantScope<Prisma.AccountUncheckedCreateInput> = {
      kind: 'CUSTOMER',
      name: String(args.userName || args.email || '').trim() || args.email,
    };
    const account = await tx.account.create({
      data: customerAccountData as Prisma.AccountUncheckedCreateInput,
      select: { id: true },
    });
    await tx.accountUser.create({
      data: { accountId: account.id, userId: args.userId, role: 'OWNER' },
    });
    return account.id;
  });
}

export
function signAuthTokenForUser(user: { id: string; role: string; tokenVersion?: number | null }): string {
  return jwt.sign(
    { id: user.id, role: user.role, tokenVersion: user.tokenVersion ?? 0,
      ...(process.env.KERNEL_PLATFORM_MODE === 'true' ? { sessionKind: 'platform' } : {}) },
    JWT_SECRET,
    { expiresIn: '8h' },
  );
}

export
function signQuoteEmailProofToken(email: string): string {
  return jwt.sign(
    { purpose: 'QUOTE_EMAIL', email: normalizeEmail(email) },
    JWT_SECRET,
    { expiresIn: '15m' },
  );
}

export const OTP_FLOW = {
  QUOTE_EMAIL: 'QUOTE_EMAIL',
  DASHBOARD_ACCESS: 'DASHBOARD_ACCESS',
} as const;
