import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { prisma } from '../../../platform/db/connection.js';
import { logger } from '../../../platform/utils/logger.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import {
  sendInviteLinkEmail,
  sendPasswordResetLinkEmail,
} from '../../communications/domain/notifications/email.js';
import { normalizePublicAppBaseUrl } from '../../../platform/http/publicAppLinks.js';
import { syncSystemAccessAssignmentsForUser } from './permissionService.js';

/**
 * User Lifecycle Service
 *
 * Application layer — orchestrates DB mutations + audit events + notifications.
 * All writes emit USER.* audit events through the existing AuditLogger.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Invite
// ──────────────────────────────────────────────────────────────────────────────

export type InviteUserArgs = {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  role?: 'ADMIN' | 'UNDERWRITER' | 'CUSTOMER';
  userType?: 'INTERNAL' | 'BROKER' | 'CUSTOMER' | 'PARTNER';
  assignmentRoleIds?: string[];
  invitedById?: string;
  invitedByName?: string;
  note?: string;
  publicAppBaseUrl: string;
};

const INVITE_LINK_TTL_HOURS = 24 * 7; // 7 days

function normalizeEmail(input: string): string {
  return String(input || '').trim().toLowerCase();
}

/**
 * Invite a new user.
 *
 * Creates an inactive user record with an unguessable random "placeholder"
 * password (the user will never use this — they always go through the link),
 * then issues a magic link that doubles as a "set your initial password"
 * activation. Mechanics:
 *   1. Generate a 256-bit random token.
 *   2. Persist `sha256(token + OTP_SECRET)` as a `UserOtp` row with
 *      `purpose: PASSWORD_RESET` and a 7-day TTL.
 *   3. Email the user a `${publicAppBaseUrl}/auth/reset?token=<token>` link.
 *   4. The user clicks the link, sets a password, and the
 *      `/api/auth/password-reset/confirm-link` endpoint also flips
 *      `isActive=true` + clears `inviteToken` for invite acceptance.
 *
 * The `User.inviteToken` column is still populated (with the same raw token)
 * for backward compatibility with any reader that still consults it; the
 * canonical mechanism is now the `UserOtp` row.
 */
export async function inviteUser(args: InviteUserArgs) {
  const {
    email,
    firstName,
    lastName,
    phone,
    role = 'UNDERWRITER',
    userType = 'INTERNAL',
    assignmentRoleIds = [],
    invitedById,
    invitedByName,
    publicAppBaseUrl,
  } = args;

  const normalizedEmail = normalizeEmail(email);
  const existing = await prisma.user.findFirst({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) {
    throw Object.assign(new Error('A user with this email already exists.'), { code: 'EMAIL_CONFLICT' });
  }

  const baseUrl = normalizePublicAppBaseUrl(publicAppBaseUrl);
  const expiresHours = INVITE_LINK_TTL_HOURS;
  const { token, codeHash } = generateResetLinkToken();
  const inviteExpiresAt = new Date(Date.now() + expiresHours * 60 * 60_000);

  // Random placeholder bcrypt hash: the user will never authenticate with
  // this; they go through the magic link to choose a real password. We
  // populate `password` because the column is non-null in the schema.
  const placeholderPassword = crypto.randomBytes(32).toString('hex');
  const hashedPassword = await bcrypt.hash(placeholderPassword, 10);

  const name = [firstName, lastName].filter(Boolean).join(' ') || null;

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      name,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      phone: phone ?? null,
      role,
      userType,
      password: hashedPassword,
      isActive: false,
      inviteToken: token,
      inviteExpiresAt,
      invitedById: invitedById ?? null,
    },
    select: { id: true, email: true, name: true, firstName: true, lastName: true, role: true },
  });

  await syncSystemAccessAssignmentsForUser(user.id, role);
  if (assignmentRoleIds.length > 0) {
    await prisma.accessAssignment.createMany({
      data: assignmentRoleIds.map((roleId) => ({
        userId: user.id,
        roleId,
        scopeType: 'GLOBAL',
        assignedById: invitedById ?? null,
      })),
      skipDuplicates: true,
    });
  }

  const otp = await prisma.userOtp.create({
    data: {
      userId: user.id,
      email: normalizedEmail,
      purpose: 'PASSWORD_RESET',
      codeHash,
      expiresAt: inviteExpiresAt,
    },
  });

  const url = new URL(`${baseUrl}/auth/reset`);
  url.searchParams.set('token', token);
  const resetUrl = url.toString();

  let sent = false;
  try {
    sent = await sendInviteLinkEmail({
      toEmail: normalizedEmail,
      firstName: firstName ?? '',
      url: resetUrl,
      expiresHours,
      invitedBy: invitedByName,
    });
  } catch (err) {
    logger.error({ err, userId: user.id }, '[accessControl] Invite email threw.');
  }

  if (!sent) {
    // The user row stays — we don't want a half-deleted state if comms is
    // misconfigured. Just clear the OTP and surface a typed error so the
    // admin UI can offer a "resend invite" affordance later.
    try {
      await prisma.userOtp.delete({ where: { id: otp.id } });
    } catch (cleanupErr) {
      logger.warn({ err: cleanupErr, otpId: otp.id }, '[accessControl] Failed to clean up OTP after invite send failure.');
    }
    throw Object.assign(new Error('Failed to send invitation email.'), { code: 'EMAIL_SEND_FAILED' });
  }

  await AuditLogger.log(
    user.id,
    'USER',
    'USER.INVITED' as never,
    invitedById ?? 'system',
    invitedById ? 'USER' : 'SYSTEM',
    { email: normalizedEmail, role, userType, flow: 'link', expiresHours },
    invitedByName,
  );

  return user;
}

// ──────────────────────────────────────────────────────────────────────────────
// Suspend / Reactivate
// ──────────────────────────────────────────────────────────────────────────────

export async function suspendUser(userId: string, actorId: string, actorName?: string, reason?: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      isActive: false,
      suspendedAt: new Date(),
      suspendedReason: reason ?? null,
      // Bump tokenVersion to immediately invalidate all active sessions
      tokenVersion: { increment: 1 },
    },
    select: { id: true, email: true },
  });

  await AuditLogger.log(user.id, 'USER', 'USER.SUSPENDED' as never, actorId, 'USER', { reason }, actorName);
  return user;
}

export async function reactivateUser(userId: string, actorId: string, actorName?: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { isActive: true, suspendedAt: null, suspendedReason: null },
    select: { id: true, email: true },
  });

  await AuditLogger.log(user.id, 'USER', 'USER.REACTIVATED' as never, actorId, 'USER', {}, actorName);
  return user;
}

// ──────────────────────────────────────────────────────────────────────────────
// Revoke sessions
// ──────────────────────────────────────────────────────────────────────────────

export async function revokeUserSessions(userId: string, actorId: string, actorName?: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });

  await AuditLogger.log(userId, 'USER', 'USER.SESSIONS_REVOKED' as never, actorId, 'USER', {}, actorName);
}

// ──────────────────────────────────────────────────────────────────────────────
// Profile update
// ──────────────────────────────────────────────────────────────────────────────

export async function updateUserProfile(
  userId: string,
  data: { firstName?: string; lastName?: string; phone?: string; userType?: string; role?: string },
  actorId: string,
  actorName?: string,
) {
  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, name: true, phone: true, userType: true, role: true },
  });

  // Recompute the denormalised `User.name` ONLY when this update actually touches
  // firstName or lastName. ABY-304: previously this block ran on every update,
  // which silently wiped `User.name` to null when the row had `name` populated
  // but `firstName`/`lastName` were null (legacy users, SSO-imported users).
  // A subsequent edit of role/phone/userType then derived `''` from two nulls
  // and stored it as null — the BO list rendered the user as their email.
  // Per `no-defensive-fallbacks`: do not default missing required fields.
  // Per `contract-spine`: `User.name` is the canonical denormalisation of
  // `firstName + lastName` and must change ONLY when its inputs change.
  const nameRequested = data.firstName !== undefined || data.lastName !== undefined;
  const nameUpdate: { name: string | null } | Record<string, never> = nameRequested
    ? {
        name:
          [
            data.firstName !== undefined ? data.firstName : (before?.firstName ?? ''),
            data.lastName !== undefined ? data.lastName : (before?.lastName ?? ''),
          ]
            .filter(Boolean)
            .join(' ') || null,
      }
    : {};

  // ABY-311 (production: yuval@facio.io, 2026-06-04): when an admin
  // changes a user's `role` or `userType` we MUST bump `tokenVersion`,
  // otherwise the user's existing JWT continues to authenticate them
  // under the OLD role until the 8h JWT expiry. Concretely the bug was:
  // an admin row was demoted to CUSTOMER, the operator manually edited
  // role back to ADMIN here, but the user's cached JWT kept resolving as
  // CUSTOMER (frontend redirected to /client). The auth middleware
  // (`backend/platform/http/middleware/auth.ts`) treats a `tokenVersion` mismatch
  // as `Session invalid` and forces the next request to 401, which
  // boots the user back to login and refreshes their session with the
  // current DB role. Mirrors `suspendUser` (line above).
  //
  // We only bump when the value ACTUALLY changes, so phone/firstName/
  // lastName edits don't log the user out unnecessarily.
  const roleActuallyChanged =
    data.role !== undefined && String(data.role) !== String(before?.role ?? '');
  const userTypeActuallyChanged =
    data.userType !== undefined && String(data.userType) !== String(before?.userType ?? '');
  const accessAffectingChange = roleActuallyChanged || userTypeActuallyChanged;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
      ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
      ...nameUpdate,
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.userType !== undefined ? { userType: data.userType as never } : {}),
      ...(data.role !== undefined ? { role: data.role as never } : {}),
      ...(accessAffectingChange ? { tokenVersion: { increment: 1 } } : {}),
    },
    select: { id: true, name: true, firstName: true, lastName: true, email: true, phone: true, role: true, userType: true },
  });

  if (data.role !== undefined) {
    await syncSystemAccessAssignmentsForUser(userId, data.role as never);
  }

  await AuditLogger.log(userId, 'USER', 'USER.UPDATED' as never, actorId, 'USER', { before, after: data }, actorName);
  return updated;
}

// ──────────────────────────────────────────────────────────────────────────────
// Admin password reset (magic-link flow)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * OTP secret. Used to derive the stored `codeHash` of the reset-link token so
 * a database leak alone is not enough to forge a valid link. Must match the
 * value used by the corresponding redemption endpoint
 * (`/auth/password-reset/confirm-link`). Trimmed because Kubernetes Secrets
 * sometimes ship trailing newlines.
 */
function getOtpSecret(): string {
  const value = String(process.env.OTP_SECRET || '').trim();
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw Object.assign(new Error('OTP_SECRET must be configured in production'), { code: 'OTP_NOT_CONFIGURED' });
  }
  return 'dev-otp-secret-change-me';
}

/**
 * 256-bit url-safe random token. We mail the raw token; we persist
 * `sha256(token + OTP_SECRET)`. Verification on redemption recomputes the
 * hash and looks the row up by `codeHash` directly — there's no need for
 * the user to also supply their email.
 */
function generateResetLinkToken(): { token: string; codeHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const codeHash = crypto.createHash('sha256').update(`${token}:${getOtpSecret()}`).digest('hex');
  return { token, codeHash };
}

const ADMIN_RESET_LINK_TTL_HOURS = 24;

/**
 * Admin-triggered password reset.
 *
 * Issues a single-use, 24h-valid magic link. We:
 *   1. Generate a 256-bit random token.
 *   2. Persist `sha256(token + OTP_SECRET)` as a `UserOtp` row with purpose
 *      `PASSWORD_RESET`.
 *   3. Email the user a link of the form
 *      `${publicAppBaseUrl}/auth/reset?token=<token>`.
 *
 * The recipient clicks the link, lands on `/auth/reset`, sets a new password,
 * and the page POSTs `{ token, newPassword }` to
 * `/api/auth/password-reset/confirm-link`. On success we mark the OTP row
 * consumed, store the new bcrypt-hashed password, and bump `tokenVersion`
 * so any active sessions are invalidated.
 *
 * If the email fails to dispatch, the OTP row is deleted and a typed error is
 * surfaced so the caller (and the UI) can distinguish "reset not triggered"
 * from "reset triggered successfully".
 */
export async function adminResetUserPassword(
  userId: string,
  actorId: string,
  actorName: string | undefined,
  opts: { publicAppBaseUrl: string }
) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) throw Object.assign(new Error('User not found'), { code: 'USER_NOT_FOUND' });

  const baseUrl = normalizePublicAppBaseUrl(opts.publicAppBaseUrl);
  const expiresHours = ADMIN_RESET_LINK_TTL_HOURS;
  const { token, codeHash } = generateResetLinkToken();

  const otp = await prisma.userOtp.create({
    data: {
      userId: user.id,
      email: user.email,
      purpose: 'PASSWORD_RESET',
      codeHash,
      expiresAt: new Date(Date.now() + expiresHours * 60 * 60_000),
    },
  });

  const url = new URL(`${baseUrl}/auth/reset`);
  url.searchParams.set('token', token);
  const resetUrl = url.toString();

  let sent = false;
  try {
    sent = await sendPasswordResetLinkEmail({ toEmail: user.email, url: resetUrl, expiresHours });
  } catch (err) {
    logger.error({ err, userId: user.id }, '[accessControl] Admin password reset link email threw.');
  }

  if (!sent) {
    try {
      await prisma.userOtp.delete({ where: { id: otp.id } });
    } catch (cleanupErr) {
      logger.warn({ err: cleanupErr, otpId: otp.id }, '[accessControl] Failed to clean up OTP after send failure.');
    }
    throw Object.assign(new Error('Failed to send password reset email.'), { code: 'EMAIL_SEND_FAILED' });
  }

  await AuditLogger.log(
    userId,
    'USER',
    'USER.PASSWORD_RESET_REQUESTED' as never,
    actorId,
    'USER',
    { triggeredBy: 'admin', flow: 'link', expiresHours },
    actorName,
  );
}
