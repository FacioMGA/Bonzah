import type { Prisma } from '@prisma/client';
import { runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { assertEndorsementDraftRiskTransaction, persistWorkspaceSnapshot } from '../../policy/app/shared.js';
import { logger } from '../../../platform/utils/logger.js';
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

export interface EndorsementActor {
    id: string | null;
    name: string | null;
    email: string | null;
    role: string | null;
}

export interface PatchEndorsementDraftInput {
    policyId: string;
    riskTransactionId: string;
    actor: EndorsementActor;
    body: {
        effectiveDate?: string;
        expiryDate?: string;
        quoteData?: Record<string, unknown>;
        quoteResponse?: Record<string, unknown>;
        coverageSelection?: Record<string, unknown>;
        uwDecision?: Record<string, unknown>;
        pricing?: Record<string, unknown>;
        endorsementMeta?: Record<string, unknown>;
    }
}

export type UseCaseResult<T> =
    | { status: 'SUCCESS'; data: T }
    | { status: 'NOT_FOUND' | 'INVALID_STATUS' | 'SERVER_ERROR'; error: unknown };

export async function executePatchEndorsementDraft(
    input: PatchEndorsementDraftInput
): Promise<UseCaseResult<Record<string, unknown>>> {
    const { policyId, riskTransactionId, actor, body } = input;

    try {
        const updated = await runTenantScopedTransaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
            const rt = await assertEndorsementDraftRiskTransaction(tx, { policyId, riskTransactionId });
            const prevDraft = parseSnapshot(jsonParse(rt.snapshotDraft));

            const nextEffectiveDate = body.effectiveDate ? new Date(String(body.effectiveDate)) : null;
            const nextExpiryDate = body.expiryDate ? new Date(String(body.expiryDate)) : null;
            if (nextEffectiveDate && !Number.isNaN(nextEffectiveDate.getTime())) {
                await tx.riskTransaction.update({
                    where: { id: riskTransactionId },
                    data: { effectiveDate: nextEffectiveDate },
                });
            }
            if (nextExpiryDate && !Number.isNaN(nextExpiryDate.getTime())) {
                await tx.riskTransaction.update({
                    where: { id: riskTransactionId },
                    data: { expiryDate: nextExpiryDate },
                });
            }

            const patch: Record<string, unknown> = {};
            if (body.quoteData && typeof body.quoteData === 'object') patch.quoteData = body.quoteData;
            if (body.quoteResponse && typeof body.quoteResponse === 'object') patch.quoteResponse = body.quoteResponse;
            if (body.coverageSelection && typeof body.coverageSelection === 'object') patch.coverageSelection = body.coverageSelection;
            if (body.uwDecision && typeof body.uwDecision === 'object') patch.uwDecision = body.uwDecision;
            if (body.pricing && typeof body.pricing === 'object') patch.pricing = body.pricing;
            if (body.endorsementMeta && typeof body.endorsementMeta === 'object') patch.endorsementMeta = body.endorsementMeta;

            const nextDraft = { ...(prevDraft || {}), ...patch };
            await persistWorkspaceSnapshot(tx, { policyId, riskTransactionId, nextSnapshot: nextDraft });
            return nextDraft;
        });

        void AuditLogger.log(
            policyId,
            'POLICY',
            'POLICY.UPDATED',
            actor?.id || 'system',
            'USER',
            {
                action: 'ENDORSEMENT_DRAFT_PATCH',
                riskTransactionId,
                endorsementMeta: updated?.endorsementMeta || undefined,
            },
            actor?.name ?? undefined
        );

        return { status: 'SUCCESS', data: updated };
    } catch (error: unknown) {
        logger.error({ err: error }, 'Patch endorsement draft error:');
        const message = error instanceof Error ? error.message : 'Failed to update endorsement draft';
        return { status: 'SERVER_ERROR', error: { code: 'SERVER_ERROR', message } };
    }
}
