// /login route. Extracted from `../authRouter.ts` in PR 2.3d.

import { Router } from 'express';
import bcrypt from 'bcrypt';
import type { Prisma } from '@prisma/client';
import { logger, prisma, tenantScopedPrisma } from '../../app/authDeps.js';
import type { WithoutTenantScope } from '../../../../platform/db/tenantExtension.js';
import { getOperatingTenantConfig } from '../../../../platform/tenant/tenantAls.js';
import { LoginBodySchema } from '../authPayloadSchemas.js';
import {
  applyIpRateLimit,
  checkEmailCooldown,
  ensurePrimaryAccountIdForLogin,
  errorMessage,
  handleEmailFail,
  handleEmailSuccess,
  normalizeEmail,
  OTP_SECRET,
  signAuthTokenForUser,
  toAuthUser,
} from './helpers.js';

export const loginRouter = Router();

const OUT_OF_HOURS_ALERT_RECIPIENT = 'peter@abbeygate.cy';

function isOutOfHoursLogin(value: Date): boolean {
  const hour = value.getUTCHours();
  return hour < 7 || hour >= 20;
}

loginRouter.post('/login', applyIpRateLimit, async (req, res) => {
  const parsed = LoginBodySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Invalid login payload' },
      details: parsed.error.flatten(),
    });
  }
  const { username, email, password } = parsed.data;

  try {
    const normalizedEmail = normalizeEmail(email || username);

    if (checkEmailCooldown(normalizedEmail)) {
      return res.status(429).json({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Please try again later.' } });
    }

    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      handleEmailFail(normalizedEmail);
      return res.status(401).json({ success: false, error: { code: 'AUTH_FAILED', message: 'Invalid credentials' } });
    }

    if (user.isActive === false || user.suspendedAt) {
      handleEmailFail(normalizedEmail);
      return res.status(403).json({
        success: false,
        error: { code: 'ACCOUNT_DISABLED', message: 'Account is disabled' },
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      handleEmailFail(normalizedEmail);
      return res.status(401).json({ success: false, error: { code: 'AUTH_FAILED', message: 'Invalid credentials' } });
    }

    handleEmailSuccess(normalizedEmail);

    if (String(user.role || '').toUpperCase() === 'CUSTOMER' && !user.emailVerifiedAt) {
      if (!OTP_SECRET) {
        return res.status(503).json({
          success: false,
          error: { code: 'OTP_NOT_CONFIGURED', message: 'Email verification is temporarily unavailable. Please contact support.' },
          data: { email: user.email },
        });
      }
      return res.status(403).json({
        success: false,
        error: { code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email before logging in.' },
        data: { email: user.email },
      });
    }

    const ensuredTenantId = await ensurePrimaryAccountIdForLogin({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      primaryAccountId: user.primaryAccountId,
    });

    if (ensuredTenantId && String(user.primaryAccountId || '').trim() !== ensuredTenantId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { primaryAccountId: ensuredTenantId },
      });
    }

    const token = signAuthTokenForUser(user);
    const userId = user.id;
    const tenantId = String(user.primaryAccountId || '').trim() || null;
    const loginAt = new Date();

    try {
      await prisma.user.update({
        where: { id: userId },
        data: { lastLogin: loginAt },
      });
    } catch (e) {
      logger.error({ err: e }, '[Auth] Failed to update lastLogin:');
    }

    try {
      const tenant = getOperatingTenantConfig();
      if (tenant) {
        const outOfHours = isOutOfHoursLogin(loginAt);
        const data: WithoutTenantScope<Prisma.LoginEventUncheckedCreateInput> = {
          userId,
          email: user.email,
          role: String(user.role || ''),
          occurredAt: loginAt,
          ipAddress: String(req.ip || req.headers['x-forwarded-for'] || ''),
          userAgent: String(req.headers['user-agent'] || ''),
          outOfHours,
          alertRecipient: outOfHours ? OUT_OF_HOURS_ALERT_RECIPIENT : null,
          alertQueuedAt: outOfHours ? loginAt : null,
        };
        await tenantScopedPrisma.loginEvent.create({
          data: data as Prisma.LoginEventUncheckedCreateInput,
        });
      }
    } catch (e) {
      logger.error({ err: e, userId }, '[Auth] Failed to record login event:');
    }

    return res.json({
      success: true,
      data: {
        token,
        tenantId,
        user: toAuthUser(user),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error) } });
  }
});

