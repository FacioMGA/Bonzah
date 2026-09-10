import crypto from 'crypto';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import {
  buildPublicSessionTokenRequiredError,
  isPublicSessionModeAllowed,
} from '../../../platform/auth/publicSessionPolicy.js';
import type { PublicSessionResolveMode } from '../../../platform/auth/publicSessionPolicy.js';
import type { PerfTimings } from './perfTimings.js';
import type { Prisma } from '@prisma/client';
import type { Response } from 'express';
type PublicSessionCacheModule = typeof import('./publicSessionCache.js');
const publicSessionCacheModule: PublicSessionCacheModule = await import('./publicSessionCache.js');
const {
  getCachedLightByToken,
  setCachedLightByToken,
  singleflightTokenLock,
  releaseSingleflightTokenLock,
  waitForCacheFill,
} = publicSessionCacheModule;

export type { PublicSessionResolveMode } from '../../../platform/auth/publicSessionPolicy.js';

export function newPublicSessionToken(): string {
  // 32 bytes => 256 bits of entropy. base64url is URL-safe and compact.
  return crypto.randomBytes(32).toString('base64url');
}

// Full session select (includes heavy JSON blobs). Use sparingly.
export const POLICY_SELECT_FULL = {
  id: true,
  accountId: true,
  policyNumber: true,
  status: true,
  productType: true,
  inceptionDate: true,
  expiryDate: true,
  policyHolderId: true,
  quoteData: true,
  quoteResponse: true,
  vehicleInfo: true,
  driverInfo: true,
  isLocked: true,
  paymentStatus: true,
  publicSessionToken: true,
  programId: true, // Needed for program management
  binderId: true,
  stateCurrent: { select: { snapshot: true } },
} as const;

// Light session select (hot-path). Never includes fat JSON blobs.
export const POLICY_SELECT_LIGHT = {
  id: true,
  accountId: true,
  policyNumber: true,
  status: true,
  productType: true,
  inceptionDate: true,
  expiryDate: true,
  policyHolderId: true,
  isLocked: true,
  paymentStatus: true,
  publicSessionToken: true,
  programId: true,
  binderId: true,
} as const;
type PolicyLight = Prisma.PolicyGetPayload<{ select: typeof POLICY_SELECT_LIGHT }>;
type PolicyFull = Prisma.PolicyGetPayload<{ select: typeof POLICY_SELECT_FULL }>;

function resolvePublicAutoPolicyWithSelect(
  sessionId: string,
  select: typeof POLICY_SELECT_FULL,
  perf?: PerfTimings,
): Promise<{ policy: PolicyFull | null; mode: PublicSessionResolveMode }>;
function resolvePublicAutoPolicyWithSelect(
  sessionId: string,
  select: typeof POLICY_SELECT_LIGHT,
  perf?: PerfTimings,
): Promise<{ policy: PolicyLight | null; mode: PublicSessionResolveMode }>;
async function resolvePublicAutoPolicyWithSelect(
  sessionId: string,
  select: typeof POLICY_SELECT_LIGHT | typeof POLICY_SELECT_FULL,
  perf?: PerfTimings
): Promise<{ policy: PolicyLight | PolicyFull | null; mode: PublicSessionResolveMode }> {
  const key = String(sessionId || '').trim();
  if (!key) return { policy: null, mode: 'none' as const };

  // Public endpoints accept ONLY the opaque public-session token. Legacy
  // UUID / policyNumber lookups were deleted in PR6 of the aggressive-cleanup
  // plan; BO callers resolve by UUID through authenticated APIs instead.
  const endToken = perf?.start('db', 'publicSessionToken');
  const byToken = await tenantScopedPrisma.policy.findUnique({ where: { publicSessionToken: key }, select });
  endToken?.();
  if (byToken) return { policy: byToken, mode: 'token' as const };

  return { policy: null, mode: 'none' as const };
}

export async function resolvePublicAutoPolicyLight(
  sessionId: string,
  opts?: { perf?: PerfTimings }
): Promise<{ policy: PolicyLight | null; mode: PublicSessionResolveMode }> {
  const key = String(sessionId || '').trim();
  if (!key) return { policy: null, mode: 'none' as const };

  // Cache only applies to token lookups (unguessable). Keyed by token.
  const cached = await getCachedLightByToken<PolicyLight>(key, opts?.perf);
  if (cached && String(cached.publicSessionToken || '') === key) {
    return { policy: cached, mode: 'token' as const };
  }

  const lock = await singleflightTokenLock(key, opts?.perf);
  if (!lock.acquired) {
    const filled = await waitForCacheFill<PolicyLight>(key, 2, opts?.perf);
    if (filled && String(filled.publicSessionToken || '') === key) {
      return { policy: filled, mode: 'token' as const };
    }
  }

  try {
    const resolved = await resolvePublicAutoPolicyWithSelect(key, POLICY_SELECT_LIGHT, opts?.perf);
    if (resolved.mode === 'token' && resolved.policy && String(resolved.policy.publicSessionToken || '') === key) {
      await setCachedLightByToken(key, resolved.policy, opts?.perf);
    }
    return resolved;
  } finally {
    if (lock.acquired) {
      await releaseSingleflightTokenLock(key, lock.token, opts?.perf);
    }
  }
}

export async function resolvePublicAutoPolicyFull(
  sessionId: string,
  opts?: { perf?: PerfTimings }
): Promise<{ policy: PolicyFull | null; mode: PublicSessionResolveMode }> {
  const resolved = await resolvePublicAutoPolicyWithSelect(sessionId, POLICY_SELECT_FULL, opts?.perf);
  return resolved;
}

export function enforcePublicToken(
  req: { user?: unknown },
  mode: PublicSessionResolveMode,
  res: Pick<Response, 'status' | 'json'>
) {
  if (req.user) return true; // Authenticated users (e.g. Back Office) can access by UUID
  if (isPublicSessionModeAllowed(mode)) return true;
  res.status(401).json(buildPublicSessionTokenRequiredError());
  return false;
}
