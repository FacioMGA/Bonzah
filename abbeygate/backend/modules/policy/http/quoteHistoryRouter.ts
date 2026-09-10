import type { NextFunction, Request, Response, Router } from 'express';
import { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { jsonParse, jsonStringify } from '../app/shared.js';
import { saveQuoteVersion } from '../app/history/saveQuoteVersion.js';
import { transitionPolicyLifecycle } from '../app/commands/policyLifecycleCommands.js';
import { forkQuoteWorkspaceInTx } from '../app/quoteLifecycle/forkQuoteWorkspace.js';

import { logger } from '../../../platform/utils/logger.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import { errorMessage } from '../../../platform/http/httpErrors.js';
function policyQuoteHistoryAuditLog(req: Request, _res: Response, next: NextFunction): void {
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

function parseSnapshot(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return parseRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return parseRecord(value);
}

function actorFromRequest(req: { user?: Express.UserTokenPayload }) {
  const user = req.user;
  return {
    id: user && typeof user.id === 'string' ? user.id : undefined,
    role: user && typeof user.role === 'string' ? user.role : undefined,
  };
}

function toNullableJsonInput(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null) return Prisma.JsonNull;
  return toInputJson(value);
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => (item === null ? null : toInputJson(item)));
  if (value && typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [k, v] of Object.entries(value)) out[k] = v === null ? null : toInputJson(v);
    return out;
  }
  return {};
}

export function registerPolicyQuoteHistoryRoutes(router: Router) {
  /**
   * POST /api/policies/:id/quote-history/archive
   * Archives current quoteData/quoteResponse into PolicyQuoteHistory and unlocks the policy for editing.
   * This is the BO "fork" behavior (versioning within the same policy).
   */
  router.post('/:id/quote-history/archive', policyQuoteHistoryAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const actor = actorFromRequest(req);

      const exists = await tenantScopedPrisma.policy.findUnique({
        where: { id: policyId },
        select: { id: true },
      });
      if (!exists) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });

      // Delegate to the canonical service. Same writes / audit / events
      // as the previous inline path (operator MCP V2 / ADR-0039 §2).
      const updated = await tenantScopedPrisma.$transaction(async (_tx) => {
        const tx = _tx as unknown as Prisma.TransactionClient;
        return forkQuoteWorkspaceInTx(tx, {
          policyId,
          actor: {
            id: actor?.id || 'system',
            role: actor?.role ? 'UNDERWRITER' : 'SYSTEM',
          },
          correlationId: req.correlationId,
        });
      });

      await AuditLogger.log(
        policyId,
        'POLICY',
        'POLICY.QUOTE_VERSION.ARCHIVED',
        actor?.id || 'system',
        actor?.role ? 'USER' : 'SYSTEM',
        { version: updated.archivedVersion }
      );

      return res.json({ success: true, data: { version: updated.archivedVersion } });
    } catch (error) {
      logger.error({ err: error }, 'Archive quote history error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to archive quote version') } });
    }
  });

  /**
   * POST /api/policies/:id/quote-history/save
   * Snapshots the current quoteData/quoteResponse into PolicyQuoteHistory WITHOUT changing the current policy.
   * Used by BO Premium tab "Save version" after a successful recalculation.
   */
  router.post('/:id/quote-history/save', policyQuoteHistoryAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;

      const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: policyId },
        include: { quoteHistory: { orderBy: { version: 'desc' }, take: 1 } },
      });
      if (!policy) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });

      const created = await tenantScopedPrisma.$transaction(async (_tx) => {
        return await saveQuoteVersion(_tx, {
          policyId,
          quoteData: policy.quoteData || {},
          quoteResponse: policy.quoteResponse || {},
          isLockedSnapshot: Boolean(policy.isLocked),
        });
      });

      const actor = actorFromRequest(req);
      await AuditLogger.log(
        policyId,
        'POLICY',
        'POLICY.QUOTE_VERSION.SAVED',
        actor?.id || 'system',
        actor?.role ? 'USER' : 'SYSTEM',
        { version: created.version }
      );

      return res.json({ success: true, data: created });
    } catch (error) {
      logger.error({ err: error }, 'Save quote history error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to save quote version') } });
    }
  });

  /**
   * POST /api/policies/:id/quote-history/:historyId/restore
   * Restores a historical quote version as the current working version.
   * Archives the current state first so restore is reversible.
   */
  router.post('/:id/quote-history/:historyId/restore', policyQuoteHistoryAuditLog, async (req, res) => {
    try {
      const { id: policyId, historyId } = req.params;

      const [policy, history] = await Promise.all([
        tenantScopedPrisma.policy.findUnique({ where: { id: policyId }, include: { quoteHistory: { orderBy: { version: 'desc' }, take: 1 } } }),
        tenantScopedPrisma.policyQuoteHistory.findUnique({ where: { id: historyId } }),
      ]);

      if (!policy) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });
      if (!history || String(history.policyId) !== policyId) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quote version not found' } });
      }

      const restored = await tenantScopedPrisma.$transaction(async (_tx) => {
        const tx = _tx as unknown as Prisma.TransactionClient;
        const archived = await saveQuoteVersion(tx, {
          policyId,
          quoteData: policy.quoteData || {},
          quoteResponse: policy.quoteResponse || {},
          isLockedSnapshot: Boolean(policy.isLocked),
        });

        // Restore selected
        const nextQuoteData = history.quoteData || {};
        const nextQuoteResponse = history.quoteResponse || null;
        const nextLifecycleStatus = (() => {
          const s = String(parseRecord(nextQuoteResponse).status || '').toLowerCase();
          if (s === 'declined') return 'DECLINED';
          if (s === 'referral') return 'REFERRAL';
          if (s === 'quoted') return 'QUOTED';
          return 'DRAFT';
        })();

        await tx.policy.update({
          where: { id: policyId },
          data: {
            isLocked: false,
            quoteData: toInputJson(nextQuoteData),
            quoteResponse: toNullableJsonInput(nextQuoteResponse),
          },
        });
        await transitionPolicyLifecycle({
          tx,
          policyId,
          to: nextLifecycleStatus as Parameters<typeof transitionPolicyLifecycle>[0]['to'],
          actorId: actorFromRequest(req)?.id || 'system',
          actorType: actorFromRequest(req)?.role ? 'USER' : 'SYSTEM',
          reasonCode: 'QUOTE_VERSION_RESTORED',
          correlationId: req.correlationId,
          data: { restoredVersionId: historyId },
        });

        const state = await tx.policyStateCurrent.findUnique({ where: { policyId } });
        const prev = state ? parseSnapshot(jsonParse(state.snapshot)) : {};
        const nextSnap = { ...prev, quoteData: nextQuoteData, quoteResponse: nextQuoteResponse };
        await tx.policyStateCurrent.upsert({
          where: { policyId },
          update: { snapshot: jsonStringify(nextSnap) },
          create: { policyId, snapshot: jsonStringify(nextSnap) } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
        });

        return { restoredVersionId: historyId, archivedVersion: archived.version, status: nextLifecycleStatus };
      });

      const actor = actorFromRequest(req);
      await AuditLogger.log(
        policyId,
        'POLICY',
        'POLICY.QUOTE_VERSION.RESTORED',
        actor?.id || 'system',
        actor?.role ? 'USER' : 'SYSTEM',
        { restoredVersionId: historyId, archivedVersion: restored.archivedVersion }
      );

      return res.json({ success: true, data: restored });
    } catch (error) {
      logger.error({ err: error }, 'Restore quote history error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to restore quote version') } });
    }
  });
}

