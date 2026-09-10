import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { evaluateIssueReadiness } from '../../policy/app/issueReadiness.js';
import { isIssuedLifecycleStatus, jsonStringify } from '../../policy/app/shared.js';
import { transitionPolicyLifecycle } from './commands/policyLifecycleCommands.js';
import { enqueuePolicyListIndexUpdate } from '../infra/projections/policyListIndex.js';
import { derivePremiumFinancials } from '../domain/premiumFinancials.js';

import {
    parseSnapshot,
    parseRecord,
    quotePrimaryAnnualPremium,
    quoteCurrency
} from '../../../platform/utils/mappingHelpers.js';
import { getSanctionsService, resolveIndividualScreeningSubject, SanctionsBlockError } from '../../compliance/app/index.js';

function jsonParse(str: string | null | undefined): unknown {
    if (!str) return {};
    try { return JSON.parse(str); } catch { return {}; }
}

function parseSnapshotValue(value: unknown): Record<string, unknown> {
    if (!value) return {};
    if (typeof value === 'string') {
        const parsed = jsonParse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export interface BindCoverageActor {
    id: string | null;
    name: string | null;
    email: string | null;
    role: string | null;
}

export interface BindCoverageInput {
    policyId: string;
    actor: BindCoverageActor;
    correlationId?: string;
}

export type UseCaseResult<T> =
    | { status: 'SUCCESS'; data: T }
    | { status: 'NOT_FOUND' | 'INVALID_STATUS' | 'BLOCKED' | 'SERVER_ERROR' | 'UNAUTHORIZED'; error: unknown };

export async function executeBindCoverage(input: BindCoverageInput): Promise<UseCaseResult<{ status: string; riskTransactionId: string }>> {
    const { policyId, actor, correlationId } = input;

    const readiness = await evaluateIssueReadiness(policyId, 'bo', { riskTransactionId: null });
    if (!readiness?.canIssue) {
        return {
            status: 'BLOCKED',
            error: { code: 'BLOCKED', message: 'Cannot bind coverage while blockers exist', details: readiness },
        };
    }

    const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: policyId },
        include: { stateCurrent: true, policyHolder: { select: { name: true } }, binder: true },
    });
    if (!policy) return { status: 'NOT_FOUND', error: { code: 'NOT_FOUND', message: 'Policy not found' } };

    if (isIssuedLifecycleStatus(String(policy.status || ''))) {
        return {
            status: 'INVALID_STATUS',
            error: { code: 'INVALID_STATUS', message: `Cannot bind original policy after issuance (status '${policy.status}')` },
        };
    }

    const prevSnap = policy.stateCurrent ? parseSnapshot(parseSnapshotValue(policy.stateCurrent.snapshot)) : {};
    const prevSnapRecord = parseRecord(prevSnap);
    const quoteResponse = prevSnapRecord.quoteResponse || policy.quoteResponse || {};
    const quoteData = prevSnapRecord.quoteData || policy.quoteData || {};
    const finalizedSnapshot = {
        ...prevSnap,
        quoteData,
        quoteResponse,
        binding: {
            ...parseRecord(prevSnapRecord.binding),
            boundCoverageAt: new Date().toISOString(),
            boundCoverageBy: {
                id: actor?.id || null,
                name: actor?.name || null,
                email: actor?.email || null,
                role: actor?.role || null,
            },
        },
    };

    const screeningSubject = resolveIndividualScreeningSubject({
        policyHolderName: policy.policyHolder?.name || null,
        quoteData,
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
            actionType: 'POLICY_BIND_COVERAGE',
            policyId,
            subjectName: screeningSubject.subjectName,
            dateOfBirth: screeningSubject.dateOfBirth,
            correlationId: correlationId || `bind-coverage:${policyId}`,
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
                message: 'Sanctions screening is unavailable. Binding is blocked until screening succeeds.',
            }
        };
    }
    const premiumGuess = quotePrimaryAnnualPremium(quoteResponse);
    const currency = quoteCurrency(quoteResponse, 'EUR');

    const created = await tenantScopedPrisma.$transaction(async (_tx) => {
      const tx = _tx as unknown as Prisma.TransactionClient;
        await tx.policyStateCurrent.upsert({
            where: { policyId },
            update: { snapshot: jsonStringify(finalizedSnapshot) },
            create: { policyId, snapshot: jsonStringify(finalizedSnapshot) } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
        });

        await transitionPolicyLifecycle({
            tx,
            policyId,
            to: 'BOUND',
            actorId: actor?.id || 'system',
            actorType: 'USER',
            reasonCode: 'BIND_COVERAGE',
            correlationId: correlationId || '',
        });

        await tx.policy.update({
            where: { id: policyId },
            data: { isLocked: true },
        });
        await tx.policySearchIndex.update({ where: { policyId }, data: { status: 'BOUND' } }).catch(() => undefined);
        await enqueuePolicyListIndexUpdate(tx, policyId);

        const lastRiskTxn = await tx.riskTransaction.findFirst({
            where: { policyId },
            orderBy: { transactionNumber: 'desc' },
            select: { transactionNumber: true },
        });
        const nextTxnNumber = (lastRiskTxn?.transactionNumber || 0) + 1;

        const riskTxn = await tx.riskTransaction.create({
            data: {
                policyId,
                programId: policy.programId || null,
                binderId: policy.binderId || null,
                transactionNumber: nextTxnNumber,
                transactionType: 'INCEPTION',
                status: 'BOUND',
                effectiveDate: policy.inceptionDate || new Date(),
                expiryDate: policy.expiryDate || null,
                createdBy: actor?.id || 'system',
                snapshotFinal: jsonStringify(finalizedSnapshot),
                pricingFinal: jsonStringify({ premium: premiumGuess, currency, quoteResponse, quoteData }),
            } as unknown as Prisma.RiskTransactionUncheckedCreateInput,
        });

        const binderFinancials = policy.binderId
            ? await tx.binderFinancials.findUnique({ where: { binderId: policy.binderId } })
            : null;
        const premiumFinancials = derivePremiumFinancials({
            grossPremium: premiumGuess,
            quoteResponse,
            binder: policy.binder,
            binderFinancials,
            riskTransactionType: policy.priorTermPolicyId ? 'RNL' : 'NB',
            premiumTransactionType: 'ORIGINAL',
        });
        await tx.premiumTransaction.create({
            data: {
                riskTransactionId: riskTxn.id,
                transactionType: 'ORIGINAL',
                currency,
                grossPremium: premiumFinancials.grossPremium,
                commissionPercent: premiumFinancials.commissionPercent,
                commissionAmount: premiumFinancials.commissionAmount,
                taxesTotal: premiumFinancials.taxesTotal,
                feesTotal: premiumFinancials.feesTotal,
                netToLondon: premiumFinancials.netToLondon,
            },
        });

        return riskTxn;
    });

    void AuditLogger.log(policyId, 'POLICY', 'POLICY.UPDATED', actor?.id || 'system', 'USER', { action: 'BIND_COVERAGE', riskTransactionId: created.id }, actor?.name || undefined);

    return { status: 'SUCCESS', data: { status: 'BOUND', riskTransactionId: created.id } };
}
