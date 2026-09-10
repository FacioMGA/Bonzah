// /signup route. Extracted from `../authRouter.ts` in PR 2.3d.

import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import type { WithoutTenantScope } from '../../../../platform/db/tenantExtension.js';
import {
  logger,
  prisma,
  sendEmailVerificationOtpEmail,
  tenantScopedPrisma,
} from '../../app/authDeps.js';
import { SignupBodySchema } from '../authPayloadSchemas.js';
import {
  errorMessage,
  hashOtp,
  isProd,
  normalizeEmail,
  OTP_SECRET,
  randomOtpCode,
} from './helpers.js';

export const signupRouter = Router();

signupRouter.post('/signup', async (req, res) => {
  try {
    const parsed = SignupBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid signup payload' },
        details: parsed.error.flatten(),
      });
    }
    const { username, email, password, name, role } = parsed.data;

    const targetEmail = normalizeEmail(email || username);
    const requestedRole = String(role || 'CUSTOMER').toUpperCase();
    if (requestedRole !== 'CUSTOMER') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot create non-customer users via signup.' } });
    }
    if (isProd && !OTP_SECRET) {
      return res.status(503).json({
        success: false,
        error: { code: 'OTP_NOT_CONFIGURED', message: 'Email verification is not configured. Please contact support.' },
      });
    }

    // ABY-311 (production: yuval@facio.io, 2026-06-04): existing-user
    // lookup is case-INSENSITIVE — same shape as `inviteUser`. A
    // case-sensitive `findUnique` here would let a customer signup
    // with `yuval@facio.io` succeed even when an admin row existed
    // as `Yuval@facio.io`, silently creating a duplicate row that
    // visually shadows the admin. Postgres's `email @unique` is
    // case-sensitive at the column level, so the index doesn't catch
    // it. Per `no-defensive-fallbacks`: we don't auto-merge, we don't
    // auto-overwrite — we refuse the signup at the boundary.
    const existing = await prisma.user.findFirst({
      where: { email: { equals: targetEmail, mode: 'insensitive' } },
    });
    if (existing) {
      return res.status(400).json({ success: false, error: { code: 'USER_EXISTS', message: 'User already exists' } });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const created = await tenantScopedPrisma.$transaction(async (_tx) => {
      const tx = _tx as Prisma.TransactionClient;
      const createdUser = await tx.user.create({
        data: {
          email: targetEmail,
          password: hashedPassword,
          name,
          role: 'CUSTOMER',
        },
      });

      const signupAccountData: WithoutTenantScope<Prisma.AccountUncheckedCreateInput> = {
        kind: 'CUSTOMER',
        name: name || targetEmail,
      };
      const account = await tx.account.create({
        data: signupAccountData as Prisma.AccountUncheckedCreateInput,
      });
      await tx.accountUser.create({
        data: { accountId: account.id, userId: createdUser.id, role: 'OWNER' },
      });
      await tx.user.update({ where: { id: createdUser.id }, data: { primaryAccountId: account.id } });
      return { user: createdUser, accountId: account.id };
    });

    try {
      const code = randomOtpCode();
      const expiresMinutes = 10;
      const expiresAt = new Date(Date.now() + expiresMinutes * 60_000);
      await prisma.userOtp.create({
        data: {
          userId: created.user.id,
          email: targetEmail,
          purpose: 'EMAIL_VERIFICATION',
          codeHash: hashOtp(code),
          expiresAt,
        },
      });
      const sent = await sendEmailVerificationOtpEmail({ toEmail: targetEmail, code, expiresMinutes });
      if (!sent && !isProd) {
        logger.warn({ email: targetEmail }, '[Auth] Signup OTP email not sent in non-production. Verification code suppressed from logs.');
      }
    } catch {
      // Don't fail signup on email issues.
    }

    return res.status(201).json({
      success: true,
      data: {
        id: created.user.id,
        username: created.user.email,
        role: created.user.role,
        verificationRequired: true,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error) } });
  }
});
