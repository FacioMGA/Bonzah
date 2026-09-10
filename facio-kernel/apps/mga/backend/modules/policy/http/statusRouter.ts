import type { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response, Router } from 'express';
import type { ApiResponse } from '../../../platform/types/index.js';
import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { enqueuePolicyListIndexUpdate } from '../app/policyListIndex.js';
import { errorMessage } from '../app/shared.js';
import { z } from 'zod';
import { derivePolicyState } from '../app/policyStateService.js';
import { transitionPolicyLifecycle } from '../app/commands/policyLifecycleCommands.js';

import { logger } from '../../../platform/utils/logger.js';
type ErrorBody = ApiResponse<null>;
const POLICY_START_MAX_DAYS_AHEAD = 45;

function sendError(res: { status: (code: number) => { json: (payload: ErrorBody) => unknown } }, status: number, code: string, message: string) {
  const payload: ErrorBody = {
    success: false,
    error: { code, message },
  };
  return res.status(status).json(payload);
}

function isInceptionDateWithinAllowedWindow(value: Date): boolean {
  const inception = new Date(value);
  inception.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const max = new Date(today);
  max.setDate(max.getDate() + POLICY_START_MAX_DAYS_AHEAD);
  return inception >= today && inception <= max;
}

const BodySchema = z.object({
  inceptionDate: z.string().optional(),
  expiryDate: z.string().optional(),
  status: z.string().optional(),
});

function policyAuditLog(req: Request, _res: Response, next: NextFunction): void {
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

/**
 * Policy header status/dates routes.
 *
 * Exported handler is kept for test/backwards compatibility.
 */
export const updatePolicyStatusHandler = async (
  req: { params: { id: string }; body: unknown; correlationId?: string },
  res: { status: (code: number) => { json: (payload: unknown) => unknown }; json: (payload: unknown) => unknown }
) => {
  try {
    const { id } = req.params;
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, 'BAD_REQUEST', 'Invalid policy update payload');
    }
    const inceptionDate = parsed.success ? parsed.data.inceptionDate : undefined;
    const expiryDate = parsed.success ? parsed.data.expiryDate : undefined;
    const status = parsed.success ? parsed.data.status : undefined;

    // IMMUTABILITY CHECK
    const current = await tenantScopedPrisma.policy.findUnique({ where: { id } });
    if (!current) {
      return sendError(res, 404, 'NOT_FOUND', 'Policy not found');
    }
    const currentState = derivePolicyState({
      status: current.status,
      inceptionDate: current.inceptionDate,
      expiryDate: current.expiryDate,
    });
    if (current.status && currentState.isIssued && status !== 'CANCELLED') {
      if ((process.env.NODE_ENV || '').toLowerCase() !== 'test') {
        logger.warn(`[PolicyUpdate] Attempt to modify active/issued policy ${id} rejected.`);
      }
      return res.status(403).json({ success: false, error: 'Cannot modify an active/issued policy. Please issue an Endorsement for changes.' });
    }

    const data: { inceptionDate?: Date; expiryDate?: Date; status?: string } = {};
    if (inceptionDate) data.inceptionDate = new Date(inceptionDate);
    if (expiryDate) data.expiryDate = new Date(expiryDate);
    if (status) data.status = status;

    if (data.inceptionDate && (Number.isNaN(data.inceptionDate.getTime()) || !isInceptionDateWithinAllowedWindow(data.inceptionDate))) {
      return sendError(
        res,
        400,
        'BAD_REQUEST',
        `Start date must be between today and ${POLICY_START_MAX_DAYS_AHEAD} days ahead`
      );
    }

    const policy = await runTenantScopedTransaction(async (_tx) => {
      const tx = _tx as unknown as Prisma.TransactionClient;
      if (status) {
        await transitionPolicyLifecycle({
          tx,
          policyId: id,
          to: status as Parameters<typeof transitionPolicyLifecycle>[0]['to'],
          actorId: 'system',
          actorType: 'SYSTEM',
          reasonCode: 'POLICY_HEADER_UPDATE',
          data: { source: 'policies/status.put' },
          correlationId: (req as { correlationId?: string }).correlationId,
        });
      }
      const dateData: { inceptionDate?: Date; expiryDate?: Date } = {};
      if (data.inceptionDate) dateData.inceptionDate = data.inceptionDate;
      if (data.expiryDate) dateData.expiryDate = data.expiryDate;
      const updated = Object.keys(dateData).length > 0
        ? await tx.policy.update({
          where: { id },
          data: dateData,
        })
        : { ...current, ...(status ? { status } : {}) };
      await enqueuePolicyListIndexUpdate(tx, id);
      return updated;
    });

    // Also update Search Index if exists
    try {
      await tenantScopedPrisma.policySearchIndex.update({
        where: { policyId: id },
        data: {
          status: status || undefined,
          // Dates are pulled via relation now, so no need to update index unless we add cols back
        }
      });
    } catch {
      // Ignore if index doesn't exist
    }

    return res.json({ success: true, data: policy });
  } catch (error) {
    logger.error({ err: error }, 'Update policy error:');
    return sendError(res, 500, 'UPDATE_ERROR', errorMessage(error, 'Failed to update policy'));
  }
};

export function registerPolicyStatusRoutes(router: Router) {
  router.put('/:id', policyAuditLog, updatePolicyStatusHandler);
}

