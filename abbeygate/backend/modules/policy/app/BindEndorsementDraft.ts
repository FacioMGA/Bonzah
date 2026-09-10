import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { assertEndorsementDraftRiskTransaction, jsonStringify } from '../../policy/app/shared.js';
import { logger } from '../../../platform/utils/logger.js';
import { evaluateIssueReadiness } from '../../policy/app/issueReadiness.js';
import { isRenewalTransactionType } from '../domain/riskTransactionTypes.js';
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

function readExplicitNumber(record: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
        const value = Number(record[key]);
        if (Number.isFinite(value)) return value;
    }
    return null;
}

function buildRatedPricingFinal(snap: Record<string, unknown>):
    | { ok: true; value: { premium: number; currency: string; quoteResponse: Record<string, unknown>; quoteData: Record<string, unknown>; pricing: Record<string, unknown> } }
    | { ok: false; error: { code: string; message: string } } {
    const quoteResponse = parseRecord(snap.quoteResponse);
    const quoteData = parseRecord(snap.quoteData);
    const pricing = parseRecord(snap.pricing);
    const primary = parseRecord(quoteResponse.primaryOption);
    const costDetails = parseRecord(primary.costDetails);
    const premium = readExplicitNumber(costDetails, ['totalPremium']);

    if (!Object.keys(quoteResponse).length || premium === null) {
        return {
            ok: false,
            error: {
                code: 'PRICING_REQUIRED',
                message: 'Endorsement draft must be rated with canonical cost details before binding.',
            },
        };
    }
    if (!Object.keys(quoteData).length) {
        return {
            ok: false,
            error: {
                code: 'QUOTE_DATA_REQUIRED',
                message: 'Endorsement draft is missing quote data required for the immutable issued snapshot.',
            },
        };
    }
    if (!pricing.snapshotHash || !pricing.pricingHash) {
        return {
            ok: false,
            error: {
                code: 'PRICING_INTEGRITY_REQUIRED',
                message: 'Endorsement draft is missing pricing integrity hashes. Recalculate premium before binding.',
            },
        };
    }

    return {
        ok: true,
        value: {
            premium,
            currency: String(quoteResponse.currency || 'EUR'),
            quoteResponse,
            quoteData,
            pricing,
        },
    };
}

export interface EndorsementActor {
    id: string | null;
    name: string | null;
    email: string | null;
    role: string | null;
}

export interface BindEndorsementDraftInput {
    policyId: string;
    riskTransactionId: string;
    actor: EndorsementActor;
}

export type UseCaseResult<T> =
    | { status: 'SUCCESS'; data: T }
    | { status: 'BLOCKED'; error: unknown; details?: unknown }
    | { status: 'SERVER_ERROR'; error: unknown };

export async function executeBindEndorsementDraft(
    input: BindEndorsementDraftInput
): Promise<UseCaseResult<{ status: string; riskTransactionId: string }>> {
    const { policyId, riskTransactionId, actor } = input;

    try {
        const existing = await tenantScopedPrisma.riskTransaction.findFirst({
            where: { id: riskTransactionId, policyId },
            select: { transactionType: true },
        });
        const auditAction: 'ENDORSEMENT.BOUND' | 'RENEWAL.BOUND' =
            isRenewalTransactionType(existing?.transactionType) ? 'RENEWAL.BOUND' : 'ENDORSEMENT.BOUND';
        const readiness = await evaluateIssueReadiness(policyId, 'bo', { riskTransactionId });
        if (!readiness?.canIssue) {
            return {
                status: 'BLOCKED',
                error: {
                    code: 'BLOCKED',
                    message: 'Cannot bind endorsement while blockers exist',
                    details: readiness,
                },
                details: readiness
            };
        }

        const bound = await tenantScopedPrisma.$transaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
            await assertEndorsementDraftRiskTransaction(tx, { policyId, riskTransactionId });

            const state = await tx.policyStateCurrent.findUnique({ where: { policyId } });
            const snap = state ? parseSnapshot(jsonParse(state.snapshot)) : {};
            const ratedPricing = buildRatedPricingFinal(snap);
            if (!ratedPricing.ok) {
                return { blocked: true as const, error: ratedPricing.error };
            }

            const nextPricingFinal = {
                premium: ratedPricing.value.premium,
                currency: ratedPricing.value.currency,
                quoteResponse: ratedPricing.value.quoteResponse,
                quoteData: ratedPricing.value.quoteData,
                pricing: ratedPricing.value.pricing,
            };

            const updated = await tx.riskTransaction.update({
                where: { id: riskTransactionId },
                data: {
                    status: 'BOUND',
                    snapshotFinal: jsonStringify(snap),
                    pricingFinal: jsonStringify(nextPricingFinal),
                    snapshotHash: parseRecord(snap.pricing).snapshotHash || null,
                    pricingHash: parseRecord(snap.pricing).pricingHash || null,
                },
            });
            return { blocked: false as const, transactionNumber: updated.transactionNumber };
        });
        if (bound.blocked) {
            return { status: 'BLOCKED', error: bound.error };
        }

        void AuditLogger.log(
            policyId,
            'POLICY',
            auditAction,
            actor?.id || 'system',
            'USER',
            { riskTransactionId, transactionNumber: bound.transactionNumber },
            actor?.name ?? undefined
        );

        return { status: 'SUCCESS', data: { status: 'BOUND', riskTransactionId } };
    } catch (error: unknown) {
        logger.error({ err: error }, 'Bind endorsement draft error:');
        const message = error instanceof Error ? error.message : 'Failed to bind endorsement';
        return { status: 'SERVER_ERROR', error: { code: 'SERVER_ERROR', message } };
    }
}
