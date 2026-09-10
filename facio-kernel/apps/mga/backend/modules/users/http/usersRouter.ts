import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { Role, type Prisma } from '@prisma/client';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma, sendPasswordResetOtpEmail, logger } from '../app/userDeps.js';
import { requirePermission } from '../../accessControl/http/permissionMiddleware.js';
import {
  resolveEffectivePermissionKeysForUser,
  syncSystemAccessAssignmentsForUser,
} from '../../accessControl/app/permissionService.js';

const IdParamSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
});

const InviteBodySchema = z.object({
  email: z.string().trim().email('Valid email is required'),
  name: z.string().trim().min(1).optional(),
  role: z.nativeEnum(Role),
  team: z.string().trim().optional(),
});

const UpdateUserBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().optional(),
    team: z.string().trim().optional(),
    role: z.nativeEnum(Role).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.email !== undefined ||
      value.phone !== undefined ||
      value.team !== undefined ||
      value.role !== undefined,
    { message: 'At least one field is required' }
  );

const UpdateUserStatusBodySchema = z.object({
  isActive: z.boolean(),
});

function normalizeEmail(input: unknown): string {
  return String(input || '').trim().toLowerCase();
}

function getCurrentUser(req: { user?: Express.UserTokenPayload }) {
  const user = req.user;
  if (!user || typeof user.id !== 'string') {
    return null;
  }
  return user;
}

function ensureAuthenticated(req: Request, res: Response, next: NextFunction) {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
  }
  return next();
}

function getOtpSecret(): string {
  const value = String(process.env.OTP_SECRET || '').trim();
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('OTP_SECRET must be configured in production');
  }
  return 'dev-otp-secret-change-me';
}

export function createUsersModuleRouter() {
  const router = Router();

  router.get('/', requirePermission('users', 'view'), async (_req, res) => {
    try {
      const users = await prisma.user.findMany({
        select: { id: true, email: true, name: true, role: true, phone: true, createdAt: true, isActive: true, lastLogin: true, mfaEnabled: true }
      });
      const data = users.map(u => ({ ...u, username: u.email }));
      return res.json({ success: true, data });
    } catch (_error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error fetching users' } });
    }
  });

  router.get('/me', ensureAuthenticated, async (req, res) => {
    const user = getCurrentUser(req);
    if (!user) {
      return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
    }
    const effectivePermissions = await resolveEffectivePermissionKeysForUser(user.id, user.role);
    return res.json({
      success: true,
      data: {
        ...user,
        username: user.email,
        effectivePermissions,
      },
    });
  });

  router.delete('/:id', requirePermission('users', 'delete'), async (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const currentUser = getCurrentUser(req);
      if (!currentUser) {
        return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
      }

      if (id === currentUser.id) {
        return res.status(400).json({ success: false, error: { message: 'Cannot delete yourself' } });
      }

      const targetUser = await prisma.user.findUnique({ where: { id } });
      if (targetUser?.role === 'ADMIN') {
        const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
        if (adminCount <= 1) {
          return res.status(400).json({ success: false, error: { message: 'Cannot delete the last administrator' } });
        }
      }

      await prisma.user.delete({ where: { id } });
      return res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: { message: error.issues[0]?.message || 'Invalid request' } });
      }
      logger.error({ err: error }, 'Delete user error:');
      return res.status(500).json({ success: false, error: { message: 'Failed to delete user' } });
    }
  });

  router.post('/', requirePermission('users', 'invite'), async (req, res) => {
    try {
      const payload = InviteBodySchema.parse(req.body);
      const normalizedEmail = normalizeEmail(payload.email);
      const existing = await prisma.user.findFirst({
        where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) {
        return res.status(400).json({ success: false, error: { message: 'User already exists' } });
      }

      const tempPassword = crypto.randomBytes(12).toString('base64url');
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      const createData: Prisma.UserCreateInput = {
        email: normalizedEmail,
        name: payload.name,
        role: payload.role,
        password: hashedPassword,
        isActive: true,
        tokenVersion: 0,
      };

      const newUser = await prisma.user.create({ data: createData });
      await syncSystemAccessAssignmentsForUser(newUser.id, newUser.role);
      logger.info(`AUDIT: User ${newUser.email} created by ADMIN with role ${payload.role}`);

      const inviteCode = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresMinutes = 20;
      const expiresAt = new Date(Date.now() + expiresMinutes * 60_000);
      const otpSecret = getOtpSecret();
      const inviteCodeHash = crypto.createHash('sha256').update(`${inviteCode}:${otpSecret}`).digest('hex');

      const inviteOtp = await prisma.userOtp.create({
        data: {
          userId: newUser.id,
          email: newUser.email,
          purpose: 'PASSWORD_RESET',
          codeHash: inviteCodeHash,
          expiresAt,
        },
      });

      const inviteEmailSent = await sendPasswordResetOtpEmail({
        toEmail: newUser.email,
        code: inviteCode,
        expiresMinutes,
      });
      if (!inviteEmailSent) {
        try {
          await prisma.userOtp.delete({ where: { id: inviteOtp.id } });
        } catch {
          // ignore cleanup failures
        }
        return res.status(500).json({
          success: false,
          error: { message: 'User created, but invite email failed to send. Please retry invite.' },
        });
      }

      return res.status(201).json({
        success: true,
        data: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
          isActive: newUser.isActive,
          inviteEmailSent: true,
          message: 'User created and invite email sent successfully',
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: { message: error.issues[0]?.message || 'Invalid request body' } });
      }
      logger.error({ err: error }, 'Invite user error:');
      return res.status(500).json({ success: false, error: { message: 'Failed to invite user' } });
    }
  });

  router.patch('/:id', requirePermission('users', 'edit'), async (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const payload = UpdateUserBodySchema.parse(req.body);
      const currentUser = getCurrentUser(req);
      if (!currentUser) {
        return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
      }

      const updateData: Prisma.UserUpdateInput = {};
      if (payload.name !== undefined) updateData.name = payload.name;
      if (payload.email !== undefined) {
        const normalizedEmail = normalizeEmail(payload.email);
        const existing = await prisma.user.findFirst({
          where: {
            id: { not: id },
            email: { equals: normalizedEmail, mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (existing) {
          return res.status(400).json({ success: false, error: { message: 'User already exists' } });
        }
        updateData.email = normalizedEmail;
        updateData.tokenVersion = { increment: 1 };
      }
      if (payload.phone !== undefined) updateData.phone = payload.phone;

      if (payload.role !== undefined) {
        if (id === currentUser.id && payload.role !== 'ADMIN') {
          const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
          if (adminCount <= 1) {
            return res.status(400).json({ success: false, error: { message: 'Cannot demote the last administrator' } });
          }
        }
        updateData.role = payload.role;
        updateData.tokenVersion = { increment: 1 };
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: updateData,
        select: { id: true, email: true, name: true, role: true, isActive: true },
      });
      if (payload.role !== undefined) {
        await syncSystemAccessAssignmentsForUser(id, payload.role);
      }
      return res.json({ success: true, data: updatedUser });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: { message: error.issues[0]?.message || 'Invalid request body' } });
      }
      logger.error({ err: error }, 'Update user error:');
      return res.status(500).json({ success: false, error: { message: 'Failed to update user' } });
    }
  });

  router.patch('/:id/status', requirePermission('users', 'suspend'), async (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const { isActive } = UpdateUserStatusBodySchema.parse(req.body);
      const currentUser = getCurrentUser(req);
      if (!currentUser) {
        return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
      }

      if (id === currentUser.id) {
        return res.status(400).json({ success: false, error: { message: 'Cannot change your own status' } });
      }

      const updated = await prisma.user.update({
        where: { id },
        data: {
          isActive,
          tokenVersion: { increment: 1 },
        },
      });
      return res.json({ success: true, message: `User ${isActive ? 'enabled' : 'disabled'} successfully`, data: { isActive: updated.isActive } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: { message: error.issues[0]?.message || 'Invalid request body' } });
      }
      logger.error({ err: error }, 'Status change error:');
      return res.status(500).json({ success: false, error: { message: 'Failed to update user status' } });
    }
  });

  router.post('/:id/reset-password', requirePermission('users', 'reset_password'), async (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params);
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        return res.status(404).json({ success: false, error: { message: 'User not found' } });
      }

      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresMinutes = 10;
      const expiresAt = new Date(Date.now() + expiresMinutes * 60_000);
      const otpSecret = getOtpSecret();
      const codeHash = crypto.createHash('sha256').update(`${code}:${otpSecret}`).digest('hex');

      await prisma.userOtp.create({
        data: {
          userId: user.id,
          email: user.email,
          purpose: 'PASSWORD_RESET',
          codeHash,
          expiresAt,
        },
      });

      const sent = await sendPasswordResetOtpEmail({ toEmail: user.email, code, expiresMinutes });
      if (!sent) {
        logger.warn(`[Admin] Password reset email failed. Code for ${user.email} was ${code}`);
        return res.status(500).json({ success: false, error: { message: 'Failed to send email, but code generated.' } });
      }

      logger.info(`AUDIT: Password reset requested for ${user.email} by ADMIN`);
      return res.json({ success: true, message: 'Password reset email sent successfully.' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: { message: error.issues[0]?.message || 'Invalid request' } });
      }
      logger.error({ err: error }, 'Reset password error');
      return res.status(500).json({ success: false, error: { message: 'Failed to reset password' } });
    }
  });

  return router;
}
