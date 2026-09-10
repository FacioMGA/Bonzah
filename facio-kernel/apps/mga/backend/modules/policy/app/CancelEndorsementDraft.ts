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

export interface CancelEndorsementDraftInput {
    policyId: string;
    riskTransactionId: string;
    actor: EndorsementActor;
}

export type UseCaseResult<T> =
    | { status: 'SUCCESS'; data: T }
    | { status: 'SERVER_ERROR'; error: unknown };

export async function executeCancelEndorsementDraft(
    input: CancelEndorsementDraftInput
): Promise<UseCaseResult<{ status: string; riskTransactionId: string }>> {
    const { policyId, riskTransactionId, actor } = input;

    try {
        await runTenantScopedTransaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
            await assertEndorsementDraftRiskTransaction(tx, { policyId, riskTransactionId });

            await tx.riskTransaction.update({
                where: { id: riskTransactionId },
                data: { status: 'CANCELLED' },
            });

            const latestBound = await tx.riskTransaction.findFirst({
                where: { policyId, status: 'BOUND' },
                orderBy: { transactionNumber: 'desc' },
            });

            const fallbackSnap = latestBound?.snapshotFinal
                ? parseSnapshot(jsonParse(latestBound.snapshotFinal))
                : {};

            await persistWorkspaceSnapshot(tx, { policyId, riskTransactionId: null, nextSnapshot: fallbackSnap });
        });

        void AuditLogger.log(
            policyId,
            'POLICY',
            'POLICY.UPDATED',
            actor?.id || 'system',
            'USER',
            { action: 'ENDORSEMENT_DRAFT_CANCELLED', riskTransactionId },
            actor?.name ?? undefined
        );
        return { status: 'SUCCESS', data: { status: 'CANCELLED', riskTransactionId } };
    } catch (error: unknown) {
        logger.error({ err: error }, 'Cancel endorsement draft error:');
        const message = error instanceof Error ? error.message : 'Failed to cancel endorsement draft';
        return { status: 'SERVER_ERROR', error: { code: 'SERVER_ERROR', message } };
    }
}
