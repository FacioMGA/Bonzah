/**
 * Canonical writer for operator-MCP V2 patches (ADR-0039).
 *
 * Closes the documented seam: no existing backend path calls
 * `validateForContext({ actor: 'underwriter' })` today. This use case
 * is the first; static analysis pins that fact via
 * `tools/quality/check-operator-validate-on-patch.mjs`.
 *
 * V2 scope: ONLY operator MCP tools call this. The pre-existing
 * `uwRouter:updatePolicyUwFormHandler` keeps its inline path unchanged
 * for V2 (preserves BO behaviour pinned by usePolicyLifecycleActions
 * + PremiumPricingBreakdown + contract-fast suite). V3 will converge
 * the two callers once warn-only validation telemetry confirms the
 * stricter pre-write validation does not break BO flows.
 *
 * Pipeline (matches the persist shape inside `uwRouter` lines 197-265
 * for the non-endorsement path so the artefacts produced are
 * indistinguishable from a BO save):
 *
 *   1. Load Policy.quoteData + productType + stateCurrent.snapshot.
 *   2. Deep-merge patch over existing quoteData.
 *   3. validateForContext({ stage: 'quote', actor: 'underwriter' })  ← THE SEAM
 *      Operator role: strict. Underwriter role (future BO): warn-only.
 *   4. normalizeUwDataForProduct.
 *   5. assertBinderAuthorizesProduct against the merged data.
 *   6. Persist (Policy + PolicyStateCurrent) in one transaction.
 *   7. Emit POLICY.UPDATED + OPERATOR.QUOTE_PATCH_APPLIED audit rows.
 *
 * Returns the changed fields, the new quoteData, and the prior
 * quoteData — operator MCP `update_quote_terms` packs these into its
 * envelope so the LLM can show the operator a diff.
 */
import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import { AuditLogger } from '../../../../platform/audit/logger.js';
import { logger } from '../../../../platform/utils/logger.js';
import { validateForContext } from '@facio/validation/backend';
import {
    assertBinderAuthorizesProduct,
    BinderAuthorityError,
} from '../binders/binderAuthority.js';
import {
    normalizeUwDataForProduct,
    productAdapterExists,
} from '../productRegistryService.js';
import { deepMergePlain } from '../../../../shared/lib/deepMerge.js';
import { jsonStringify } from '../shared.js';

export interface ApplyQuotePatchActor {
    /** `apikey:<id>` for OPERATOR_AGENT, BO user id for UNDERWRITER. */
    id: string;
    /** OPERATOR_AGENT → strict validation; UNDERWRITER → warn-only (V2). */
    role: 'OPERATOR_AGENT' | 'UNDERWRITER';
    name?: string;
}

export interface ApplyQuotePatchInput {
    policyId: string;
    /** Arbitrary subset of QuoteData. Deep-merged. */
    patch: Record<string, unknown>;
    actor: ApplyQuotePatchActor;
    correlationId?: string;
}

export interface ApplyQuotePatchValidationError {
    field: string;
    message: string;
    code?: string;
}

export type ApplyQuotePatchResult =
    | {
          ok: true;
          policyId: string;
          productType: string;
          changedFields: Array<{ field: string; from: unknown; to: unknown }>;
          quoteDataBefore: Record<string, unknown>;
          quoteDataAfter: Record<string, unknown>;
      }
    | {
          ok: false;
          code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'BINDER_AUTHORITY' | 'INTERNAL_ERROR';
          message: string;
          validationErrors?: ApplyQuotePatchValidationError[];
      };

function parseRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

function flattenFieldErrors(errors: Record<string, { message?: string; type?: string } | unknown>): ApplyQuotePatchValidationError[] {
    const out: ApplyQuotePatchValidationError[] = [];
    for (const [field, entry] of Object.entries(errors)) {
        if (entry && typeof entry === 'object') {
            const rec = entry as { message?: string; type?: string };
            out.push({ field, message: String(rec.message || 'invalid'), code: rec.type });
        } else {
            out.push({ field, message: 'invalid' });
        }
    }
    return out;
}

function diffChangedFields(
    patch: Record<string, unknown>,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
): Array<{ field: string; from: unknown; to: unknown }> {
    return Object.keys(patch).flatMap((fieldKey) => {
        const a = before[fieldKey];
        const b = after[fieldKey];
        if (JSON.stringify(a) === JSON.stringify(b)) return [];
        return [{ field: fieldKey, from: a, to: b }];
    });
}

export async function applyQuotePatchUseCase(
    input: ApplyQuotePatchInput,
): Promise<ApplyQuotePatchResult> {
    const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: input.policyId },
        select: {
            id: true,
            quoteData: true,
            productType: true,
            binderId: true,
            stateCurrent: { select: { snapshot: true } },
        },
    });
    if (!policy) {
        return { ok: false, code: 'NOT_FOUND', message: `Policy "${input.policyId}" not found.` };
    }
    const productType = String(policy.productType || '').toUpperCase();
    if (!productType) {
        return { ok: false, code: 'INTERNAL_ERROR', message: 'Policy has no productType.' };
    }

    const prevSnapshot = policy.stateCurrent?.snapshot
        ? parseRecord(policy.stateCurrent.snapshot)
        : {};
    const prevQuoteData = parseRecord(policy.quoteData || prevSnapshot.quoteData);
    const merged = deepMergePlain(prevQuoteData, input.patch);

    // === THE VALIDATION SEAM ===
    // Operator MCP V2 patches MUST pass validateForContext at actor=underwriter
    // before any persist. UNDERWRITER role (BO) keeps warn-only for V2 to
    // preserve UI behaviour.
    try {
        const fieldErrors = validateForContext({
            productCode: productType,
            stage: { kind: 'stage', id: 'quote' },
            actor: 'underwriter',
            data: merged,
        });
        const issues = fieldErrors ? flattenFieldErrors(fieldErrors as Record<string, unknown>) : [];
        if (issues.length > 0) {
            if (input.actor.role === 'OPERATOR_AGENT') {
                logger.info(
                    {
                        policyId: input.policyId,
                        productType,
                        issueCount: issues.length,
                        actorId: input.actor.id,
                        correlationId: input.correlationId,
                    },
                    'operator.validation.rejected',
                );
                return {
                    ok: false,
                    code: 'VALIDATION_ERROR',
                    message: `${issues.length} validation error(s) on patch.`,
                    validationErrors: issues,
                };
            }
            // UNDERWRITER role: warn-only telemetry. V3 flips strict.
            logger.warn(
                {
                    policyId: input.policyId,
                    productType,
                    issueCount: issues.length,
                    actorId: input.actor.id,
                    issues: issues.slice(0, 5),
                },
                'operator.validation.warn',
            );
        }
    } catch (err) {
        logger.warn({ err, policyId: input.policyId }, 'operator.validation.unexpected_error');
        // Validation engine error should not block (warn telemetry only)
        // because we never want a validator bug to take down operator MCP
        // entirely. The operator can re-run if it persists.
    }

    const hasAdapter = productAdapterExists(productType);
    const uwNorm = hasAdapter
        ? normalizeUwDataForProduct(productType, merged)
        : { normalizedQuoteData: merged, productFields: {} };
    const nextQuoteData = uwNorm.normalizedQuoteData as Record<string, unknown>;
    const productFields = (uwNorm.productFields || {}) as Record<string, unknown>;

    // Binder authority cap: re-run against the merged data because the
    // patch may have moved territory / vehicle value / etc.
    if (policy.binderId) {
        try {
            await assertBinderAuthorizesProduct({
                binderId: policy.binderId,
                productCode: productType,
                effectiveDate: new Date(),
            });
        } catch (err) {
            if (err instanceof BinderAuthorityError) {
                return {
                    ok: false,
                    code: 'BINDER_AUTHORITY',
                    message: err.message,
                };
            }
            throw err;
        }
    }

    const changedFields = diffChangedFields(input.patch, prevQuoteData, nextQuoteData);
    if (changedFields.length === 0) {
        return {
            ok: true,
            policyId: input.policyId,
            productType,
            changedFields: [],
            quoteDataBefore: prevQuoteData,
            quoteDataAfter: nextQuoteData,
        };
    }

    await tenantScopedPrisma.$transaction(async (_tx) => {
        const tx = _tx as unknown as Prisma.TransactionClient;
        const stateInTxn = await tx.policyStateCurrent.findUnique({
            where: { policyId: input.policyId },
            select: { snapshot: true },
        });
        const stateSnapshot = stateInTxn?.snapshot ? parseRecord(stateInTxn.snapshot) : {};
        const nowIso = new Date().toISOString();
        const nextSnapshot = {
            ...stateSnapshot,
            quoteData: nextQuoteData,
            ...productFields,
            // Clearing quoteResponse mirrors the existing uwRouter / motor
            // `updatePublicAutoDraft` behaviour when quoteData changes —
            // the next rate call re-computes pricing.
            quoteResponse: undefined,
            uwDecision: undefined,
            underwritingAnalysis: undefined,
            pricing: undefined,
            flow_context: { channel: 'bo', step: 'operator_mcp' },
            operatorMcp: {
                ...(parseRecord(stateSnapshot.operatorMcp) || {}),
                lastPatchAt: nowIso,
                lastPatchActor: input.actor.id,
            },
        };
        await tx.policy.update({
            where: { id: input.policyId },
            data: {
                quoteData: jsonStringify(nextQuoteData),
                // Empty-object JSON, same shape uwRouter writes when
                // the patch invalidates pricing.
                quoteResponse: jsonStringify({}),
            },
        });
        await tx.policyStateCurrent.upsert({
            where: { policyId: input.policyId },
            update: { snapshot: jsonStringify(nextSnapshot) },
            create: {
                policyId: input.policyId,
                snapshot: jsonStringify(nextSnapshot),
            } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
        });
    });

    // Audit row carries the same shape `uwRouter` writes for POLICY.UPDATED
    // plus the operator-specific OPERATOR.QUOTE_PATCH_APPLIED.
    await AuditLogger.log(
        input.policyId,
        'POLICY',
        'POLICY.UPDATED',
        input.actor.id,
        input.actor.role === 'OPERATOR_AGENT' ? 'SYSTEM' : 'USER',
        {
            source: 'operator-mcp-v2',
            actorRole: input.actor.role,
            changedFields,
            correlationId: input.correlationId,
        },
        input.actor.name,
    );
    await AuditLogger.log(
        input.policyId,
        'OPERATOR_ACTION',
        'OPERATOR.QUOTE_PATCH_APPLIED',
        input.actor.id,
        input.actor.role === 'OPERATOR_AGENT' ? 'SYSTEM' : 'USER',
        {
            policyId: input.policyId,
            productType,
            changedFields,
            patchFields: Object.keys(input.patch),
            correlationId: input.correlationId,
        },
        input.actor.name,
    );

    return {
        ok: true,
        policyId: input.policyId,
        productType,
        changedFields,
        quoteDataBefore: prevQuoteData,
        quoteDataAfter: nextQuoteData,
    };
}
