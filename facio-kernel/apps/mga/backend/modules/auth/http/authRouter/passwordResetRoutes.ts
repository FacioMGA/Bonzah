// /password-reset/{request,confirm,confirm-link} routes.
// Extracted from `../authRouter.ts` in PR 2.3d.

import { Router } from 'express';
import bcrypt from 'bcrypt';
import {
  logger,
  prisma,
  sendPasswordResetLinkEmail,
  tenantScopedPrisma,
} from '../../app/authDeps.js';
import { resolvePublicAppBaseUrlFromRequest } from '../../../../platform/http/publicAppLinks.js';
import {
  PasswordResetConfirmBodySchema,
  PasswordResetConfirmLinkBodySchema,
  PasswordResetRequestBodySchema,
} from '../authPayloadSchemas.js';
import type { Prisma } from '@prisma/client';
import crypto from 'crypto';
import {
  applyIpRateLimit,
  checkEmailCooldown,
  errorMessage,
  handleEmailFail,
  handleEmailSuccess,
  hashOtp,
  isProd,
  normalizeEmail,
  OTP_SECRET,
} from './helpers.js';

export const passwordResetRouter = Router();

passwordResetRouter.post('/password-reset/request', applyIpRateLimit, async (req, res) => {
  try {
    if (!OTP_SECRET) {
      return res.status(503).json({ success: false, error: { code: 'OTP_NOT_CONFIGURED', message: 'Password reset is not configured on this server.' } });
    }
    const parsed = PasswordResetRequestBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid password reset request payload' },
        details: parsed.error.flatten(),
      });
    }
    const email = normalizeEmail(parsed.data.email);

    if (checkEmailCooldown(email)) {
      return res.status(429).json({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please try again later.' } });
    }

    const purpose = 'PASSWORD_RESET' as const;

    const user = await prisma.user.findUnique({ where: { email } });
    // Avoid email enumeration: respond identically whether or not the user exists.
    if (!user) {
      return res.json({ success: true, data: { sent: true } });
    }
    if (user.suspendedAt) {
      // Suspended accounts cannot reset themselves back into a usable state;
      // surface the same opaque response to avoid disclosing account state.
      return res.json({ success: true, data: { sent: true } });
    }

    const since = new Date(Date.now() - 60_000);
    const recentCount = await prisma.userOtp.count({
      where: {
        email,
        purpose,
        createdAt: { gt: since },
      },
    });
    if (recentCount >= 3) {
      return res.status(429).json({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Please wait before requesting another reset link.' } });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const codeHash = hashOtp(token);
    const expiresHours = 24;
    const expiresAt = new Date(Date.now() + expiresHours * 60 * 60_000);

    const createdOtp = await prisma.userOtp.create({
      data: {
        userId: user.id,
        email,
        purpose,
        codeHash,
        expiresAt,
      },
    });

    const baseUrl = resolvePublicAppBaseUrlFromRequest(req);
    const url = new URL(`${baseUrl}/auth/reset`);
    url.searchParams.set('token', token);
    const resetUrl = url.toString();

    const sent = await sendPasswordResetLinkEmail({ toEmail: email, url: resetUrl, expiresHours });
    if (!sent) {
      try {
        await prisma.userOtp.delete({ where: { id: createdOtp.id } });
      } catch {
        // ignore cleanup failures
      }
      if (!isProd) {
        logger.warn({ email }, '[Auth] Password reset link email not sent in non-production (missing SendGrid?). Returning devUrl.');
        return res.json({ success: true, data: { sent: false, expiresHours, devUrl: resetUrl } });
      }
      return res.status(500).json({ success: false, error: { code: 'EMAIL_SEND_FAILED', message: 'Failed to send password reset link.' } });
    }

    return res.json({ success: true, data: { sent: true, expiresHours } });
  } catch (error) {
    logger.error({ err: error }, 'Password reset request error:');
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error) } });
  }
});

passwordResetRouter.post('/password-reset/confirm', applyIpRateLimit, async (req, res) => {
  try {
    if (!OTP_SECRET) {
      return res.status(503).json({ success: false, error: { code: 'OTP_NOT_CONFIGURED', message: 'Password reset is not configured on this server.' } });
    }
    const parsed = PasswordResetConfirmBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid password reset confirm payload' },
        details: parsed.error.flatten(),
      });
    }
    const email = normalizeEmail(parsed.data.email);

    if (checkEmailCooldown(email)) {
      return res.status(429).json({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please try again later.' } });
    }

    const code = parsed.data.code;
    const newPassword = parsed.data.newPassword;
    const purpose = 'PASSWORD_RESET' as const;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ success: false, error: { code: 'OTP_INVALID', message: 'Invalid or expired code' } });
    }

    const otp = await prisma.userOtp.findFirst({
      where: {
        email,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      return res.status(400).json({ success: false, error: { code: 'OTP_INVALID', message: 'Invalid or expired code' } });
    }

    const matches = String(otp.codeHash) === hashOtp(code);
    if (!matches) {
      const nextAttempts = Number(otp.attempts || 0) + 1;
      await prisma.userOtp.update({
        where: { id: otp.id },
        data: { attempts: nextAttempts, consumedAt: nextAttempts >= 5 ? new Date() : null },
      });
      handleEmailFail(email);
      return res.status(400).json({ success: false, error: { code: 'OTP_INVALID', message: 'Invalid or expired code' } });
    }

    handleEmailSuccess(email);

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await tenantScopedPrisma.$transaction(async (_tx) => {
      const tx = _tx as Prisma.TransactionClient;
      await tx.userOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      await tx.user.update({
        where: { id: user.id },
        data: { password: hashedPassword, tokenVersion: { increment: 1 } },
      });
    });

    return res.json({ success: true, data: { reset: true } });
  } catch (error) {
    logger.error({ err: error }, 'Password reset confirm error:');
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error) } });
  }
});

/**
 * Magic-link password reset confirmation.
 *
 * Counterpart to `accessControl.adminResetUserPassword` (which mails a
 * single-use link of the form `/auth/reset?token=<token>`). The page collects
 * the user's chosen new password and POSTs it here together with the raw
 * token from the URL.
 *
 * We hash the supplied token with the same OTP_SECRET-pepper used at issue
 * time and look up the matching `UserOtp` row directly by `codeHash` —
 * there is no need for the user to also supply their email, because
 * possession of the token IS the authentication.
 *
 * On success: the row is marked `consumedAt`, the password is bcrypt-hashed
 * and persisted, and `tokenVersion` is incremented to invalidate any
 * existing sessions on the account.
 */
passwordResetRouter.post('/password-reset/confirm-link', applyIpRateLimit, async (req, res) => {
  try {
    if (!OTP_SECRET) {
      return res.status(503).json({ success: false, error: { code: 'OTP_NOT_CONFIGURED', message: 'Password reset is not configured on this server.' } });
    }
    const parsed = PasswordResetConfirmLinkBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid password reset payload' },
        details: parsed.error.flatten(),
      });
    }
    const token = parsed.data.token;
    const newPassword = parsed.data.newPassword;

    const codeHash = hashOtp(token);

    const otp = await prisma.userOtp.findFirst({
      where: {
        codeHash,
        purpose: 'PASSWORD_RESET',
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!otp) {
      return res.status(400).json({
        success: false,
        error: { code: 'RESET_LINK_INVALID', message: 'This reset link is invalid, expired, or has already been used.' },
      });
    }

    const userId = otp.userId;
    if (!userId) {
      // Reset/invite links are always issued for a known user. Without a userId
      // we cannot safely apply the password change.
      logger.error({ otpId: otp.id }, 'Password reset link confirm: OTP row has no userId');
      return res.status(400).json({
        success: false,
        error: { code: 'RESET_LINK_INVALID', message: 'This reset link is invalid, expired, or has already been used.' },
      });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isActive: true, suspendedAt: true, inviteToken: true },
    });
    if (!targetUser) {
      return res.status(400).json({
        success: false,
        error: { code: 'RESET_LINK_INVALID', message: 'This reset link is invalid, expired, or has already been used.' },
      });
    }
    // A suspended user must not be able to reset themselves back into the
    // system via a previously-issued link. (We also gate ISSUANCE in the
    // request endpoint, but defence in depth.)
    if (targetUser.suspendedAt) {
      logger.warn({ userId: targetUser.id }, 'Password reset link confirm rejected: user is suspended');
      return res.status(400).json({
        success: false,
        error: { code: 'RESET_LINK_INVALID', message: 'This reset link is invalid, expired, or has already been used.' },
      });
    }

    // If this is an invited-user-activating-their-account flow (inactive +
    // has an inviteToken + not suspended), flip them to active and clear the
    // legacy invite columns. Plain password resets for active users skip this
    // branch.
    const isInviteAcceptance = !targetUser.isActive && !!targetUser.inviteToken;

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await tenantScopedPrisma.$transaction(async (_tx) => {
      const tx = _tx as Prisma.TransactionClient;
      await tx.userOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      await tx.user.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          tokenVersion: { increment: 1 },
          ...(isInviteAcceptance
            ? { isActive: true, inviteToken: null, inviteExpiresAt: null }
            : {}),
        },
      });
    });

    return res.json({
      success: true,
      data: {
        reset: true,
        accepted: isInviteAcceptance,
        redirectPath: String(targetUser.role || '').toUpperCase() === 'CUSTOMER' ? '/client' : '/',
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Password reset confirm-link error:');
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error) } });
  }
});

