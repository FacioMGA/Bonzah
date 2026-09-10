import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { isIssuedLifecycleStatus, jsonStringify, persistWorkspaceSnapshot } from '../../policy/app/shared.js';
import { logger } from '../../../platform/utils/logger.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import {
    isRenewalTransactionType,
    VERSION_HISTORY_TRANSACTION_TYPES,
} from '../domain/riskTransactionTypes.js';

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

function cancellationProcessingSnapshot(
    draftSnapshot: ReturnType<typeof parseSnapshot>,
    currentSnapshot: ReturnType<typeof parseSnapshot>,
    actorId: string | null,
) {
    return {
        ...draftSnapshot,
        cancellationRequest: {
            ...parseRecord(currentSnapshot.cancellationRequest),
            status: 'PROCESSING',
            processingAt: new Date().toISOString(),
            processingBy: actorId || 'system',
        },
        flow_context: { channel: 'backoffice', step: 'premium' },
    };
}

export interface EndorsementActor {
    id: string | null;
    name: string | null;
    email: string | null;
    role: string | null;
}

export interface CreateEndorsementDraftInput {
    policyId: string;
    effectiveDate: Date;
    reason: string | null;
    reasonCode: string | null;
    actor: EndorsementActor;
    transactionType?: 'ENDORSEMENT' | 'RENEWAL';
}

export type UseCaseResult<T> =
    | { status: 'SUCCESS'; data: T }
    | { status: 'NOT_FOUND' | 'INVALID_STATUS' | 'SERVER_ERROR'; error: unknown };

export async function executeCreateEndorsementDraft(input: CreateEndorsementDraftInput): Promise<UseCaseResult<{ riskTransactionId: string; transactionNumber: number; deduped?: boolean }>> {
    const { policyId, actor, effectiveDate, reason, reasonCode } = input;
    const transactionType = isRenewalTransactionType(input.transactionType) ? 'RENEWAL' : 'ENDORSEMENT';
    const auditAction: 'ENDORSEMENT.DRAFT.CREATED' | 'RENEWAL.DRAFT.CREATED' =
        transactionType === 'RENEWAL' ? 'RENEWAL.DRAFT.CREATED' : 'ENDORSEMENT.DRAFT.CREATED';

    try {
        const policy = await tenantScopedPrisma.policy.findUnique({ where: { id: policyId }, include: { stateCurrent: true } });
        if (!policy) return { status: 'NOT_FOUND', error: { code: 'NOT_FOUND', message: 'Policy not found' } };

        const reasonCodeUpper = String(reasonCode || '').toUpperCase();
        const policyStatusUpper = String(policy.status || '').toUpperCase();

        const allowCancellationFromRequested = reasonCodeUpper === 'CANCELLATION' && policyStatusUpper === 'CANCELLATION_REQUESTED';
        if (!isIssuedLifecycleStatus(policyStatusUpper) && !allowCancellationFromRequested) {
            return { status: 'INVALID_STATUS', error: { code: 'INVALID_STATUS', message: `Create Endorsement is allowed only on issued policies (status '${policy.status}')` } };
        }

        if (reasonCodeUpper === 'CANCELLATION' && transactionType === 'ENDORSEMENT') {
            const draftEndorsements = await tenantScopedPrisma.riskTransaction.findMany({
                where: { policyId, transactionType: 'ENDORSEMENT', status: 'DRAFT' },
                orderBy: { transactionNumber: 'desc' },
                take: 20,
            });
            const existingCancellationDraft = draftEndorsements.find((candidate) => {
                const draftSnap = parseSnapshot(jsonParse(candidate.snapshotDraft));
                const ws = parseRecord(draftSnap.endorsementWorkspace);
                return String(ws.reasonCode || '').toUpperCase() === 'CANCELLATION';
            });

            if (existingCancellationDraft?.id) {
                const currentSnapshot = parseSnapshot(policy.stateCurrent?.snapshot);
                const existingDraftSnapshot = parseSnapshot(jsonParse(existingCancellationDraft.snapshotDraft));
                await runTenantScopedTransaction(async (_tx) => {
                    const tx = _tx as Prisma.TransactionClient;
                    await persistWorkspaceSnapshot(tx, {
                        policyId,
                        riskTransactionId: existingCancellationDraft.id,
                        nextSnapshot: cancellationProcessingSnapshot(existingDraftSnapshot, currentSnapshot, actor?.id),
                    });
                });
                return {
                    status: 'SUCCESS',
                    data: {
                        riskTransactionId: existingCancellationDraft.id,
                        transactionNumber: existingCancellationDraft.transactionNumber,
                        deduped: true,
                    },
                };
            }
        }

        const created = await runTenantScopedTransaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
            const lastTxn = await tx.riskTransaction.findFirst({
                where: { policyId },
                orderBy: { transactionNumber: 'desc' },
                select: { transactionNumber: true },
            });

            let latestIssued = await tx.riskTransaction.findFirst({
                where: { policyId, status: 'BOUND', transactionType: { in: [...VERSION_HISTORY_TRANSACTION_TYPES] } },
                orderBy: { transactionNumber: 'desc' },
            });

            if (!latestIssued?.id) {
                const issuedLike = isIssuedLifecycleStatus(policyStatusUpper) || policyStatusUpper === 'CANCELLATION_REQUESTED';
                if (!issuedLike) throw new Error('Missing issued version (no bound INCEPTION found)');
                const fallbackSnapshot = parseSnapshot(jsonParse(policy.stateCurrent?.snapshot));
                const fallbackTxnNumber = (lastTxn?.transactionNumber || 0) + 1;
                latestIssued = await tx.riskTransaction.create({
                    data: {
                        policyId,
                        programId: policy.programId || null,
                        binderId: policy.binderId || null,
                        transactionNumber: fallbackTxnNumber,
                        transactionType: 'INCEPTION',
                        status: 'BOUND',
                        effectiveDate: policy.inceptionDate,
                        expiryDate: policy.expiryDate || null,
                        changeReason: 'BASELINE_BACKFILL',
                        createdBy: actor?.id || 'system',
                        snapshotFinal: jsonStringify(fallbackSnapshot),
                    } as unknown as Prisma.RiskTransactionUncheckedCreateInput,
                });
            }
            const baseSnapshot = parseSnapshot(jsonParse(latestIssued.snapshotFinal));
            const draftSnapshot = {
                ...(baseSnapshot || {}),
                endorsementWorkspace: {
                    baseRiskTransactionId: latestIssued.id,
                    baseTransactionNumber: latestIssued.transactionNumber,
                    transactionType,
                    effectiveDate: effectiveDate.toISOString(),
                    reason,
                    reasonCode,
                    createdAt: new Date().toISOString(),
                    createdBy: {
                        id: actor?.id || null,
                        name: actor?.name || null,
                        email: actor?.email || null,
                        role: actor?.role || null,
                    },
                },
            };

            let rt: { id: string; transactionNumber: number };
            for (let attempt = 0; ; attempt++) {
                const latestForVersion = await tx.riskTransaction.findFirst({
                    where: { policyId },
                    orderBy: { transactionNumber: 'desc' },
                    select: { transactionNumber: true },
                });
                const nextTxnNumber = (latestForVersion?.transactionNumber || 0) + 1;
                try {
                    rt = await tx.riskTransaction.create({
                        data: {
                            policyId,
                            programId: policy.programId || null,
                            binderId: policy.binderId || null,
                            transactionNumber: nextTxnNumber,
                            transactionType,
                            status: 'DRAFT',
                            effectiveDate,
                            expiryDate: policy.expiryDate || null,
                            changeReason: reasonCode || reason || `${transactionType}_DRAFT`,
                            createdBy: actor?.id || 'system',
                            snapshotDraft: jsonStringify(draftSnapshot),
                        } as unknown as Prisma.RiskTransactionUncheckedCreateInput,
                    });
                    break;
                } catch (error) {
                    const code = String((error as { code?: string })?.code || '');
                    if (code === 'P2002' && attempt < 4) continue;
                    throw error;
                }
            }

            // Persist the workspace and cancellation progression as one snapshot.
            // A second upsert built from the pre-draft snapshot would hide the
            // draft and leave the Service action looking unprocessed (ABY-462).
            const nextWorkspaceSnapshot = reasonCodeUpper === 'CANCELLATION'
                ? cancellationProcessingSnapshot(
                    draftSnapshot,
                    parseSnapshot(policy.stateCurrent?.snapshot),
                    actor?.id,
                )
                : draftSnapshot;
            await persistWorkspaceSnapshot(tx, {
                policyId,
                riskTransactionId: rt.id,
                nextSnapshot: nextWorkspaceSnapshot,
            });

            return rt;
        });

        void AuditLogger.log(policyId, 'POLICY', auditAction, actor?.id || 'system', 'USER', {
            riskTransactionId: created.id,
            transactionNumber: created.transactionNumber,
            reasonCode: reasonCode || undefined,
        }, actor?.name ?? undefined);

        return { status: 'SUCCESS', data: { riskTransactionId: created.id, transactionNumber: created.transactionNumber } };
    } catch (error: unknown) {
        logger.error({ err: error }, 'Create endorsement draft error:');
        const message = error instanceof Error ? error.message : 'Failed to create endorsement draft';
        return { status: 'SERVER_ERROR', error: { code: 'SERVER_ERROR', message } };
    }
}
