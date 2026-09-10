import type { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response, Router } from 'express';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { DocumentService } from '../../documents/app/documentService.js';
import { jsonParse, jsonStringify } from '../app/shared.js';
import { enqueuePolicyListIndexUpdate } from '../app/policyListIndex.js';
import { validateDraftQuote } from '../../quotes/app/validator.js';
import { z } from 'zod';

import { transitionPolicyLifecycle } from '../app/commands/policyLifecycleCommands.js';
import { transitionRiskTransactionStatus } from '../app/commands/riskPaymentDocCommands.js';

import { logger } from '../../../platform/utils/logger.js';
import {
  executeBindCoverage,
  executeIssuePolicy,
  executeBindPolicy,
  executeCreateFromQuote,
} from '../app/policyCommands.js';
import {
  parseRecord,
  parseSnapshot,
  quoteCurrency,
  quotePrimaryAnnualPremium,
  normalizeOverrideExcess,
} from '../../../platform/utils/mappingHelpers.js';
import { buildQuoteResponseForProduct, productAdapterExists } from '../app/productRegistryService.js';
import { normalizeProgramMbeProductConfig, resolveCoverageV1 } from '../app/mbeInterop.js';
import { errorMessage } from '../../../platform/http/httpErrors.js';
import { requirePermission } from '../../accessControl/http/permissionMiddleware.js';

const GenerateDocumentsBodySchema = z.object({
  docPack: z.enum(['QUOTE_PACK', 'DRAFT_POLICY_PACK', 'ISSUED_POLICY_PACK', 'ENDORSEMENT_PACK']).optional(),
  riskTransactionId: z.string().optional(),
});

const CalculatePremiumBodySchema = z.object({
  quoteData: z.record(z.string(), z.unknown()),
  overrideExcess: z.union([z.number(), z.string(), z.null()]).optional(),
  productType: z.string().trim().min(1, 'productType is required'),
});

const CreateFromQuoteBodySchema = z.object({
  quoteData: z.unknown(),
  paymentInfo: z.unknown().optional(),
  quoteToken: z.string().optional(),
});

// parseRecord extracted to mappingHelpers.js

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

// mapping helpers extracted to mappingHelpers.js
/**
 * Binding/issuance routes.
 * URL paths + response shapes are part of the OpenAPI surface; consult that as the single source of truth before changing them.
 */
export function registerPolicyBindingRoutes(router: Router) {
  /**
   * POST /api/policies/:id/bind-coverage
   * Binds coverage legally (without issuing final documents).
   *
   * - Requires issue-readiness to have no blocking blockers (WARN are ok)
   * - Creates an INCEPTION RiskTransaction (status=BOUND) with immutable snapshotFinal
   * - Records binding timestamp + user
   * - Sets policy status to BOUND
   */
  router.post('/:id/bind-coverage', policyAuditLog, requirePermission('policies', 'bind'), async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const actor = actorFromRequest(req);

      const result = await executeBindCoverage({
        policyId,
        actor: { id: actor?.id || null, name: actor?.name || null, email: actor?.email || null, role: actor?.role || null },
        correlationId: req.correlationId || '',
      });

      if (result.status !== 'SUCCESS') {
        const statusCode = result.status === 'NOT_FOUND' ? 404 : result.status === 'INVALID_STATUS' || result.status === 'BLOCKED' ? 400 : 500;
        return res.status(statusCode).json({ success: false, error: result.error });
      }

      return res.json({ success: true, data: result.data });
    } catch (error) {
      logger.error({ err: error }, 'Bind coverage error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to bind coverage') } });
    }
  });

  /**
   * POST /api/policies/:id/unlock-bound-mode
   * Releases the lock after binding (operator correction flow).
   *
   * Semantics:
   * - Moves policy back to QUOTED + isLocked=false so BO tabs become editable
   * - Downgrades the latest bound INCEPTION risk transaction back to DRAFT (so it won't be used for issuance)
   * - Records who/when cancelled in policyStateCurrent.snapshot.binding
   */
  router.post('/:id/unlock-bound-mode', policyAuditLog, requirePermission('policies', 'bind'), async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const actor = actorFromRequest(req);

      const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: policyId },
        include: { stateCurrent: true },
      });
      if (!policy) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });

      const st = String(policy.status || '').toUpperCase();
      if (!(st === 'BOUND' || st === 'BOUND_DRAFT_ISSUED')) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: `Cannot unlock bound mode from status '${policy.status}'` } });
      }

      const prevSnap = policy.stateCurrent ? parseSnapshot(jsonParse(policy.stateCurrent.snapshot)) : {};
      const nextSnapshot = {
        ...prevSnap,
        binding: {
          ...parseRecord(prevSnap.binding),
          cancelledAt: new Date().toISOString(),
          cancelledBy: {
            id: actor?.id || null,
            name: actor?.name || null,
            email: actor?.email || null,
            role: actor?.role || null,
          },
          cancelReason: 'Operator unlocked bound mode for corrections',
        },
      };

      const updated = await tenantScopedPrisma.$transaction(async (_tx) => {
        const tx = _tx as unknown as Prisma.TransactionClient;
        // Downgrade latest bound inception risk transaction (if exists)
        const riskTxn = await tx.riskTransaction.findFirst({
          where: { policyId, transactionType: 'INCEPTION', status: 'BOUND' },
          orderBy: { transactionNumber: 'desc' },
        });
        if (riskTxn?.id) {
          await transitionRiskTransactionStatus({
            tx,
            riskTransactionId: riskTxn.id,
            to: 'DRAFT',
            actorId: actor?.id || 'system',
            actorType: 'USER',
            reasonCode: 'BOUND_MODE_CANCELLED',
            correlationId: req.correlationId,
          });
          await tx.riskTransaction.update({
            where: { id: riskTxn.id },
            data: {
              snapshotDraft: riskTxn.snapshotFinal || riskTxn.snapshotDraft || undefined,
            },
          });
        }

        await transitionPolicyLifecycle({
          tx,
          policyId,
          to: 'QUOTED',
          actorId: actor?.id || 'system',
          actorType: 'USER',
          reasonCode: 'BOUND_MODE_CANCELLED',
          correlationId: req.correlationId,
        });
        await tx.policy.update({
          where: { id: policyId },
          data: { isLocked: false },
        });
        await tx.policySearchIndex.update({ where: { policyId }, data: { status: 'QUOTED' } }).catch(() => undefined);
        await enqueuePolicyListIndexUpdate(tx, policyId);

        await tx.policyStateCurrent.upsert({
          where: { policyId },
          update: { snapshot: jsonStringify(nextSnapshot) },
          create: { policyId, snapshot: jsonStringify(nextSnapshot) } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
        });

        return { status: 'QUOTED' };
      });

      void AuditLogger.log(
        policyId,
        'POLICY',
        'POLICY.BOUND_MODE.CANCELLED',
        actor?.id || 'system',
        'USER',
        { fromStatus: policy.status, toStatus: updated.status },
        actor?.name
      );

      return res.json({ success: true, data: updated });
    } catch (error) {
      logger.error({ err: error }, 'Unlock bound mode error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to unlock bound mode') } });
    }
  });

  /**
   * POST /api/policies/:id/issue-policy
   * Issues the final policy documents after coverage is bound.
   *
   * - Requires policy to be BOUND or BOUND_DRAFT_ISSUED
   * - Generates ISSUED_POLICY_PACK using the latest bound INCEPTION risk transaction snapshot
   * - Sends the policy pack to the customer (and broker if available)
   * - Updates policy lifecycle to ISSUED/ACTIVE
   */
  router.post('/:id/issue-policy', policyAuditLog, requirePermission('policies', 'issue'), async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const actor = actorFromRequest(req);

      const result = await executeIssuePolicy({
        policyId,
        actor: { id: actor?.id || null, name: actor?.name || null, email: actor?.email || null, role: actor?.role || null },
        correlationId: req.correlationId || '',
      });

      if (result.status !== 'SUCCESS') {
        const statusCode =
          result.status === 'NOT_FOUND'
            ? 404
            : result.status === 'INVALID_STATUS' || result.status === 'MISSING_TRANSACTION' || result.status === 'BLOCKED'
              ? 400
              : 500;
        return res.status(statusCode).json({ success: false, error: result.error });
      }

      return res.json({ success: true, data: result.data });
    } catch (error) {
      logger.error({ err: error }, 'Issue policy error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to issue policy') } });
    }
  });

  /**
   * POST /api/policies/:id/documents/generate
   * Generate deterministic PDF document packs.
   *
   * Body: { docPack: 'QUOTE_PACK'|'ISSUED_POLICY_PACK'|'ENDORSEMENT_PACK', riskTransactionId?: string }
   */
  router.post('/:id/documents/generate', policyAuditLog, requirePermission('documents', 'generate'), async (req, res) => {
    try {
      const { id } = req.params;
      const parsedBody = GenerateDocumentsBodySchema.safeParse(req.body);
      const docPack = parsedBody.success ? parsedBody.data.docPack : undefined;
      const riskTransactionId = parsedBody.success ? parsedBody.data.riskTransactionId : undefined;
      const pack = docPack || null;
      if (!pack) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'docPack is required' } });
      }

      const actor = actorFromRequest(req);
      const result = await DocumentService.generate({
        policyId: id,
        riskTransactionId: riskTransactionId || null,
        docPack: pack,
        source: 'BO',
        generatedByUserId: actor.id || null,
      });

      void AuditLogger.log(id, 'POLICY', 'DOCUMENTS.GENERATED', actor.id || 'system', 'USER', { docPack: pack, version: result.version }, actor.name);

      // Draft semantics: mark policy as "Bound – Draft Issued" when a draft policy pack is generated.
      if (pack === 'DRAFT_POLICY_PACK') {
        try {
          const state = await tenantScopedPrisma.policyStateCurrent.findUnique({ where: { policyId: id } });
          const prev = state ? parseSnapshot(jsonParse(state.snapshot)) : {};
          const nextSnapshot = {
            ...prev,
            binding: {
              ...parseRecord(prev.binding),
              draftIssuedAt: new Date().toISOString(),
              draftIssuedBy: actor.id || null,
            },
          };
          await tenantScopedPrisma.policyStateCurrent.upsert({
            where: { policyId: id },
            update: { snapshot: jsonStringify(nextSnapshot) },
            create: { policyId: id, snapshot: jsonStringify(nextSnapshot) } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
          });
          await tenantScopedPrisma.$transaction(async (_tx) => {
            const tx = _tx as unknown as Prisma.TransactionClient;
            await transitionPolicyLifecycle({
              tx,
              policyId: id,
              to: 'BOUND_DRAFT_ISSUED',
              actorId: actor.id || 'system',
              actorType: 'USER',
              reasonCode: 'DRAFT_POLICY_PACK_GENERATED',
              correlationId: req.correlationId,
            });
          }).catch(() => undefined);
          await tenantScopedPrisma.policySearchIndex.update({ where: { policyId: id }, data: { status: 'BOUND_DRAFT_ISSUED' } }).catch(() => undefined);
          await enqueuePolicyListIndexUpdate(prisma, id);
        } catch (e) {
          logger.error({ err: e }, 'Failed to mark draft issued:');
        }
      }

      return res.json({ success: true, data: result });
    } catch (error) {
      logger.error({ err: error }, 'Generate documents error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: (error as Error).message } });
    }
  });

  router.post('/:id/bind', policyAuditLog, requirePermission('policies', 'bind'), bindPolicyHandler);

  /**
   * POST /api/policies/calculate-premium
   * Calculate premium from quote data
   */
  router.post('/calculate-premium', policyAuditLog, async (req, res) => {
    try {
      const parsed = CalculatePremiumBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } });
      }
      const quoteData = parsed.data.quoteData;
      const overrideExcess = normalizeOverrideExcess(parsed.data.overrideExcess);

      const quoteValidation = validateDraftQuote({
        quoteData,
        step: 'bo-calculate-premium',
        mode: 'issuance',
        productType: parsed.data.productType,
      });
      if (!quoteValidation.valid) {
        return res.status(400).json({ success: false, error: { code: 'QUOTE_DATA_INVALID', details: quoteValidation.schemaIssues } });
      }
      const normalizedQuoteData = quoteValidation.normalizedQuoteData;
      const quoteDataRecord: Record<string, unknown> = { ...normalizedQuoteData };

      const productType = parsed.data.productType.toUpperCase();
      if (!productAdapterExists(productType)) return res.status(500).json({ success: false, error: { code: 'NO_ADAPTER', message: `No product adapter for '${productType}'` } });

      const normalizedMbeCfg = normalizeProgramMbeProductConfig({}, {
        productType,
        programCode: `abbeygate_${String(productType || '').trim().toLowerCase()}`,
      });
      const resolvedCoverageSet = resolveCoverageV1({
        productType,
        quoteData: normalizedQuoteData,
        cfg: normalizedMbeCfg,
      });
      const { quoteResponse } = await buildQuoteResponseForProduct({ productType, quoteData: normalizedQuoteData, resolvedCoverageSet });

      const { signQuoteToken } = await import('../../pricing/app/quoteToken.js');
      const totalPremium = quotePrimaryAnnualPremium(quoteResponse);
      const { token: quoteToken } = signQuoteToken({
        productType,
        quoteData: quoteDataRecord,
        overrideExcess: overrideExcess ?? null,
        premium: totalPremium,
        currency: quoteCurrency(quoteResponse, ''),
      });

      return res.json({
        success: true,
        data: { ...quoteResponse, quoteToken }
      });
    } catch (error) {
      logger.error({ err: error }, 'Premium calculation error:');
      return res.status(500).json({ success: false, error: errorMessage(error, 'Premium calculation failed') });
    }
  });

  /**
   * POST /api/policies/create-from-quote
   * Create a policy from completed quote (self-onboarding flow)
   */
  router.post('/create-from-quote', policyAuditLog, async (req, res) => {
    const actor = actorFromRequest(req);
    const parsedBody = CreateFromQuoteBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsedBody.error.issues } });
    }
    const body = parsedBody.data;

    const result = await executeCreateFromQuote({
      quoteData: body.quoteData,
      paymentInfo: body.paymentInfo,
      quoteToken: typeof body.quoteToken === 'string' ? body.quoteToken : undefined,
      actor: { id: actor?.id || null, name: actor?.name || null, email: actor?.email || null, role: actor?.role || null },
    });

    if (result.status !== 'SUCCESS') {
      const statusCode = result.status === 'NO_QUOTE' || result.status === 'TOKEN_MISMATCH' || result.status === 'PRICE_MISMATCH' ? 422 : result.status === 'TOKEN_INVALID' ? 401 : result.status === 'SERVER_ERROR' ? 500 : 400;
      return res.status(statusCode).json({ success: false, error: result.error, reasons: result.reasons });
    }

    return res.json({ success: true, data: result.data });
  });
}

/**
 * POST /api/policies/:id/bind
 * Bind the policy (Legal Action) with Validation and Re-Calculation
 *
 * Exported for tests/backward compatibility.
 */
export const bindPolicyHandler = async (
  req: Pick<Request, 'params' | 'user'> & { correlationId?: string },
  res: { status: (code: number) => { json: (payload: unknown) => unknown }; json: (payload: unknown) => unknown }
) => {
  const { id: policyId } = req.params;
  const actor = actorFromRequest(req);
  const debugBind = String(process.env.DEBUG_BIND || '').toLowerCase() === 'true';

  const result = await executeBindPolicy({
    policyId,
    actor: { id: actor?.id || null, name: actor?.name || null, email: actor?.email || null, role: actor?.role || null },
    correlationId: req.correlationId || '',
    debugBind,
  });

  if (result.status !== 'SUCCESS') {
    const statusCode = result.status === 'NOT_FOUND' ? 404 : result.status === 'SERVER_ERROR' ? 500 : result.status === 'CONFLICT' ? 409 : 400;
    return res.status(statusCode).json({ success: false, error: result.error });
  }

  return res.json({ success: true, data: result.data });
};

