import type { NextFunction, Request, Response, Router } from 'express';
import type { ApiResponse } from '../../../platform/types/index.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { actorFromRequest } from '../app/shared.js';

import { logger } from '../../../platform/utils/logger.js';
import { errorMessage } from '../../../platform/http/httpErrors.js';
type ErrorBody = ApiResponse<null>;

function policyAdminAuditLog(req: Request, _res: Response, next: NextFunction): void {
  try {
    const correlationId = (req.headers['x-correlation-id'] as string) || req.correlationId;
    const actionId = req.headers['x-action-id'] as string;
    const tenantId = String(req.headers['x-tenant-id'] || '').trim() || undefined;
    const textUser = req.user;
    const actorId = textUser?.id || 'system';
    const actorType = textUser?.role || 'SYSTEM';
    req.auditContext = { correlationId, actionId, tenantId, actorId, actorType };
    next();
  } catch {
    next();
  }
}

function sendError(res: { status: (code: number) => { json: (payload: ErrorBody) => unknown } }, status: number, code: string, message: string) {
  const payload: ErrorBody = {
    success: false,
    error: { code, message },
  };
  return res.status(status).json(payload);
}

export function registerPolicyAdminRoutes(router: Router) {
  /**
   * DELETE /api/policies/:id
   * Delete a policy and all related data (Cascading delete manually)
   */
  router.delete('/:id', policyAdminAuditLog, async (req, res) => {
    try {
      const { id } = req.params;
      const actor = actorFromRequest(req);

      await tenantScopedPrisma.policy.delete({ where: { id } });

      // Audit Log (Before or After? After is risky if ID gone, but for Audit Table it persists usually)
      // Audit Action links to EntityId (String) so it stays even if Policy table row deleted
      void AuditLogger.log(id, 'POLICY', 'POLICY.DELETED', actor.id || 'system', 'USER', {
        reason: 'Manual deletion'
      });

      res.json({ success: true, message: 'Policy deleted successfully' });
    } catch (error) {
      logger.error({ err: error }, 'Delete policy error:');
      sendError(res, 500, 'DELETE_ERROR', errorMessage(error, 'Failed to delete policy'));
    }
  });
}

