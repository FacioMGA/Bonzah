// /email-otp/{request,verify} routes. Extracted from `../authRouter.ts` in PR 2.3d.

import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import type { WithoutTenantScope } from '../../../../platform/db/tenantExtension.js';
import { logger, prisma, tenantScopedPrisma } from '../../app/authDeps.js';
import { dispatchOtpEmailBestEffort } from '../authShared.js';
import { EmailOtpRequestBodySchema, EmailOtpVerifyBodySchema } from '../authPayloadSchemas.js';
import {
  applyIpRateLimit,
  checkEmailCooldown,
  errorMessage,
  ensureCustomerAccountInOperatingTenant,
  handleEmailFail,
  handleEmailSuccess,
  hashOtp,
  isProd,
  normalizeEmail,
  OTP_FLOW,
  OTP_SECRET,
  randomOtpCode,
  signAuthTokenForUser,
  signQuoteEmailProofToken,
  toAuthUser,
} from './helpers.js';
import { buildCustomerPolicyEmailMatchOr } from '../../../policy/app/read/listPoliciesUseCase.js';

export const emailOtpRouter = Router();

emailOtpRouter.post('/email-otp/request', applyIpRateLimit, async (req, res) => {
  try {
    if (!OTP_SECRET) {
      return res.status(503).json({ success: false, error: { code: 'OTP_NOT_CONFIGURED', message: 'Email OTP is not configured on this server.' } });
    }
    const parsed = EmailOtpRequestBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid email OTP request payload' },
        details: parsed.error.flatten(),
      });
    }
    const email = normalizeEmail(parsed.data.email);

    if (checkEmailCooldown(email)) {
      return res.status(429).json({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please try again later.' } });
    }

    const purpose = 'EMAIL_VERIFICATION' as const;
    const flow = String(parsed.data.flow || '').trim().toUpperCase();
    const quoteEmailFlow = flow === OTP_FLOW.QUOTE_EMAIL;
    const dashboardAccessFlow = flow === OTP_FLOW.DASHBOARD_ACCESS;

    // ABY-311 (production: yuval@facio.io, 2026-06-04): case-INSENSITIVE
    // lookup for the non-customer enumeration guard. A case-sensitive
    // `findUnique` here would miss an admin row stored with mixed-case
    // email and let the OTP request proceed for what is in fact a
    // non-CUSTOMER user — defeating the email-enumeration mitigation.
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (!quoteEmailFlow && user && String(user.role || '').toUpperCase() !== 'CUSTOMER') {
      return res.json({ success: true, data: { sent: true } });
    }
    if (!quoteEmailFlow && !dashboardAccessFlow && user && user.emailVerifiedAt) {
      return res.json({ success: true, data: { sent: false, alreadyVerified: true } });
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
      return res.status(429).json({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Please wait before requesting another code.' } });
    }

    const code = randomOtpCode();
    const expiresMinutes = 10;
    const expiresAt = new Date(Date.now() + expiresMinutes * 60_000);

    const createdOtp = await prisma.userOtp.create({
      data: {
        userId: quoteEmailFlow ? null : (user?.id || null),
        email,
        purpose,
        codeHash: hashOtp(code),
        expiresAt,
      },
    });

    // ABY-71 — best-effort dispatch (see authShared.dispatchOtpEmailBestEffort).
    const dispatched = await dispatchOtpEmailBestEffort({ email, code, expiresMinutes, otpId: createdOtp.id });
    if (!dispatched && !isProd) {
      return res.json({ success: true, data: { sent: false, expiresMinutes, devCode: code } });
    }
    return res.json({ success: true, data: { sent: dispatched, expiresMinutes } });
  } catch (error) {
    logger.error({ err: error }, 'Request OTP error:');
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error) } });
  }
});

emailOtpRouter.post('/email-otp/verify', applyIpRateLimit, async (req, res) => {
  try {
    if (!OTP_SECRET) {
      return res.status(503).json({ success: false, error: { code: 'OTP_NOT_CONFIGURED', message: 'Email OTP is not configured on this server.' } });
    }
    const parsed = EmailOtpVerifyBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid email OTP verification payload' },
        details: parsed.error.flatten(),
      });
    }
    const email = normalizeEmail(parsed.data.email);
    
    if (checkEmailCooldown(email)) {
      return res.status(429).json({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please try again later.' } });
    }

    const code = parsed.data.code;
    const purpose = 'EMAIL_VERIFICATION' as const;
    const flow = String(parsed.data.flow || '').trim().toUpperCase();
    const quoteEmailFlow = flow === OTP_FLOW.QUOTE_EMAIL;

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

    if (quoteEmailFlow) {
      await prisma.userOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      const quoteEmailProof = signQuoteEmailProofToken(email);
      return res.json({
        success: true,
        data: {
          verified: true,
          email,
          quoteEmailProof,
        },
      });
    }

    const verifiedUser = await tenantScopedPrisma.$transaction(async (_tx) => {
      const tx = _tx as Prisma.TransactionClient;
      await tx.userOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      // ABY-311 (production: yuval@facio.io, 2026-06-04): case-INSENSITIVE
      // existing-user lookup. The non-CUSTOMER throw below MUST trigger
      // for any case variant of an admin email; a case-sensitive
      // `findUnique` previously let a customer-flow verify slip past the
      // admin guard when the admin row was stored with mixed case.
      // We update by `id` (not by `email`) since `prisma.user.update`
      // requires an exact unique key.
      const existing = await tx.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
      if (existing && String(existing.role || '').toUpperCase() !== 'CUSTOMER') {
        throw new Error('OTP_INVALID');
      }
      if (existing) {
        return tx.user.update({ where: { id: existing.id }, data: { emailVerifiedAt: new Date() } });
      }

      const provisionalPassword = await bcrypt.hash(crypto.randomBytes(24).toString('base64url'), 10);
      const createdUser = await tx.user.create({
        data: {
          email,
          password: provisionalPassword,
          name: String(parsed.data.name || email).trim() || email,
          role: 'CUSTOMER',
          emailVerifiedAt: new Date(),
        },
      });
      const accountData: WithoutTenantScope<Prisma.AccountUncheckedCreateInput> = {
        kind: 'CUSTOMER',
        name: createdUser.name || email,
      };
      const account = await tx.account.create({
        data: accountData as Prisma.AccountUncheckedCreateInput,
      });
      await tx.accountUser.create({
        data: { accountId: account.id, userId: createdUser.id, role: 'OWNER' },
      });
      return tx.user.update({
        where: { id: createdUser.id },
        data: { primaryAccountId: account.id },
      });
    });

    // NOW that the user is verified, link unassigned policies matching their
    // email to the customer account in THIS operating tenant (PT vs CY).
    const operatingTenantAccountId = await ensureCustomerAccountInOperatingTenant({
      userId: verifiedUser.id,
      userName: String(verifiedUser.name || email),
      email,
    });
    if (operatingTenantAccountId) {
      const emailMatches = buildCustomerPolicyEmailMatchOr(email);
      if (emailMatches.length) {
        const byEmail = await tenantScopedPrisma.policy.findMany({
          where: {
            accountId: null,
            OR: emailMatches,
          },
          select: { id: true },
          take: 50,
        });
        const ids = byEmail.map((p) => p.id);
        if (ids.length) {
          await tenantScopedPrisma.policy.updateMany({
            where: { id: { in: ids } },
            data: { accountId: operatingTenantAccountId },
          });
        }
      }
    }

    const token = signAuthTokenForUser(verifiedUser);
    return res.json({
      success: true,
      data: {
        verified: true,
        emailVerifiedAt: verifiedUser.emailVerifiedAt,
        token,
        user: toAuthUser(verifiedUser),
      },
    });
  } catch (error) {
    if (errorMessage(error) === 'OTP_INVALID') {
      return res.status(400).json({ success: false, error: { code: 'OTP_INVALID', message: 'Invalid or expired code' } });
    }
    logger.error({ err: error }, 'Verify OTP error:');
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error) } });
  }
});

/**
 * Self-serve "Forgot password" — magic-link flow.
 *
 * Mirrors the admin reset path in `accessControl.adminResetUserPassword`:
 * we issue a 256-bit single-use token, persist `sha256(token + OTP_SECRET)`
 * as a `UserOtp` row, and email the user a `/auth/reset?token=…` link.
 * Redemption is handled by `POST /password-reset/confirm-link`.
 *
 * The legacy `POST /password-reset/confirm` (6-digit OTP code) endpoint
 * remains for backward compatibility with already-issued codes still in
 * flight, but no fresh codes are minted here.
 */
