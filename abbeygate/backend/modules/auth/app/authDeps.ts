import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import {
  sendEmailVerificationOtpEmail,
  sendPasswordResetOtpEmail,
  sendPasswordResetLinkEmail,
} from '../../communications/domain/notifications/email.js';
import { logger } from '../../../platform/utils/logger.js';

export {
  prisma,
  tenantScopedPrisma,
  sendEmailVerificationOtpEmail,
  sendPasswordResetOtpEmail,
  sendPasswordResetLinkEmail,
  logger,
};
