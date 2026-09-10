import type { Prisma } from '@prisma/client';
/**
 * Underwriting + questionnaire routes.
 * CHAMPS: Decomposed into sub-routers. This file keeps core UW form handlers
 * and composes follow-up + decision sub-routers.
 *
 * Routes registered:
 * - POST /:id/uw-form                   (this file)
 * - POST /:id/send-questionnaire        (uwFollowUpRouter)
 * - POST /:id/send-follow-up-batch      (uwFollowUpRouter)
 * - POST /:id/uw/request-info           (uwDecisionRouter)
 */
import type { Request, Response, Router } from 'express';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { WithoutTenantScope } from '../../../platform/db/tenantExtension.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import {
  assertEndorsementDraftRiskTransaction,
  jsonParse,
  jsonStringify,
  resolveUwEditMode,
  persistWorkspaceSnapshot,
} from '../app/shared.js';
import { enqueuePolicyListIndexUpdate } from '../app/policyListIndex.js';
import {
  buildQuoteResponseForProduct,
  productAdapterExists,
  normalizeUwDataForProduct,
  validateProductQuoteForIssuance,
} from '../app/productRegistryService.js';
import { resolveEffectiveCoverageContract } from '../app/coverageSelectionContract.js';
import { computePricingIntegrityStamp } from '../app/pricing/pricingIntegrityStamp.js';
import { normalizeProgramMbeProductConfig } from '../app/mbeInterop.js';
import { transitionPolicyLifecycle } from '../app/commands/policyLifecycleCommands.js';
import { logger } from '../../../platform/utils/logger.js';
import { deepMergeQuoteData } from '../../../shared/lib/deepMerge.js';

// Shared helpers (schemas + utilities)
import {
  UwFormBodySchema,
  parseRecord,
  sendError,
  errorMessage,
  actorFromRequest,
  parseSnapshotMaybe,
  policyAuditLog,
  deepMergePlain,
} from './uwHelpers.js';

// Sub-routers
import { registerUwFollowUpRoutes } from './uwFollowUpRouter.js';
import { registerUwDecisionRoutes } from './uwDecisionRouter.js';

type UwRatingResult = {
  quoteResponse: Record<string, unknown>;
  underwritingAnalysis: unknown;
  pricing: ReturnType<typeof computePricingIntegrityStamp>;
  coverageSelection: Record<string, unknown>;
  status: string;
} | null;

async function rateUnderwritingQuoteIfReady(args: {
  policyId: string;
  productType: string;
  quoteData: Record<string, unknown>;
  programId?: string | null;
  storedCoverageSelection?: unknown;
}): Promise<UwRatingResult> {
  if (!args.productType || !productAdapterExists(args.productType)) return null;

  const validation = await validateProductQuoteForIssuance(args.productType, args.quoteData);
  if (validation.missingForQuotePack.length > 0 || validation.schemaIssues.length > 0) return null;

  const program = args.programId
    ? await tenantScopedPrisma.program.findUnique({ where: { id: args.programId } })
    : null;
  const programMeta = parseRecord(program?.metadata);
  const normalizedMbeCfg = normalizeProgramMbeProductConfig(programMeta.mbeProductConfig, {
    productType: args.productType,
    programCode: String(programMeta.programCode || `abbeygate_${String(args.productType).toLowerCase()}`),
  });
  const coverageContract = resolveEffectiveCoverageContract({
    productType: args.productType,
    quoteData: args.quoteData,
    cfg: normalizedMbeCfg,
    storedSelection: args.storedCoverageSelection,
    programId: args.programId || program?.id || null,
    source: 'UW_SAVE',
    updatedAt: new Date().toISOString(),
    boInitialized: true,
  });
  const { quoteResponse, underwritingAnalysis } = await buildQuoteResponseForProduct({
    productType: args.productType,
    quoteData: args.quoteData,
    programMeta,
    resolvedCoverageSet: coverageContract.resolvedCoverageSet,
  });
  const quoteResponseRecord = parseRecord(quoteResponse);
  return {
    quoteResponse: quoteResponseRecord,
    underwritingAnalysis,
    pricing: computePricingIntegrityStamp({ quoteData: args.quoteData, quoteResponse: quoteResponseRecord }),
    coverageSelection: {
      schemaVersion: coverageContract.schemaVersion,
      programId: coverageContract.programId,
      programCode: coverageContract.programCode,
      selected: coverageContract.selected,
      params: coverageContract.params,
      source: coverageContract.source,
      updatedAt: coverageContract.updatedAt,
      bo_initialized: true,
    },
    status: String(quoteResponseRecord.status || 'QUOTED').toUpperCase(),
  };
}

/**
 * POST /api/policies/:id/uw-form
 * Update Snapshot of Current/Draft state
 *
 * Exported for tests/backward compatibility.
 */
export const updatePolicyUwFormHandler = async (
  req: Pick<Request, 'params' | 'body' | 'user'>,
  res: Pick<Response, 'status' | 'json'>
) => {
  try {
    const { id } = req.params;
    const formParseResult = UwFormBodySchema.safeParse(req.body);
    if (!formParseResult.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid form data');
    }
    const formData = formParseResult.data;
    const riskTransactionId = String(formData.riskTransactionId || '').trim();

    // IMMUTABILITY CHECK / EDIT MODE RESOLVER
    const currentPolicyHeader = await tenantScopedPrisma.policy.findUnique({ where: { id } });
    const editMode = resolveUwEditMode({ policyStatus: currentPolicyHeader?.status, riskTransactionId });
    if (editMode === 'readOnly') {
      logger.warn(`[UwForm] Attempt to modify questionnaire for active/issued policy ${id} rejected.`);
      return res.status(403).json({ success: false, error: 'Policy is active/issued. Inputs are locked. Please issue an Endorsement to modify.' });
    }

    const quoteDataUpdatesRaw = formData.quoteDataUpdates;
    const quoteDataUpdates = quoteDataUpdatesRaw && typeof quoteDataUpdatesRaw === 'object'
      ? parseRecord(quoteDataUpdatesRaw)
      : null;
    if (quoteDataUpdates) {
      // Travel's legacy root-level proposer shape was deleted by the
      // 20260427153132_canonicalize_travel_proposer migration; the
      // findLegacyTravelRootKey rejection guard was retired in PR6 of
      // the aggressive-cleanup plan. Validation downstream still rejects
      // any malformed quoteDataUpdates shape regardless of product.

      const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id },
        select: {
          id: true,
          quoteData: true,
          stateCurrent: { select: { snapshot: true } },
        },
      });
      if (!policy) return sendError(res, 404, 'NOT_FOUND', 'Policy not found');

      const prevSnapshot = parseSnapshotMaybe(policy.stateCurrent?.snapshot);
      // The BO detail read path exposes the canonical projection of the
      // materialized policy value plus the current workspace snapshot. Start
      // this write from that same projection, so saving one UW field cannot
      // erase details carried only by an older policy's current snapshot.
      const prevQuoteData = deepMergeQuoteData(policy.quoteData, prevSnapshot.quoteData);
      const policyProductType = String(currentPolicyHeader?.productType || '').toUpperCase();
      const hasAdapter = productAdapterExists(policyProductType);
      // Deep-merge so that a patch carrying only `trip.planType` does not wipe
      // sibling leaves like `trip.destinations`. The BO client also deep-merges
      // before sending, but this defensively protects against partial deltas
      // from any future caller of this endpoint.
      const mergedQuoteData = deepMergePlain(prevQuoteData, quoteDataUpdates);
      const uwNorm = hasAdapter
          ? normalizeUwDataForProduct(policyProductType, mergedQuoteData)
          : { normalizedQuoteData: mergedQuoteData, productFields: {} };
      const nextQuoteData = uwNorm.normalizedQuoteData;
      const productFields = uwNorm.productFields || {};
      const actor = actorFromRequest(req);
      const actorDisplayName = String(actor.name || actor.email || 'Underwriter').trim();
      const changedFields = Object.keys(quoteDataUpdates).flatMap((fieldKey) => {
        const before = prevQuoteData[fieldKey];
        const after = nextQuoteData[fieldKey];
        if (JSON.stringify(before) === JSON.stringify(after)) return [];
        return [{ fieldKey, before, after }];
      });

      const rating = editMode === 'endorsementDraft'
        ? null
        : await rateUnderwritingQuoteIfReady({
          policyId: id,
          productType: policyProductType,
          quoteData: nextQuoteData,
          programId: currentPolicyHeader?.programId || null,
          storedCoverageSelection: prevSnapshot.coverageSelection,
        });

      await tenantScopedPrisma.$transaction(async (_tx) => {
        const tx = _tx as Prisma.TransactionClient;
        if (editMode === 'endorsementDraft') {
          if (!riskTransactionId) throw new Error('Missing endorsement draft id');
          const rt = await assertEndorsementDraftRiskTransaction(tx, { policyId: id, riskTransactionId });
          const prevDraft = parseSnapshotMaybe(jsonParse(rt.snapshotDraft));
          const prevDraftQd = parseRecord(prevDraft.quoteData);
          const mergedDraftQuoteData = deepMergePlain(prevDraftQd, quoteDataUpdates);
          const draftUwNorm = hasAdapter
              ? normalizeUwDataForProduct(policyProductType, mergedDraftQuoteData)
              : { normalizedQuoteData: mergedDraftQuoteData, productFields: {} };
          const mergedDraftQd = draftUwNorm.normalizedQuoteData;
          const draftProductFields = draftUwNorm.productFields || {};
          const nextDraft = {
            ...prevDraft,
            quoteData: mergedDraftQd,
            ...draftProductFields,
          };
          await persistWorkspaceSnapshot(tx, { policyId: id, riskTransactionId, nextSnapshot: nextDraft });
        } else {
          const stateInTxn = await tx.policyStateCurrent.findUnique({ where: { policyId: id }, select: { snapshot: true } });
          const stateSnapshot = parseSnapshotMaybe(stateInTxn?.snapshot);
          const prevCustomerFlow = parseRecord(stateSnapshot.customerFlow);
          const nowIso = new Date().toISOString();
          const nextSnapshot = {
            ...stateSnapshot,
            quoteData: nextQuoteData,
            ...productFields,
            ...(rating ? {
              quoteResponse: rating.quoteResponse,
              uwDecision: rating.underwritingAnalysis,
              underwritingAnalysis: rating.underwritingAnalysis,
              pricing: rating.pricing,
              coverageSelection: rating.coverageSelection,
            } : {
              quoteResponse: undefined,
              uwDecision: undefined,
              underwritingAnalysis: undefined,
              pricing: undefined,
            }),
            customerFlow: {
              ...prevCustomerFlow,
              uwStartedAt: String(prevCustomerFlow.uwStartedAt || '').trim() || nowIso,
              lastSavedBy: 'underwriter',
              lastSavedByName: actorDisplayName || 'Underwriter',
              lastSavedAt: nowIso,
            },
            flow_context: { channel: 'bo', step: 'underwriting' },
          };
          await tx.policy.update({
            where: { id },
            data: {
              quoteData: jsonStringify(nextQuoteData),
              quoteResponse: rating ? jsonStringify(rating.quoteResponse) : jsonStringify({}),
              ...(productFields.driverInfo !== undefined ? { driverInfo: jsonStringify(productFields.driverInfo) } : {}),
              ...(productFields.vehicleInfo !== undefined ? { vehicleInfo: jsonStringify(productFields.vehicleInfo) } : {}),
            },
          });
          const stateCurrentCreate: WithoutTenantScope<Prisma.PolicyStateCurrentUncheckedCreateInput> = {
            policyId: id,
            snapshot: jsonStringify(nextSnapshot),
          };
          await tx.policyStateCurrent.upsert({
            where: { policyId: id },
            update: { snapshot: jsonStringify(nextSnapshot) },
            create: stateCurrentCreate as Prisma.PolicyStateCurrentUncheckedCreateInput,
          });
          if (rating) {
            await transitionPolicyLifecycle({
              tx,
              policyId: id,
              to: rating.status as Parameters<typeof transitionPolicyLifecycle>[0]['to'],
              actorId: String(actor.id || 'system'),
              actorType: 'USER',
              reasonCode: 'UW_RATING_READY',
            });
          }
          await enqueuePolicyListIndexUpdate(tx, id);
        }
      });

      void AuditLogger.log(id, 'POLICY', 'POLICY.UPDATED', String(actor.id || 'system'), 'USER', {
        action: editMode === 'endorsementDraft' ? 'UW_ENDORSEMENT_FIELD_UPDATE' : 'UW_PREBIND_FIELD_UPDATE',
        mode: editMode,
        riskTransactionId: riskTransactionId || undefined,
        changedFields,
      }, String(actorDisplayName || 'Underwriter'));
      return res.json({ success: true, data: { mode: editMode, changedFields } });
    }

    return sendError(res, 400, 'MISSING_QUOTE_DATA_UPDATES', 'Request body must include quoteDataUpdates');
  } catch (error) {
    logger.error({ err: error }, 'UW Form error:');
    return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'UW form error'));
  }
};

export const getPolicyUwFormHandler = async (
  req: Pick<Request, 'params'>,
  res: Pick<Response, 'status' | 'json'>
) => {
  try {
    const { id } = req.params;
    const policy = await tenantScopedPrisma.policy.findUnique({
      where: { id },
      select: { quoteData: true, stateCurrent: { select: { snapshot: true } } },
    });
    if (!policy) return sendError(res, 404, 'NOT_FOUND', 'Policy not found');
    const snapshot = parseSnapshotMaybe(policy.stateCurrent?.snapshot);
    return res.json({
      success: true,
      data: {
        ...parseRecord(snapshot.uwAnswers),
        quoteData: parseRecord(snapshot.quoteData || policy.quoteData),
        customerFlow: parseRecord(snapshot.customerFlow),
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'UW Form read error:');
    return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'UW form read error'));
  }
};

// ─── Registration ─────────────────────────────────────────────────
export function registerPolicyUwRoutes(router: Router) {
  router.get('/:id/uw-form', policyAuditLog, getPolicyUwFormHandler);
  router.post('/:id/uw-form', policyAuditLog, updatePolicyUwFormHandler);

  registerUwFollowUpRoutes(router);
  registerUwDecisionRoutes(router);
}
