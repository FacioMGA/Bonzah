import type { NextFunction, Request, Response, Router } from 'express';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { derivePolicyState } from '../app/policyStateService.js';
import { evaluateIssueReadiness } from '../app/issueReadiness.js';

function policyStateAuditLog(req: Request, _res: Response, next: NextFunction): void {
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function registerPolicyStateRoutes(router: Router) {
  router.get('/:id/state', policyStateAuditLog, async (req, res) => {
    try {
      const { id } = req.params;
      const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id },
        include: {
          stateCurrent: true,
          claims: { select: { status: true } },
        },
      });
      if (!policy) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });
      }

      const readiness = await evaluateIssueReadiness(id, 'bo').catch(() => null);
      const draftTx = await tenantScopedPrisma.riskTransaction.findMany({
        where: { policyId: id, status: { in: ['DRAFT', 'REFERRED', 'APPROVED', 'PENDING_DOCS'] } },
        select: { status: true, transactionType: true },
        take: 20,
      });
      const state = derivePolicyState({
        status: policy.status,
        inceptionDate: policy.inceptionDate,
        expiryDate: policy.expiryDate,
        isLocked: policy.isLocked,
        stateCurrentSnapshot: policy.stateCurrent?.snapshot,
        riskTransactions: draftTx,
        claims: policy.claims,
        issueReadiness: readiness ? { canIssue: readiness.canIssue } : null,
      });

      return res.json({
        success: true,
        data: {
          policyId: policy.id,
          policyNumber: policy.policyNumber,
          status: policy.status,
          bo_status: state.boStatus,
          state,
          diagnostics: {
            hasStateSnapshot: Boolean(asRecord(policy.stateCurrent).snapshot),
            canIssue: Boolean(readiness?.canIssue),
          },
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error instanceof Error ? error.message : 'Failed to derive policy state' },
      });
    }
  });
}
