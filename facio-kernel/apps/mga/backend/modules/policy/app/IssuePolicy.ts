import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { transitionPolicyLifecycle } from './commands/policyLifecycleCommands.js';
import { enqueuePolicyListIndexUpdate } from '../infra/projections/policyListIndex.js';
import { jsonStringify } from '../../policy/app/shared.js';
import { assertCanIssuePolicy, determinePostBindLifecycleStatus } from '../domain/issuance.js';
import { evaluateIssueReadiness } from './issueReadiness.js';
import { enqueueIssuedPolicyPack } from './commands/issuedPackEnqueue.js';
import { appendDomainEvent, buildDomainEvent } from '../../../platform/events/domainEvents.js';
import { getSanctionsService, resolveIndividualScreeningSubject, SanctionsBlockError } from '../../compliance/app/index.js';
import {
  reserveNextPolicyId,
  assignPlatformIssuanceIdentifiers,
  shouldReassignPolicyNumberAtIssuance,
} from '../../../platform/utils/platformIds.js';

import {
    parseSnapshot,
    parseRecord
} from '../../../platform/utils/mappingHelpers.js';
import { ISSUANCE_TRANSACTION_TYPES } from '../domain/riskTransactionTypes.js';

function parseSnapshotValue(value: unknown): Record<string, unknown> {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        } catch {
            return {};
        }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export interface IssuePolicyActor {
    id: string | null;
    name: string | null;
    email: string | null;
    role: string | null;
}

export interface IssuePolicyInput {
    policyId: string;
    actor: IssuePolicyActor;
    correlationId?: string;
    /**
     * Migration-quiet issuance. When true, the DOC.GENERATE_ISSUED_POLICY_PACK
     * outbox event is NOT emitted, so no doc-pack PDF is generated and no
     * welcome email is sent. Used by the BDX historical-migration importer:
     * migrated policies are already-issued historical records, so a "welcome"
     * email (to the synthetic `bdx-import@import.local` address) is wrong, and
     * per-policy doc-pack generation is the throughput bottleneck + DB-load
     * source on bulk migrations. Real BO / customer issuance never sets this,
     * so their doc-pack + welcome-email behavior is unchanged. Doc packs for
     * migrated policies can be regenerated on demand later.
     */
    suppressIssuedPack?: boolean;
    /**
     * ADR-0096: externally-issued packs are already uploaded and must be
     * emailed through the worker after the canonical lifecycle commit.
     */
    externalDocumentEmail?: { documentIds: string[] };
}

export type UseCaseResult<T> =
    | { status: 'SUCCESS'; data: T }
    | { status: 'NOT_FOUND' | 'INVALID_STATUS' | 'BLOCKED' | 'SERVER_ERROR' | 'UNAUTHORIZED' | 'MISSING_TRANSACTION'; error: unknown };

export async function executeIssuePolicy(input: IssuePolicyInput): Promise<UseCaseResult<{ status: string; riskTransactionId: string }>> {
    const { policyId, actor, correlationId, suppressIssuedPack, externalDocumentEmail } = input;

    const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: policyId },
        include: { stateCurrent: true, policyHolder: true },
    });
    if (!policy) return { status: 'NOT_FOUND', error: { code: 'NOT_FOUND', message: 'Policy not found' } };

    const st = String(policy.status || '').toUpperCase();
    try {
        assertCanIssuePolicy(st);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Invalid status';
        return { status: 'INVALID_STATUS', error: { code: 'INVALID_STATUS', message } };
    }

    const screeningSubject = resolveIndividualScreeningSubject({
        policyHolderName: policy.policyHolder?.name || null,
        quoteData: parseRecord(parseSnapshotValue(policy.stateCurrent?.snapshot).quoteData || policy.quoteData),
    });
    if (!screeningSubject) {
        return {
            status: 'BLOCKED',
            error: {
                code: 'SANCTION_SCREENING_SUBJECT_MISSING',
                message: 'Cannot run sanctions screening because the insured person name is missing.',
            }
        };
    }
    try {
        await getSanctionsService().assertClearOrThrow({
            actionType: 'POLICY_ISSUE',
            policyId,
            subjectName: screeningSubject.subjectName,
            dateOfBirth: screeningSubject.dateOfBirth,
            correlationId: correlationId || `issue-policy:${policyId}`,
        });
    } catch (error) {
        if (error instanceof SanctionsBlockError) {
            return {
                status: 'BLOCKED',
                error: {
                    code: 'SANCTION_SCREENING_BLOCKED',
                    message: error.message,
                    screeningOutcome: error.outcome,
                    reasonCode: error.reasonCode,
                    providerSearchId: error.providerSearchId,
                }
            };
        }
        return {
            status: 'BLOCKED',
            error: {
                code: 'SANCTION_SCREENING_UNAVAILABLE',
                message: 'Sanctions screening is unavailable. Issuance is blocked until screening succeeds.',
            }
        };
    }

    const readiness = await evaluateIssueReadiness(policyId, 'bo');
    if (!readiness?.canIssue) {
        return {
            status: 'BLOCKED',
            error: {
                code: 'READINESS_BLOCKED',
                message: 'Issue readiness check failed',
                blockers: (readiness as { blockers?: unknown })?.blockers ?? [],
            },
        };
    }

    const riskTxn = await tenantScopedPrisma.riskTransaction.findFirst({
        where: { policyId, transactionType: { in: [...ISSUANCE_TRANSACTION_TYPES] }, status: 'BOUND' },
        orderBy: { transactionNumber: 'desc' },
        select: { id: true },
    });
    if (!riskTxn?.id) {
        return { status: 'MISSING_TRANSACTION', error: { code: 'MISSING_TRANSACTION', message: 'Missing bound issuance transaction' } };
    }

    const now = new Date();
    const nextLifecycleStatus = determinePostBindLifecycleStatus(policy.inceptionDate, now);
    const transitionPath = nextLifecycleStatus === 'ACTIVE' ? (['ISSUING', 'ACTIVE'] as const) : ([nextLifecycleStatus] as const);

    const prevSnap = policy.stateCurrent ? parseSnapshot(parseSnapshotValue(policy.stateCurrent.snapshot)) : {};
    const productType = String(policy.productType || '').trim().toUpperCase();
    const existingPolicyNumber = String(policy.policyNumber || '').trim();

    let issuedPackJobId: string | null = null;
    let resolvedPolicyNumber = existingPolicyNumber;
    await runTenantScopedTransaction(async (_tx) => {
      const tx = _tx as unknown as Prisma.TransactionClient;

        if (process.env.KERNEL_PLATFORM_MODE === 'true') {
            resolvedPolicyNumber = (await assignPlatformIssuanceIdentifiers(tx, policyId, 'MANUAL', false)).policyNumber;
            if (resolvedPolicyNumber !== existingPolicyNumber) await tx.policySearchIndex.update({ where: { policyId }, data: { policyNumber: resolvedPolicyNumber } }).catch(() => undefined);
        } else if (productType && shouldReassignPolicyNumberAtIssuance(productType, existingPolicyNumber)) {
            resolvedPolicyNumber = await reserveNextPolicyId(tx, productType, 'MANUAL');
            await tx.policy.update({
                where: { id: policyId },
                data: { policyNumber: resolvedPolicyNumber },
            });
            await tx.policySearchIndex
                .update({ where: { policyId }, data: { policyNumber: resolvedPolicyNumber } })
                .catch(() => undefined);
        }

        const nextSnapshot = {
            ...prevSnap,
            ...(resolvedPolicyNumber !== existingPolicyNumber ? { policyId: resolvedPolicyNumber } : {}),
            issuance: {
                issuedAt: now.toISOString(),
                issuedBy: {
                    id: actor?.id || null,
                    name: actor?.name || null,
                    email: actor?.email || null,
                    role: actor?.role || null,
                },
            },
        };

        for (const targetStatus of transitionPath) {
            await transitionPolicyLifecycle({
                tx,
                policyId,
                to: targetStatus,
                actorId: actor?.id || 'system',
                actorType: 'USER',
                reasonCode: 'POLICY_ISSUED',
                correlationId: correlationId || '',
            });
        }

        await tx.policy.update({
            where: { id: policyId },
            data: { isLocked: true, issuedAt: policy.issuedAt || now },
        });
        await tx.policySearchIndex.update({ where: { policyId }, data: { status: nextLifecycleStatus } }).catch(() => undefined);
        await enqueuePolicyListIndexUpdate(tx, policyId);

        await tx.policyStateCurrent.upsert({
            where: { policyId },
            update: { snapshot: jsonStringify(nextSnapshot) },
            create: { policyId, snapshot: jsonStringify(nextSnapshot) } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
        });

        // ADR-0013 — canonical issuance spine. Doc-pack generation
        // and welcome-email orchestration are owned by the
        // DOC.GENERATE_ISSUED_POLICY_PACK worker. The outbox row is
        // committed atomically with this lifecycle transition: if the
        // tx rolls back, no row exists; if it commits, the relay is
        // guaranteed to deliver the job. There is NO inline /
        // synchronous DocumentService.generate('ISSUED_POLICY_PACK')
        // path and NO inline welcome-email path.
        // Migration-quiet imports skip the whole issued-pack orchestration
        // (doc-pack PDF + welcome email). Everything above — lifecycle
        // transition, lock, index/state projection — still runs so the policy
        // is a complete, ACTIVE record; only the customer-facing side-effects
        // are suppressed for historical migrated policies.
        if (!suppressIssuedPack) {
            const docEvent = await enqueueIssuedPolicyPack(tx, {
                policyId,
                riskTransactionId: riskTxn.id,
                source: 'BO',
                generatedByUserId: actor?.id || null,
                idempotencyKey: `issued-pack:${policyId}:${riskTxn.id}`,
                correlationId: correlationId || undefined,
            });
            issuedPackJobId = docEvent.eventId;
        }
        if (externalDocumentEmail) {
            await appendDomainEvent(
                tx,
                buildDomainEvent({
                    eventType: 'EMAIL.EXTERNAL_ISSUANCE_DOCUMENTS_READY',
                    aggregateType: 'POLICY',
                    aggregateId: policyId,
                    aggregateVersion: Date.now(),
                    actorType: 'USER',
                    actorId: actor?.id || 'system',
                    reasonCode: 'EXTERNAL_ISSUANCE_COMPLETED',
                    correlationId: correlationId || undefined,
                    idempotencyKey: `external-issuance-documents:${policyId}:${riskTxn.id}`,
                    data: { policyId, documentIds: externalDocumentEmail.documentIds },
                }),
            );
        }
    });

    void AuditLogger.log(policyId, 'POLICY', 'POLICY.ISSUED', actor?.id || 'system', 'USER', { riskTransactionId: riskTxn.id, issuedPackJobId }, actor?.name || undefined);
    return {
        status: 'SUCCESS',
        data: {
            status: nextLifecycleStatus,
            riskTransactionId: riskTxn.id,
            ...(issuedPackJobId ? { issuedPackJobId } : {}),
        }
    };
}
