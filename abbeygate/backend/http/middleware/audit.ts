
import { Request, Response, NextFunction } from 'express';

import { logger } from '../../platform/utils/logger.js';

export type AuditContext = Express.AuditContext;

export async function auditLog(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const correlationId = (req.headers['x-correlation-id'] as string) || req.correlationId;
    const actionId = req.headers['x-action-id'] as string;
    const tenantId = String(req.headers['x-tenant-id'] || '').trim() || undefined;

    const actorId = req.user?.id || 'system';
    const actorType = req.user?.role || 'SYSTEM';

    req.auditContext = {
      correlationId,
      actionId,
      tenantId,
      actorId,
      actorType,
    };

    if (correlationId) {
      logger.info(`[Audit] Context Established: ${actionId} [${correlationId}]`);
    }

    next();
  } catch (e) {
    logger.error({ err: e }, '[AuditMiddleware] Failed to capture context');
    next();
  }
}

export const getAuditContext = (req: Request): AuditContext => {
  return req.auditContext || {};
};
