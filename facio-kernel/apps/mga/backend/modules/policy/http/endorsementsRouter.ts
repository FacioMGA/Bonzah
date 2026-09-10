import type { NextFunction, Request, Response, Router } from 'express';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { z } from 'zod';
import { logger } from '../../../platform/utils/logger.js';
import { requirePermission } from '../../accessControl/http/permissionMiddleware.js';
import {
  executeCreateEndorsementDraft,
  executePatchEndorsementDraft,
  executeCancelEndorsementDraft,
  executeRateEndorsementDraft,
  executeSaveEndorsementVersion,
  executeBindEndorsementDraft,
  executeIssueEndorsement,
} from '../app/endorsementCommands.js';

const DraftCreateBodySchema = z.object({
  effectiveDate: z.string(),
  reason: z.string().optional(),
  reasonCode: z.string().optional(),
});
const DraftPatchBodySchema = z.object({
  effectiveDate: z.string().optional(),
  expiryDate: z.string().optional(),
  quoteData: z.record(z.string(), z.unknown()).optional(),
  quoteResponse: z.record(z.string(), z.unknown()).optional(),
  coverageSelection: z.record(z.string(), z.unknown()).optional(),
  uwDecision: z.record(z.string(), z.unknown()).optional(),
  pricing: z.record(z.string(), z.unknown()).optional(),
  endorsementMeta: z.record(z.string(), z.unknown()).optional(),
});
const RateBodySchema = z.object({
  overrideExcess: z.number().optional(),
});
const IssueBodySchema = z.object({
  confirmManualRefundAck: z.boolean().optional(),
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

function actorFromRequest(req: { user?: Express.UserTokenPayload }) {
  const user = req.user;
  return {
    id: user && typeof user.id === 'string' ? user.id : undefined,
    name: user && typeof user.name === 'string' ? user.name : undefined,
    email: user && typeof user.email === 'string' ? user.email : undefined,
    role: user && typeof user.role === 'string' ? user.role : undefined,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Endorsements routes — RiskTransaction-backed endorsement workspace.
 */
export function registerPolicyEndorsementRoutes(router: Router) {
  /**
   * GET /api/policies/:id/endorsements
   * Fetch endorsements for a specific policy
   */
  router.get('/:id/endorsements', policyAuditLog, async (req, res) => {
    try {
      const { id } = req.params;
      const endorsements = await tenantScopedPrisma.endorsement.findMany({
        where: { policyId: id },
        orderBy: { endorsementNo: 'desc' }
      });

      res.json({ success: true, data: endorsements });
    } catch (error) {
      logger.error({ err: error }, 'Fetch endorsements error:');
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  /**
   * GET /api/policies/:id/endorsements
   * List active endorsements for a policy
   */
  router.get('/:id/endorsement-instances', policyAuditLog, async (req, res) => {
    try {
      const { id } = req.params;
      const endorsements = await tenantScopedPrisma.endorsementInstance.findMany({
        where: { policyId: id },
        orderBy: { createdAt: 'desc' }
      });
      res.json({ success: true, data: endorsements });
    } catch (error) {
      logger.error({ err: error }, 'List endorsements error:');
      res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: (error as Error).message } });
    }
  });

  /**
   * POST /api/policies/:id/endorsements/draft
   * Creates an endorsement working draft (RiskTransaction DRAFT) from the latest issued snapshot.
   */
  router.post('/:id/endorsements/draft', policyAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const actor = actorFromRequest(req);
      const useCaseActor = {
        id: actor.id ?? null,
        name: actor.name ?? null,
        email: actor.email ?? null,
        role: actor.role ?? null,
      };
      const parsedBody = DraftCreateBodySchema.safeParse(req.body);
      const effectiveDateRaw = String(parsedBody.success ? parsedBody.data.effectiveDate : '').trim();
      const reason = String(parsedBody.success ? (parsedBody.data.reason || '') : '').trim() || null;
      const reasonCode = String(parsedBody.success ? (parsedBody.data.reasonCode || '') : '').trim() || null;

      if (!effectiveDateRaw) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'effectiveDate is required' } });
      }
      const effectiveDate = new Date(effectiveDateRaw);
      if (Number.isNaN(effectiveDate.getTime())) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'effectiveDate must be a valid date' } });
      }

      const result = await executeCreateEndorsementDraft({
        policyId,
        effectiveDate,
        reason,
        reasonCode,
        actor: useCaseActor
      });

      if (result.status !== 'SUCCESS') {
        const statusCode = result.status === 'NOT_FOUND' ? 404 : result.status === 'INVALID_STATUS' ? 400 : 500;
        return res.status(statusCode).json({ success: false, error: result.error });
      }

      return res.json({ success: true, data: result.data });
    } catch (error) {
      logger.error({ err: error }, 'Create endorsement draft error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to create endorsement draft') } });
    }
  });

  /**
   * PATCH /api/policies/:id/endorsements/:riskTransactionId/draft
   * Updates the endorsement workspace snapshot (quoteData + other top-level keys) without mutating issued records.
   */
  router.patch('/:id/endorsements/:riskTransactionId/draft', policyAuditLog, async (req, res) => {
    try {
      const { id: policyId, riskTransactionId } = req.params;
      const actor = actorFromRequest(req);
      const useCaseActor = {
        id: actor.id ?? null,
        name: actor.name ?? null,
        email: actor.email ?? null,
        role: actor.role ?? null,
      };
      const parsedBody = DraftPatchBodySchema.safeParse(req.body);
      const body = parsedBody.success ? parsedBody.data : {};

      const result = await executePatchEndorsementDraft({
        policyId,
        riskTransactionId,
        actor: useCaseActor,
        body
      });

      if (result.status !== 'SUCCESS') {
        return res.status(500).json({ success: false, error: result.error });
      }

      return res.json({ success: true, data: result.data });
    } catch (error) {
      logger.error({ err: error }, 'Patch endorsement draft error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to update endorsement draft') } });
    }
  });

  /**
   * POST /api/policies/:id/endorsements/:riskTransactionId/cancel
   * Cancels an endorsement draft and restores the current BO workspace snapshot
   * back to the latest issued (BOUND) version.
   */
  router.post('/:id/endorsements/:riskTransactionId/cancel', policyAuditLog, async (req, res) => {
    try {
      const { id: policyId, riskTransactionId } = req.params;
      const actor = actorFromRequest(req);
      const useCaseActor = {
        id: actor.id ?? null,
        name: actor.name ?? null,
        email: actor.email ?? null,
        role: actor.role ?? null,
      };

      const result = await executeCancelEndorsementDraft({
        policyId,
        riskTransactionId,
        actor: useCaseActor
      });

      if (result.status !== 'SUCCESS') {
        return res.status(500).json({ success: false, error: result.error });
      }

      return res.json({ success: true, data: result.data });
    } catch (error) {
      logger.error({ err: error }, 'Cancel endorsement draft error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to cancel endorsement draft') } });
    }
  });

  /**
   * POST /api/policies/:id/endorsements/:riskTransactionId/rate
   * Rates an endorsement draft and persists quoteResponse + pricing hashes into the draft snapshot.
   */
  router.post('/:id/endorsements/:riskTransactionId/rate', policyAuditLog, async (req, res) => {
    try {
      const { id: policyId, riskTransactionId } = req.params;

      const actor = actorFromRequest(req);
      const parsedBody = RateBodySchema.safeParse(req.body);
      const overrideExcess = parsedBody.success ? parsedBody.data.overrideExcess : undefined;
      const useCaseActor = {
        id: actor.id ?? null,
        name: actor.name ?? null,
        email: actor.email ?? null,
        role: actor.role ?? null,
      };

      const result = await executeRateEndorsementDraft({
        policyId,
        riskTransactionId,
        actor: useCaseActor,
        overrideExcess
      });

      if (result.status !== 'SUCCESS') {
        const statusCode = result.status === 'NOT_FOUND' ? 404 : result.status === 'INVALID_QUOTE_DATA' ? 400 : 500;
        return res.status(statusCode).json({ success: false, error: result.error });
      }

      return res.json({ success: true, data: result.data });
    } catch (error) {
      logger.error({ err: error }, 'Rate endorsement draft error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to rate endorsement draft') } });
    }
  });

  /**
   * POST /api/policies/:id/endorsements/save-version
   * Atomically forks an endorsement draft into a new rated version.
   * Replaces the previous frontend-orchestrated create+patch+rate sequence.
   */
  router.post('/:id/endorsements/save-version', policyAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const body = parseRecord(req.body);
      const sourceRiskTransactionId = String(body.sourceRiskTransactionId || '').trim();
      if (!sourceRiskTransactionId) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'sourceRiskTransactionId is required' } });
      }
      const actor = actorFromRequest(req);
      const result = await executeSaveEndorsementVersion({
        policyId,
        sourceRiskTransactionId,
        actor: { id: actor.id || 'system', role: actor.role || 'SYSTEM', name: actor.name, email: actor.email },
        correlationId: req.correlationId,
      });
      if (result.status !== 'SUCCESS') {
        const code = result.status === 'NOT_FOUND' ? 404 : 422;
        return res.status(code).json({ success: false, error: result.error });
      }
      return res.json({ success: true, data: result.data });
    } catch (error) {
      logger.error({ err: error }, 'Save endorsement version error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to save endorsement version') } });
    }
  });

  /**
   * POST /api/policies/:id/endorsements/:riskTransactionId/bind
   * Freezes an endorsement draft into an immutable (BOUND) version.
   */
  router.post('/:id/endorsements/:riskTransactionId/bind', policyAuditLog, requirePermission('endorsements', 'bind'), async (req, res) => {
    try {
      const { id: policyId, riskTransactionId } = req.params;
      const actor = actorFromRequest(req);
      const useCaseActor = {
        id: actor.id ?? null,
        name: actor.name ?? null,
        email: actor.email ?? null,
        role: actor.role ?? null,
      };

      const result = await executeBindEndorsementDraft({
        policyId,
        riskTransactionId,
        actor: useCaseActor
      });

      if (result.status !== 'SUCCESS') {
        const statusCode = result.status === 'BLOCKED' ? 400 : 500;
        return res.status(statusCode).json({ success: false, error: result.error });
      }

      return res.json({ success: true, data: result.data });
    } catch (error) {
      logger.error({ err: error }, 'Bind endorsement draft error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to bind endorsement') } });
    }
  });

  /**
   * POST /api/policies/:id/endorsements/:riskTransactionId/issue
   * Issues an endorsement: generates ENDORSEMENT_PACK and records premium movement.
   */
  router.post('/:id/endorsements/:riskTransactionId/issue', policyAuditLog, requirePermission('policies', 'issue'), async (req, res) => {
    try {
      const { id: policyId, riskTransactionId } = req.params;
      const actor = actorFromRequest(req);
      const issueBody = IssueBodySchema.safeParse(req.body);
      const confirmManualRefundAck = Boolean(issueBody.success && issueBody.data.confirmManualRefundAck);
      const useCaseActor = {
        id: actor.id ?? null,
        name: actor.name ?? null,
        email: actor.email ?? null,
        role: actor.role ?? null,
      };

      const result = await executeIssueEndorsement({
        policyId,
        riskTransactionId,
        actor: useCaseActor,
        confirmManualRefundAck,
        correlationId: req.correlationId
      });

      if (result.status !== 'SUCCESS') {
        const statusCode = result.status === 'NOT_FOUND' ? 404 : result.status === 'BAD_REQUEST' || result.status === 'INVALID_STATUS' || result.status === 'MANUAL_REFUND_ACK_REQUIRED' ? 400 : 500;
        return res.status(statusCode).json({ success: false, error: result.error });
      }

      return res.json({ success: true, data: result.data });
    } catch (error) {
      logger.error({ err: error }, 'Issue endorsement error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to issue endorsement') } });
    }
  });

}

