import type { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response, Router } from 'express';
import type { ApiResponse } from '../../../platform/types/index.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { WithoutTenantScope } from '../../../platform/db/tenantExtension.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { MagicBRegistry } from '../app/mbeInterop.js';
import { actorFromRequest, errorMessage, getMethod, jsonStringify, parseRecord } from '../app/shared.js';
import { enqueuePolicyListIndexUpdate } from '../app/policyListIndex.js';
import { z } from 'zod';
import { logger } from '../../../platform/utils/logger.js';
import { toDecimal, fromDecimal, roundCurrency } from '../../../platform/utils/decimal.js';
import { derivePolicyState } from '../app/policyStateService.js';
import { transitionPolicyLifecycle } from '../app/commands/policyLifecycleCommands.js';
import { requirePermission } from '../../accessControl/http/permissionMiddleware.js';
type ErrorBody = ApiResponse<null>;

function sendError(res: { status: (code: number) => { json: (payload: ErrorBody) => unknown } }, status: number, code: string, message: string) {
  const payload: ErrorBody = {
    success: false,
    error: { code, message },
  };
  return res.status(status).json(payload);
}

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

const CancellationRequestBodySchema = z.object({
  reason: z.string().optional(),
  requestedEffectiveDate: z.string().optional(),
});
const CancellationRequestRecipientSchema = z.string().email();
const CancellationApproveBodySchema = z.object({
  effectiveDate: z.string().optional(),
  hasClaim: z.boolean().optional(),
  hasBreakdownCallout: z.boolean().optional(),
  overrideNoRefund: z.boolean().optional(),
  overrideReason: z.string().optional(),
  coolingOffEvidenceProvided: z.boolean().optional(),
});
const CancellationRejectBodySchema = z.object({
  reason: z.string().optional(),
});

function parseDateOnly(value: string | undefined): Date | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

/**
 * The policy-holder contact is the authoritative recipient for policy
 * communications. The persisted field's supported forms are a standalone
 * email address or an object with an email property. Keep this reader local
 * to the policy HTTP boundary: it never substitutes a proposer, staff, or
 * underwriting address.
 */
function readPolicyHolderEmail(contact: unknown): string {
  const raw = typeof contact === 'string' ? contact.trim() : '';
  if (!raw) return '';
  if (CancellationRequestRecipientSchema.safeParse(raw).success) return raw;
  try {
    const parsed = parseRecord(JSON.parse(raw));
    return typeof parsed.email === 'string' ? parsed.email.trim() : '';
  } catch {
    return '';
  }
}

export function registerPolicyCancellationRoutes(router: Router) {
  /**
   * POST /api/policies/:id/cancellation/request
   * Transition: * -> CANCELLATION_REQUESTED
   * Notifies UW/ops.
   */
  router.post('/:id/cancellation/request', policyAuditLog, async (req, res) => {
    try {
      const { id } = req.params;
      const parsedBody = CancellationRequestBodySchema.safeParse(req.body);
      const reason = parsedBody.success ? parsedBody.data.reason : undefined;
      const requestedEffectiveDate = parsedBody.success ? parsedBody.data.requestedEffectiveDate : undefined;
      const actor = actorFromRequest(req);

      const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id },
        include: { policyHolder: true, stateCurrent: true }
      });
      if (!policy) return sendError(res, 404, 'NOT_FOUND', 'Policy not found');
      const to = readPolicyHolderEmail(policy.policyHolder?.contact);
      if (!CancellationRequestRecipientSchema.safeParse(to).success) {
        return sendError(
          res,
          400,
          'POLICY_HOLDER_EMAIL_REQUIRED',
          'A valid policy-holder email is required before requesting cancellation',
        );
      }
      const policyState = derivePolicyState({
        status: policy.status,
        inceptionDate: policy.inceptionDate,
        expiryDate: policy.expiryDate,
        stateCurrentSnapshot: policy.stateCurrent?.snapshot,
      });
      if (policyState.boStatus === 'CANCELLED') {
        return sendError(res, 400, 'INVALID_STATUS', 'Policy is already cancelled');
      }
      const requestedEffectiveDateIso = String(requestedEffectiveDate || '').trim();
      const parsedRequestedDate = parseDateOnly(requestedEffectiveDateIso);
      if (!parsedRequestedDate) {
        return sendError(res, 400, 'INVALID_EFFECTIVE_DATE', 'requestedEffectiveDate is required in YYYY-MM-DD format');
      }
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const maxBy45Days = new Date(today);
      maxBy45Days.setUTCDate(maxBy45Days.getUTCDate() + 45);
      const policyEndDate = policy.expiryDate ? new Date(policy.expiryDate) : null;
      if (policyEndDate) policyEndDate.setUTCHours(0, 0, 0, 0);
      const upperBound = policyEndDate && policyEndDate.getTime() < maxBy45Days.getTime() ? policyEndDate : maxBy45Days;
      if (parsedRequestedDate.getTime() < today.getTime()) {
        return sendError(res, 400, 'INVALID_EFFECTIVE_DATE', 'Cancellation date cannot be in the past');
      }
      if (parsedRequestedDate.getTime() > upperBound.getTime()) {
        return sendError(res, 400, 'INVALID_EFFECTIVE_DATE', 'Cancellation date must be within 45 days and no later than policy end date');
      }

      const prevSnapshot = parseRecord(policy.stateCurrent?.snapshot);
      const nextSnapshot = {
        ...prevSnapshot,
        cancellationRequest: {
          ...parseRecord(prevSnapshot.cancellationRequest),
          status: 'RECEIVED',
          requestedAt: new Date().toISOString(),
          requestedBy: actor.id || 'user',
          reason: reason || null,
          requestedEffectiveDate: requestedEffectiveDateIso,
        },
        flow_context: { channel: 'backoffice', step: 'service' },
      };

      await tenantScopedPrisma.$transaction(async (_tx) => {
        const tx = _tx as Prisma.TransactionClient;
        await transitionPolicyLifecycle({
          tx,
          policyId: id,
          to: 'CANCELLATION_REQUESTED',
          actorId: actor.id || 'system',
          actorType: 'USER',
          reasonCode: 'CANCELLATION_REQUESTED',
          correlationId: (req as { correlationId?: string }).correlationId,
          data: { requestedEffectiveDate: requestedEffectiveDateIso, reason: reason || null },
        });
        await tx.policySearchIndex.update({
          where: { policyId: id },
          data: { status: 'CANCELLATION_REQUESTED' },
        }).catch(() => undefined);
        await enqueuePolicyListIndexUpdate(tx, id);
        const policyStateCurrentCreateData: WithoutTenantScope<Prisma.PolicyStateCurrentUncheckedCreateInput> = {
          policyId: id,
          snapshot: jsonStringify(nextSnapshot),
        };
        await tx.policyStateCurrent.upsert({
          where: { policyId: id },
          update: { snapshot: jsonStringify(nextSnapshot) },
          create: policyStateCurrentCreateData as Prisma.PolicyStateCurrentUncheckedCreateInput,
        });

        const outboxCreate = getMethod(Reflect.get(tx, 'outbox'), 'create');
        await Promise.resolve(outboxCreate?.({
          data: {
            eventType: 'EMAIL.CANCELLATION_REQUESTED',
            aggregateId: id,
            payload: {
              policyId: id,
              policyNumber: policy.policyNumber,
              to,
              reason,
              requestedEffectiveDate: requestedEffectiveDateIso,
            },
          },
        })).catch(() => undefined);
      });

      void AuditLogger.log(id, 'POLICY', 'CANCELLATION.REQUESTED', actor.id || 'system', 'USER', { requestedEffectiveDate: requestedEffectiveDateIso, reason: reason || null }, actor.name || 'System');

      return res.json({ success: true, data: { status: 'CANCELLATION_REQUESTED' } });
    } catch (error) {
      logger.error({ err: error }, 'Cancellation request error:');
      return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'Cancellation request failed'));
    }
  });

  /**
   * POST /api/policies/:id/cancellation/approve
   * Transition: CANCELLATION_REQUESTED -> CANCELLED
   * Calculates Pro-Rata Refund respecting 'non-refundable' endorsements (e.g. Roadside).
   */
  router.post('/:id/cancellation/approve', policyAuditLog, requirePermission('policies', 'cancel'), async (req, res) => {
    try {
      const { id } = req.params;
      const parsedBody = CancellationApproveBodySchema.safeParse(req.body);
      const effectiveDate = parsedBody.success ? parsedBody.data.effectiveDate : undefined;
      const hasClaim = parsedBody.success ? parsedBody.data.hasClaim : undefined;
      const hasBreakdownCallout = parsedBody.success ? parsedBody.data.hasBreakdownCallout : undefined;
      const overrideNoRefund = parsedBody.success ? parsedBody.data.overrideNoRefund : undefined;
      const overrideReason = parsedBody.success ? parsedBody.data.overrideReason : undefined;
      const coolingOffEvidenceProvided = parsedBody.success ? parsedBody.data.coolingOffEvidenceProvided : undefined;
      const actor = actorFromRequest(req);

      const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id },
        include: { policyHolder: true, stateCurrent: true }
      });
      if (!policy) return sendError(res, 404, 'NOT_FOUND', 'Policy not found');
      const to = readPolicyHolderEmail(policy.policyHolder?.contact);

      const end = effectiveDate ? new Date(effectiveDate) : new Date();

      const prevSnapshot = parseRecord(policy.stateCurrent?.snapshot);

      // --- Refund Calculation ---
      const start = policy.inceptionDate ? new Date(policy.inceptionDate) : new Date();
      const expiry = policy.expiryDate ? new Date(policy.expiryDate) : new Date(start.getTime() + 365 * 24 * 3600 * 1000);
      const cancellationWithin14Days = Math.max(0, end.getTime() - start.getTime()) <= 14 * 24 * 3600 * 1000;

      let refundAmount = 0;
      let refundBreakdown = {};

      // 1. Check Pre-Inception (Full Refund)
      if (end < start) {
        refundAmount = Number(prevSnapshot.premium || 0);
        refundBreakdown = { type: 'full_cancellation_pre_inception', amount: refundAmount };
      } else if (end >= expiry) {
        // No refund (expired)
        refundAmount = 0;
        refundBreakdown = { type: 'expired', amount: 0 };
      } else {
        const quoteDataRecord = parseRecord(prevSnapshot.quoteData);
        const cancellationRecord = parseRecord(prevSnapshot.cancellation);
        const autoHasClaim = Boolean(quoteDataRecord.hasClaims);
        const autoHasBreakdownCallout = Boolean(cancellationRecord.breakdownCallout === true);
        const claimOrBreakdown = Boolean(hasClaim ?? autoHasClaim) || Boolean(hasBreakdownCallout ?? autoHasBreakdownCallout);
        const allowOverrideNoRefund = Boolean(overrideNoRefund) && String(overrideReason || '').trim().length >= 3;
        if (claimOrBreakdown && !allowOverrideNoRefund) {
          refundAmount = 0;
          refundBreakdown = {
            type: 'no_refund_claim_or_breakdown',
            claimOrBreakdown,
            overrideApplied: false,
          };
        } else {
          // 2. Pro-Rata on insurer premium
          const totalMs = expiry.getTime() - start.getTime();
          const usedMs = end.getTime() - start.getTime();
          const remainingMs = totalMs - usedMs;

          let factor = remainingMs / totalMs;
          if (factor < 0) factor = 0;
          if (factor > 1) factor = 1;

          const quoteResponseRecord = parseRecord(prevSnapshot.quoteResponse);
          const primaryOption = parseRecord(quoteResponseRecord.primaryOption);
          const calculationTrace = parseRecord(primaryOption.calculationTrace);
          const calculationDetails = parseRecord(prevSnapshot.calculationDetails);
          const quoteSteps = Array.isArray(calculationTrace.steps) ? calculationTrace.steps : [];
          const snapshotSteps = Array.isArray(calculationDetails.steps) ? calculationDetails.steps : [];
          const steps = Array.isArray(quoteSteps) && quoteSteps.length ? quoteSteps : snapshotSteps;
          const costBreakdown = parseRecord(primaryOption.costDetails || calculationDetails.costBreakdown);
          const tax = Number(costBreakdown.tax || 9);
          const netPremium = Math.max(0, Number(costBreakdown.subtotalNetPremium || 0));
          const insurerPremiumNetOfTax = Math.max(0, netPremium - tax);
          // 🔢 DECIMAL: Pro-rata refund calculation uses Decimal for exact precision
          const proRataInsurerPremium = fromDecimal(roundCurrency(toDecimal(insurerPremiumNetOfTax).mul(factor)));
          const commission = fromDecimal(roundCurrency(toDecimal(proRataInsurerPremium).mul(0.25)));
          const adminFee = 35;

          // Motor-specific refundability flag (COV-ROADSIDE family). Cancellations
          // for non-motor products take a different proration path.
          const motorCatalog = MagicBRegistry.motorOnly();
          let roadsideFee = 0;
          for (const step of steps) {
            const stepRecord = parseRecord(step);
            if (!String(stepRecord.id || '').startsWith('endorsement.premium.')) continue;
            const code = String(stepRecord.id || '').replace('endorsement.premium.', '');
            const tmpl = motorCatalog.get(code);
            const tmplDefaultParams = parseRecord(parseRecord(tmpl).default_params);
            if (tmplDefaultParams.refundable === false) {
              roadsideFee = Math.max(roadsideFee, Number(stepRecord.amount || tmplDefaultParams.premium_eur || 0));
            }
          }
          if (!roadsideFee) {
            const hasVip = steps.some((s) => String(parseRecord(s).id || '') === 'endorsement.premium.COV-ROADSIDE-VIP');
            roadsideFee = hasVip ? 121 : 86;
          }

          const coolingOffEligible = cancellationWithin14Days && Boolean(coolingOffEvidenceProvided) && !claimOrBreakdown;
          if (coolingOffEligible) {
            refundAmount = fromDecimal(roundCurrency(toDecimal(insurerPremiumNetOfTax)));
            refundBreakdown = {
              type: 'cooling_off_full_insurer_refund',
              insurerPremiumNetOfTax,
              claimOrBreakdown,
              evidenceProvided: true,
            };
          } else {
            // 🔢 DECIMAL: Refund calculation with Decimal subtraction
            refundAmount = fromDecimal(
              roundCurrency(
                toDecimal(proRataInsurerPremium)
                  .minus(commission)
                  .minus(adminFee)
                  .minus(roadsideFee)
              )
            );
            if (refundAmount < 0) refundAmount = 0;
            refundBreakdown = {
              type: 'formula_refund',
              factor,
              insurerPremiumNetOfTax,
              proRataInsurerPremium,
              commission,
              adminFee,
              roadsideFee,
              overrideApplied: allowOverrideNoRefund,
              overrideReason: allowOverrideNoRefund ? String(overrideReason || '') : null,
            };
          }
          // Already rounded via roundCurrency() above
        }
      }

      const nextSnapshot = {
        ...prevSnapshot,
        cancellation: {
          cancelledAt: new Date().toISOString(),
          cancelledBy: actor.id || 'user',
          effectiveDate: end.toISOString(),
          refundAmount,
          refundBreakdown,
          checks: {
            hasClaim: Boolean(hasClaim),
            hasBreakdownCallout: Boolean(hasBreakdownCallout),
            overrideNoRefund: Boolean(overrideNoRefund),
            overrideReason: overrideReason || null,
            coolingOffEvidenceProvided: Boolean(coolingOffEvidenceProvided),
          },
        },
        cancellationRequest: {
          ...parseRecord(prevSnapshot.cancellationRequest),
          status: 'CANCELLED',
          issuedAt: new Date().toISOString(),
          issuedBy: actor.id || 'user',
        },
        flow_context: { channel: 'backoffice', step: 'service' },
      };

      await tenantScopedPrisma.$transaction(async (_tx) => {
        const tx = _tx as Prisma.TransactionClient;
        await transitionPolicyLifecycle({
          tx,
          policyId: id,
          to: 'CANCELLED',
          actorId: actor.id || 'system',
          actorType: 'USER',
          reasonCode: 'CANCELLATION_APPROVED',
          correlationId: (req as { correlationId?: string }).correlationId,
          data: { effectiveDate: end.toISOString(), refundAmount },
        });
        await tx.policy.update({ where: { id }, data: { expiryDate: end } });
        await tx.policySearchIndex.update({
          where: { policyId: id },
          data: { status: 'CANCELLED' },
        }).catch(() => undefined);
        await enqueuePolicyListIndexUpdate(tx, id);
        const policyStateCurrentCreateData: WithoutTenantScope<Prisma.PolicyStateCurrentUncheckedCreateInput> = {
          policyId: id,
          snapshot: jsonStringify(nextSnapshot),
        };
        await tx.policyStateCurrent.upsert({
          where: { policyId: id },
          update: { snapshot: jsonStringify(nextSnapshot) },
          create: policyStateCurrentCreateData as Prisma.PolicyStateCurrentUncheckedCreateInput,
        });

        const outboxCreate = getMethod(Reflect.get(tx, 'outbox'), 'create');
        await Promise.resolve(outboxCreate?.({
          data: {
            eventType: 'EMAIL.CANCELLATION_CONFIRMED',
            aggregateId: id,
            payload: {
              policyId: id,
              policyNumber: policy.policyNumber,
              to,
              effectiveDate: end.toISOString(),
              refundAmount // Include for template
            },
          },
        })).catch(() => undefined);
      });

      void AuditLogger.log(id, 'POLICY', 'CANCELLATION.APPROVED', actor.id || 'system', 'USER', { effectiveDate: end.toISOString(), refundAmount }, actor.name || 'System');

      return res.json({ success: true, data: { status: 'CANCELLED', effectiveDate: end.toISOString(), refundAmount } });
    } catch (error) {
      logger.error({ err: error }, 'Cancellation approve error:');
      return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'Cancellation approve failed'));
    }
  });

  /**
   * POST /api/policies/:id/cancellation/reject
   * Transition: CANCELLATION_REQUESTED -> ACTIVE
   * Stores rejection reason in snapshot for Service history.
   */
  router.post('/:id/cancellation/reject', policyAuditLog, async (req, res) => {
    try {
      const { id } = req.params;
      const parsedBody = CancellationRejectBodySchema.safeParse(req.body);
      const reason = parsedBody.success ? String(parsedBody.data.reason || '').trim() : '';
      const actor = actorFromRequest(req);

      const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id },
        include: { stateCurrent: true },
      });
      if (!policy) return sendError(res, 404, 'NOT_FOUND', 'Policy not found');
      const policyState = derivePolicyState({
        status: policy.status,
        inceptionDate: policy.inceptionDate,
        expiryDate: policy.expiryDate,
        stateCurrentSnapshot: policy.stateCurrent?.snapshot,
      });
      if (!policyState.hasCancellationRequest && String(policy.status || '').toUpperCase() !== 'CANCELLATION_REQUESTED') {
        return sendError(res, 400, 'INVALID_STATUS', 'Cancellation can be rejected only from CANCELLATION_REQUESTED');
      }

      const prevSnapshot = parseRecord(policy.stateCurrent?.snapshot);
      const prevCancellationRequest = parseRecord(prevSnapshot.cancellationRequest);
      const nextSnapshot = {
        ...prevSnapshot,
        cancellationRequest: {
          ...prevCancellationRequest,
          status: 'REJECTED',
          rejectedAt: new Date().toISOString(),
          rejectedBy: actor.id || 'user',
          rejectionReason: reason || null,
        },
        flow_context: { channel: 'backoffice', step: 'service' },
      };

      await tenantScopedPrisma.$transaction(async (_tx) => {
        const tx = _tx as Prisma.TransactionClient;
        await transitionPolicyLifecycle({
          tx,
          policyId: id,
          to: 'ACTIVE',
          actorId: actor.id || 'system',
          actorType: 'USER',
          reasonCode: 'CANCELLATION_REJECTED',
          correlationId: (req as { correlationId?: string }).correlationId,
          data: { reason: reason || null },
        });
        await tx.policySearchIndex.update({
          where: { policyId: id },
          data: { status: 'ACTIVE' },
        }).catch(() => undefined);
        await enqueuePolicyListIndexUpdate(tx, id);
        const policyStateCurrentCreateData: WithoutTenantScope<Prisma.PolicyStateCurrentUncheckedCreateInput> = {
          policyId: id,
          snapshot: jsonStringify(nextSnapshot),
        };
        await tx.policyStateCurrent.upsert({
          where: { policyId: id },
          update: { snapshot: jsonStringify(nextSnapshot) },
          create: policyStateCurrentCreateData as Prisma.PolicyStateCurrentUncheckedCreateInput,
        });
      });

      void AuditLogger.log(
        id,
        'POLICY',
        'CANCELLATION.REJECTED',
        actor.id || 'system',
        'USER',
        { reason: reason || null },
        actor.name || 'System'
      );

      return res.json({ success: true, data: { status: 'ACTIVE' } });
    } catch (error) {
      logger.error({ err: error }, 'Cancellation reject error:');
      return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'Cancellation reject failed'));
    }
  });
}
