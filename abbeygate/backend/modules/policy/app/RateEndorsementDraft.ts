import type { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { assertEndorsementDraftRiskTransaction, persistWorkspaceSnapshot } from '../../policy/app/shared.js';
import { logger } from '../../../platform/utils/logger.js';
import { validateDraftQuote } from '../../quotes/app/validator.js';
import type { QuoteData, QuoteResponse } from '../../../platform/types/autoInsurance.js';
import { computePricingIntegrityStamp } from '../domain/pricingIntegrityStamp.js';
import {
    computeCancellationFinancials,
    computeRemainingTermMonths,
    applyEndorsementTermProration
} from '../domain/proration.js';
import { resolveEffectiveCoverageContract } from './coverageSelectionContract.js';
import { buildUnderwritingAnalysis } from '../../underwriting/domain/underwritingAnalysis.js';
import {
    isRenewalTransactionType,
    VERSION_HISTORY_TRANSACTION_TYPES,
} from '../domain/riskTransactionTypes.js';
import { ProductRegistry } from '../domain/ProductRegistry.js';
import { recordPriceAudit } from './pricing/priceAuditRecorder.js';
import type { CalculationStep } from '../../../platform/types/pricing.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';

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

function jsonParse(str: unknown): unknown {
    if (!str) return {};
    if (typeof str === 'string') {
        try { return JSON.parse(str); } catch { return {}; }
    }
    return str;
}

function getMethod(target: unknown, methodName: string): ((...args: unknown[]) => unknown) | null {
    const obj = parseRecord(target);
    const method = obj[methodName];
    return typeof method === 'function' ? (...args: unknown[]) => method(...args) : null;
}

export interface EndorsementActor {
    id: string | null;
    name: string | null;
    email: string | null;
    role: string | null;
}

export interface RateEndorsementDraftInput {
    policyId: string;
    riskTransactionId: string;
    actor: EndorsementActor;
    overrideExcess?: number | string;
}

export type UseCaseResult<T> =
    | { status: 'SUCCESS'; data: T }
    | { status: 'NOT_FOUND' | 'INVALID_QUOTE_DATA' | 'SERVER_ERROR'; error: unknown };

export async function executeRateEndorsementDraft(
    input: RateEndorsementDraftInput
): Promise<UseCaseResult<{ quoteResponse: QuoteResponse }>> {
    const { policyId, riskTransactionId, actor, overrideExcess } = input;

    try {
        const policy = await tenantScopedPrisma.policy.findUnique({ where: { id: policyId } });
        if (!policy) return { status: 'NOT_FOUND', error: { code: 'NOT_FOUND', message: 'Policy not found' } };
        const existingRiskTxn = await tenantScopedPrisma.riskTransaction.findFirst({
            where: { id: riskTransactionId, policyId },
            select: { transactionType: true },
        });
        const auditAction = isRenewalTransactionType(existingRiskTxn?.transactionType)
            ? 'RENEWAL.DRAFT.RATED'
            : 'ENDORSEMENT.DRAFT.RATED';

        const result = await tenantScopedPrisma.$transaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
            const rt = await assertEndorsementDraftRiskTransaction(tx, { policyId, riskTransactionId });
            const isRenewal = isRenewalTransactionType(rt.transactionType);
            const prevDraft = parseSnapshot(jsonParse(rt.snapshotDraft));
            const quoteDataCandidate = parseRecord(prevDraft.quoteData);
            const quoteValidation = validateDraftQuote({
                quoteData: quoteDataCandidate,
                step: 'endorsement-rate',
                mode: 'draft',
                productType: policy.productType || undefined,
            });

            if (!quoteValidation.valid) {
                const firstSchemaIssue = quoteValidation.schemaIssues[0];
                const firstBlocking = quoteValidation.blockingErrors.find((entry) => {
                    const rec = parseRecord(entry);
                    return Boolean(String(rec.message || '').trim());
                }) || null;
                const details = {
                    schemaIssues: quoteValidation.schemaIssues,
                    missingSlugs: quoteValidation.missingSlugs,
                    blockingErrors: quoteValidation.blockingErrors,
                };
                const message =
                    firstSchemaIssue?.message ||
                    String(parseRecord(firstBlocking).message || '').trim() ||
                    'Endorsement draft quoteData is invalid';
                const err = new Error(message) as Error & { statusCode?: number; details?: unknown };
                err.statusCode = 400;
                err.details = details;
                throw err;
            }

            const policyEndForMbe = policy.expiryDate ? new Date(policy.expiryDate) : null;
            const endorsementEffectiveForMbe = rt.effectiveDate ? new Date(rt.effectiveDate) : null;
            const quoteData: QuoteData = {
                ...quoteValidation.normalizedQuoteData,
                ...(
                    policyEndForMbe && endorsementEffectiveForMbe
                        ? { __mbePolicyTermMonths: computeRemainingTermMonths(endorsementEffectiveForMbe, policyEndForMbe) }
                        : {}
                ),
            };

            let programMeta: Record<string, unknown> = {};
            let mbeConfig: unknown = undefined;
            try {
                const programFindFirst = getMethod(Reflect.get(prisma, 'program'), 'findFirst');
                if (programFindFirst) {
                    const resolvedProgram = policy.programId
                        ? await tenantScopedPrisma.program.findUnique({ where: { id: policy.programId } })
                        : await programFindFirst({ where: { status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' } });
                    programMeta = parseRecord(parseRecord(resolvedProgram).metadata);
                    mbeConfig = programMeta.mbeProductConfig;
                }
            } catch {
                // best-effort
            }

            const productType = String(policy.productType || programMeta.productType || '');
            if (!productType) throw new Error('Policy is missing productType');
            const adapter = ProductRegistry.getInstance().getAdapter(productType);
            if (!adapter) throw new Error(`No product adapter for: ${productType}`);

            const { normalizeProgramMbeProductConfig } = await import('../../mbe/domain/programProduct.js');

            const normalizedMbeCfg = normalizeProgramMbeProductConfig(mbeConfig, {
                productType,
                programCode: `abbeygate_${String(productType || '').trim().toLowerCase()}`,
            });

            const resolvedCoverageSet = resolveEffectiveCoverageContract({
                productType,
                quoteData,
                cfg: normalizedMbeCfg,
                storedSelection: prevDraft.coverageSelection,
                programId: policy.programId || null,
                source: isRenewal ? 'RENEWAL_DRAFT' : 'ENDORSEMENT_DRAFT',
            }).resolvedCoverageSet;

            const adapterResult = await adapter.buildQuoteResponse(quoteData, programMeta, { resolvedCoverageSet });
            const quoteResponse = adapterResult.quoteResponse as unknown as QuoteResponse;
            const underwritingAnalysis = adapterResult.underwritingAnalysis;
            const uwDecision = parseRecord(underwritingAnalysis) as { outcome?: string; lane?: string; reasons?: string[] };
            const uwReasons = Array.isArray(uwDecision.reasons) ? uwDecision.reasons : [];
            const normalizedQuoteResponse: QuoteResponse = {
                ...quoteResponse,
                status: uwDecision.outcome === 'decline' ? 'declined' : uwDecision.outcome === 'referral' ? 'referral' : 'quoted',
                referralMessage:
                    uwDecision.outcome === 'referral'
                        ? `Referred for underwriting review: ${uwReasons.join(' ')}`
                        : quoteResponse.referralMessage as string | undefined,
                warnings: [
                    ...((quoteResponse.warnings || []) as string[]),
                    ...(uwDecision.outcome !== 'accept'
                        ? [`Underwriting ${String(uwDecision.lane || '').toUpperCase()} lane: ${uwReasons.join(' ')}`]
                        : []),
                ],
            };

            const reasonCodeUpper = String(parseRecord(prevDraft.endorsementWorkspace).reasonCode || '').toUpperCase();
            const isCancellationEndorsement = reasonCodeUpper === 'CANCELLATION';
            const policyStartForProration = policy.inceptionDate ? new Date(policy.inceptionDate) : new Date();
            const policyEndForProration = policy.expiryDate ? new Date(policy.expiryDate) : new Date(policyStartForProration.getTime() + 365 * 24 * 60 * 60 * 1000);
            const draftEndForProration = rt.expiryDate ? new Date(rt.expiryDate) : policyEndForProration;

            let finalQuoteResponse: QuoteResponse = normalizedQuoteResponse;
            if (!isCancellationEndorsement && !isRenewal) {
                finalQuoteResponse = applyEndorsementTermProration({
                    quoteResponse: normalizedQuoteResponse,
                    policyStart: policyStartForProration,
                    policyEnd: policyEndForProration,
                    draftEnd: draftEndForProration,
                }).quoteResponse;
            }

            let cancellationFinancials: Record<string, unknown> | null = null;
            if (isCancellationEndorsement) {
                const latestPrior = await tx.riskTransaction.findFirst({
                    where: {
                        policyId,
                        status: 'BOUND',
                        transactionType: { in: [...VERSION_HISTORY_TRANSACTION_TYPES] },
                        transactionNumber: { lt: rt.transactionNumber },
                    },
                    orderBy: { transactionNumber: 'desc' },
                    select: { pricingFinal: true },
                });
                const prevPricing = parseRecord(jsonParse(latestPrior?.pricingFinal));
                const policyStart = policy.inceptionDate ? new Date(policy.inceptionDate) : new Date();
                const policyEnd = policy.expiryDate ? new Date(policy.expiryDate) : new Date(policyStart.getTime() + 365 * 24 * 60 * 60 * 1000);
                const cancellationDate = rt.effectiveDate ? new Date(rt.effectiveDate) : new Date();
                const quoteDataRecord = parseRecord(quoteData);
                const nonRefundedFixedAmount = Number(quoteDataRecord.nonRefundedFixedAmount ?? 0) || 0;
                const nonRefundedPct = Number(quoteDataRecord.nonRefundedPct ?? 0) || 0;
                const grossPremium = Math.max(0, Number(prevPricing.premium ?? parseRecord(normalizedQuoteResponse.primaryOption).annualPremium ?? 0) || 0);

                const financials = computeCancellationFinancials({
                    grossPremium,
                    policyStart,
                    policyEnd,
                    cancellationDate,
                    nonRefundedFixedAmount,
                    nonRefundedPct,
                });

                cancellationFinancials = {
                    type: 'cancellation',
                    policyStart: policyStart.toISOString(),
                    policyEnd: policyEnd.toISOString(),
                    cancellationDate: cancellationDate.toISOString(),
                    grossPremium,
                    ...financials,
                };

                const primaryOption = parseRecord(normalizedQuoteResponse.primaryOption);
                const costDetails = parseRecord(primaryOption.costDetails);
                const grossPremiumBase = Number(costDetails.grossPremium ?? 0) || 0;
                const ncdAmountBase = Number(costDetails.ncdAmount ?? 0) || 0;
                const onlineDiscountBase = Number(costDetails.onlineDiscount ?? 0) || 0;
                const mifSurchargeBase = Number(costDetails.mifSurcharge ?? 0) || 0;
                const policyFeeBase = Number(costDetails.policyFee ?? 0) || 0;
                const stampDutyBase = Number(costDetails.stampDuty ?? 0) || 0;
                const trace = parseRecord(primaryOption.calculationTrace);
                const existingSteps = Array.isArray(trace.steps) ? trace.steps : [];
                const step = {
                    id: 'endorsement.cancellation.prorata',
                    name: 'Cancellation pro-rata credit',
                    kind: 'adjustment',
                    amount: -Math.abs(financials.refundAmount),
                    output: -Math.abs(financials.refundAmount),
                    notes: `Unearned premium ${financials.unearnedPremium} minus non-refundable ${financials.nonRefundedComponent}`,
                    inputs: {
                        totalDays: financials.totalDays,
                        daysInForce: financials.daysInForce,
                        daysRemaining: financials.daysRemaining,
                    },
                };
                finalQuoteResponse = {
                    ...normalizedQuoteResponse,
                    primaryOption: {
                        ...primaryOption,
                        name: String(primaryOption.name || 'Cancellation'),
                        annualPremium: -Math.abs(financials.refundAmount),
                        totalExcess: Number(primaryOption.totalExcess ?? 0) || 0,
                        costDetails: {
                            grossPremium: grossPremiumBase,
                            ncdAmount: ncdAmountBase,
                            onlineDiscount: onlineDiscountBase,
                            subtotalNetPremium: -Math.abs(financials.refundAmount),
                            mifSurcharge: mifSurchargeBase,
                            policyFee: policyFeeBase,
                            stampDuty: stampDutyBase,
                            totalPremium: -Math.abs(financials.refundAmount),
                        },
                        calculationTrace: {
                            ...trace,
                            steps: [...existingSteps, step],
                        },
                    },
                };
            }

            const pricingStamp = computePricingIntegrityStamp({
                quoteData,
                quoteResponse: finalQuoteResponse,
                overrideExcess: overrideExcess || null,
            });

            const nextDraft = {
                ...(prevDraft || {}),
                quoteData,
                quoteResponse: finalQuoteResponse,
                underwritingAnalysis: buildUnderwritingAnalysis({
                    uwDecision,
                    quoteResponse: finalQuoteResponse,
                }),
                pricing: {
                    ...parseRecord(prevDraft.pricing),
                    ...pricingStamp,
                },
                endorsementMeta: {
                    ...parseRecord(prevDraft.endorsementMeta),
                    ...(cancellationFinancials ? { cancellationFinancials } : {}),
                },
                uwDecision,
            };

            await persistWorkspaceSnapshot(tx, { policyId, riskTransactionId, nextSnapshot: nextDraft });
            await tx.riskTransaction.update({
                where: { id: riskTransactionId },
                data: {
                    effectiveDate: rt.effectiveDate || new Date(),
                    changeReason: rt.changeReason || `${String(rt.transactionType || 'ENDORSEMENT').toUpperCase()}_DRAFT_RATED`,
                },
            });

            return { quoteResponse: finalQuoteResponse };
        });

        void AuditLogger.log(
            policyId,
            'POLICY',
            auditAction,
            actor?.id || 'system',
            'USER',
            { riskTransactionId },
            actor?.name ?? undefined
        );

        // Persist deterministic price audit for BDX reconciliation + debugging.
        try {
            const finalPrimary = parseRecord(parseRecord(result.quoteResponse).primaryOption);
            const trace = parseRecord(finalPrimary.calculationTrace);
            const steps = Array.isArray(trace.steps) ? (trace.steps as unknown as CalculationStep[]) : [];
            const calculatorVersion = typeof trace.calculatorVersion === 'string' && trace.calculatorVersion
                ? trace.calculatorVersion
                : 'unknown@legacy';
            const policy = await tenantScopedPrisma.policy.findUnique({
                where: { id: policyId },
                select: { productType: true, quoteData: true },
            });
            const productType = String(policy?.productType || '').toUpperCase();
            const quoteInputs = parseRecord(jsonParse(policy?.quoteData));
            const totalPremium = Number(parseRecord(finalPrimary.costDetails).totalPremium ?? finalPrimary.annualPremium ?? 0) || 0;
            await recordPriceAudit({
                policyId,
                riskTransactionId,
                productType: productType || 'UNKNOWN',
                calculatorVersion,
                inputs: quoteInputs,
                steps,
                totalPremium,
                policyExcess: Number(finalPrimary.totalExcess ?? 0) || 0,
                currency: 'EUR',
                eventKind: 'ENDORSEMENT_RATE',
                createdBy: actor?.id || null,
            });
        } catch (err) {
            logger.warn({ err, event: 'price_audit.endorsement_rate.skip' }, 'price audit skipped');
        }

        return { status: 'SUCCESS', data: result };
    } catch (error: unknown) {
        logger.error({ err: error }, 'Rate endorsement draft error:');
        const statusCode = Number(
            typeof error === 'object' && error !== null && 'statusCode' in error
                ? (error as { statusCode?: unknown }).statusCode
                : 500
        );
        const details =
            typeof error === 'object' && error !== null && 'details' in error
                ? (error as { details?: unknown }).details
                : undefined;
        const message =
            error instanceof Error
                ? error.message
                : 'Failed to rate endorsement draft';
        return {
            status: statusCode === 400 ? 'INVALID_QUOTE_DATA' : 'SERVER_ERROR',
            error: {
                code: statusCode === 400 ? 'INVALID_QUOTE_DATA' : 'SERVER_ERROR',
                message,
                ...(details ? { details } : {})
            }
        };
    }
}
