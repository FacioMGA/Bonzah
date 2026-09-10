// /change-password route for authenticated users.

import { Router } from 'express';
import bcrypt from 'bcrypt';

import { authenticate } from '../../../../platform/http/middleware/auth.js';
import { typedHandler } from '../../../../platform/http/typedHandler.js';
import { prisma, tenantScopedPrisma, logger } from '../../app/authDeps.js';
import { ChangePasswordBodySchema } from '../authPayloadSchemas.js';
import { errorMessage } from './helpers.js';

export const changePasswordRouter = Router();

changePasswordRouter.post(
  '/change-password',
  authenticate,
  typedHandler({ body: ChangePasswordBodySchema }, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) {
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, password: true, suspendedAt: true },
      });
      if (!user || user.suspendedAt) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Password cannot be changed for this account.' } });
        return;
      }

      const { body } = req;
      const matches = await bcrypt.compare(body.currentPassword, user.password);
      if (!matches) {
        res.status(400).json({ success: false, error: { code: 'CURRENT_PASSWORD_INVALID', message: 'Current password is incorrect.' } });
        return;
      }

      const hashedPassword = await bcrypt.hash(body.newPassword, 10);
      await tenantScopedPrisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword, tokenVersion: { increment: 1 } },
      });

      res.json({ success: true, data: { changed: true } });
    } catch (error) {
      logger.error({ err: error }, 'Change password error:');
      res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error) } });
    }
  }),
);
