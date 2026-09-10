/**
 * Explicit legacy repair for BO-origin draft authority gaps (ADR-0088).
 *
 * This is deliberately an operator preview → confirmation action, not a
 * migration, worker, or creation fallback. It reuses the canonical authority
 * resolver and refuses to invent a product or configuration.
 */
import type { Prisma } from '@prisma/client';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import type {
    OperatorEnvelope,
    OperatorErrorEnvelope,
    OperatorPreviewEnvelope,
    OperatorSuccessEnvelope,
} from '../domain/operatorEnvelope.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import { jsonStringify } from '../../policy/app/shared.js';
import { findLatestActiveBinderLinkForProduct } from '../../policy/app/binders/binderAuthority.js';
import {
    consumeConfirmationToken,
    hashPreviewInput,
    issueConfirmationToken,
} from '../../mcp/infra/confirmationTokenStore.js';
import { requireMutatePermission } from './operatorMutateGuards.js';

const PREVIEW_TTL_SECONDS = 600;
const TOOL_NAME = 'operator.reconcile_bo_draft_authority';

export interface OperatorReconcileBoDraftAuthorityInput {
    confirmation_token?: string;
}

type Candidate = {
    id: string;
    policyNumber: string;
    status: string;
    productType: string | null;
    programId: string | null;
    binderId: string | null;
    inceptionDate: Date;
    quoteData: unknown;
    updatedAt: Date;
    stateCurrent: { snapshot: unknown; updatedAt: Date } | null;
};

type Resolution = { programId: string; binderId: string };
type SkipReason =
    | 'NOT_BO_ORIGIN'
    | 'MISSING_PRODUCT'
    | 'NO_MISSING_AUTHORITY'
    | 'MISSING_SNAPSHOT'
    | 'NO_ACTIVE_BINDER_LINK'
    | 'EXISTING_AUTHORITY_CONFLICT'
    | 'SNAPSHOT_AUTHORITY_CONFLICT'
    | 'CONCURRENT_MODIFICATION';

type Evaluation =
    | { candidate: Candidate; safe: true; resolution: Resolution }
    | { candidate: Candidate; safe: false; reason: SkipReason };

type SkipCounts = Partial<{ [Reason in SkipReason]: number }>;

export interface ReconciliationCounts {
    [field: string]: number | SkipCounts;
    affected_count: number;
    safe_to_backfill_count: number;
    skipped_count: number;
    skipped_by_reason: SkipCounts;
}

export type OperatorReconcileBoDraftAuthorityOutput = OperatorEnvelope<ReconciliationCounts>;

function isMissing(value: unknown): value is null | undefined {
    return value === null || value === undefined;
}

function isBoOrigin(candidate: Candidate): boolean {
    const stateSnapshot = parseRecord(candidate.stateCurrent?.snapshot);
    const stateQuoteData = parseRecord(stateSnapshot.quoteData);
    const policyQuoteData = parseRecord(candidate.quoteData);
    return (
        String(parseRecord(stateQuoteData.__meta).origin || '').trim().toLowerCase() === 'bo' ||
        String(parseRecord(policyQuoteData.__meta).origin || '').trim().toLowerCase() === 'bo'
    );
}

function isCanonicalMirror(value: unknown, expected: string): boolean {
    return isMissing(value) || value === expected;
}

async function evaluateCandidate(candidate: Candidate, db?: Prisma.TransactionClient): Promise<Evaluation> {
    if (!isBoOrigin(candidate)) return { candidate, safe: false, reason: 'NOT_BO_ORIGIN' };
    if (!candidate.productType) return { candidate, safe: false, reason: 'MISSING_PRODUCT' };
    if (!isMissing(candidate.programId) && !isMissing(candidate.binderId)) {
        return { candidate, safe: false, reason: 'NO_MISSING_AUTHORITY' };
    }
    if (!candidate.stateCurrent) return { candidate, safe: false, reason: 'MISSING_SNAPSHOT' };

    const link = await findLatestActiveBinderLinkForProduct({
        productCode: candidate.productType,
        inceptionDate: candidate.inceptionDate,
        ...(db ? { db } : {}),
    });
    if (!link) return { candidate, safe: false, reason: 'NO_ACTIVE_BINDER_LINK' };

    const resolution: Resolution = { programId: link.programId, binderId: link.binderId };
    if (
        (!isMissing(candidate.programId) && candidate.programId !== resolution.programId) ||
        (!isMissing(candidate.binderId) && candidate.binderId !== resolution.binderId)
    ) {
        return { candidate, safe: false, reason: 'EXISTING_AUTHORITY_CONFLICT' };
    }

    const snapshot = parseRecord(candidate.stateCurrent.snapshot);
    if (
        !isCanonicalMirror(snapshot.productType, candidate.productType) ||
        !isCanonicalMirror(snapshot.programId, resolution.programId) ||
        !isCanonicalMirror(snapshot.binderId, resolution.binderId)
    ) {
        return { candidate, safe: false, reason: 'SNAPSHOT_AUTHORITY_CONFLICT' };
    }
    return { candidate, safe: true, resolution };
}

async function listAffectedCandidates(): Promise<Candidate[]> {
    return tenantScopedPrisma.policy.findMany({
        where: {
            status: 'DRAFT',
            productType: { not: null },
            OR: [{ programId: null }, { binderId: null }],
        },
        select: {
            id: true,
            policyNumber: true,
            status: true,
            productType: true,
            programId: true,
            binderId: true,
            inceptionDate: true,
            quoteData: true,
            updatedAt: true,
            stateCurrent: { select: { snapshot: true, updatedAt: true } },
        },
        orderBy: { createdAt: 'asc' },
    });
}

function countsFrom(evaluations: Evaluation[]): ReconciliationCounts {
    const skippedByReason: SkipCounts = {};
    for (const evaluation of evaluations) {
        if (!evaluation.safe) skippedByReason[evaluation.reason] = (skippedByReason[evaluation.reason] ?? 0) + 1;
    }
    const safeToBackfillCount = evaluations.filter((evaluation) => evaluation.safe).length;
    return {
        affected_count: evaluations.length,
        safe_to_backfill_count: safeToBackfillCount,
        skipped_count: evaluations.length - safeToBackfillCount,
        skipped_by_reason: skippedByReason,
    };
}

async function previewReconciliation(): Promise<{ evaluations: Evaluation[]; counts: ReconciliationCounts }> {
    const candidates = await listAffectedCandidates();
    const boCandidates = candidates.filter(
        (candidate) => isBoOrigin(candidate) && String(candidate.productType || '').trim().length > 0,
    );
    const evaluations: Evaluation[] = [];
    for (const candidate of boCandidates) evaluations.push(await evaluateCandidate(candidate));
    return { evaluations, counts: countsFrom(evaluations) };
}

function tokenInvalidEnvelope(): OperatorErrorEnvelope {
    return {
        ok: false,
        status: 'error',
        summary: 'Confirmation token is invalid or expired. Run the preview again before applying this repair.',
        error: {
            code: 'CONFIRMATION_TOKEN_INVALID',
            message: 'Tokens are single-use, expire after 10 minutes, and are bound to the issuing actor and tenant.',
            suggested_fix: 'Call operator.reconcile_bo_draft_authority without confirmation_token to obtain a fresh preview.',
        },
    };
}

class ConcurrentModificationError extends Error {}

async function applyCandidate(policyId: string): Promise<{ applied: boolean; reason?: SkipReason }> {
    try {
        return await tenantScopedPrisma.$transaction(async (_tx) => {
            const tx = _tx as Prisma.TransactionClient;
            const candidate = await tx.policy.findUnique({
                where: { id: policyId },
                select: {
                    id: true,
                    policyNumber: true,
                    status: true,
                    productType: true,
                    programId: true,
                    binderId: true,
                    inceptionDate: true,
                    quoteData: true,
                    updatedAt: true,
                    stateCurrent: { select: { snapshot: true, updatedAt: true } },
                },
            });
            if (!candidate || String(candidate.status).toUpperCase() !== 'DRAFT') {
                return { applied: false, reason: 'CONCURRENT_MODIFICATION' as const };
            }

            const evaluation = await evaluateCandidate(candidate, tx);
            if (!evaluation.safe) return { applied: false, reason: evaluation.reason };

            const { candidate: row, resolution } = evaluation;
            const policyData = {
                ...(isMissing(row.programId) ? { programId: resolution.programId } : {}),
                ...(isMissing(row.binderId) ? { binderId: resolution.binderId } : {}),
            };
            const updatedPolicy = await tx.policy.updateMany({
                where: {
                    id: row.id,
                    status: 'DRAFT',
                    productType: row.productType,
                    programId: row.programId,
                    binderId: row.binderId,
                    updatedAt: row.updatedAt,
                },
                data: policyData,
            });
            if (updatedPolicy.count !== 1) throw new ConcurrentModificationError();

            const snapshot = parseRecord(row.stateCurrent!.snapshot);
            const nextSnapshot = {
                ...snapshot,
                ...(isMissing(snapshot.productType) ? { productType: row.productType } : {}),
                ...(isMissing(snapshot.programId) ? { programId: resolution.programId } : {}),
                ...(isMissing(snapshot.binderId) ? { binderId: resolution.binderId } : {}),
            };
            const updatedState = await tx.policyStateCurrent.updateMany({
                where: { policyId: row.id, updatedAt: row.stateCurrent!.updatedAt },
                data: { snapshot: jsonStringify(nextSnapshot) },
            });
            if (updatedState.count !== 1) throw new ConcurrentModificationError();
            return { applied: true };
        });
    } catch (error) {
        if (error instanceof ConcurrentModificationError) return { applied: false, reason: 'CONCURRENT_MODIFICATION' };
        throw error;
    }
}

function preparedPolicyIds(preview: unknown): string[] {
    const body = parseRecord(preview);
    if (body.kind !== 'bo_draft_authority_reconciliation') return [];
    const prepared = Array.isArray(body.safe_policy_ids) ? body.safe_policy_ids : [];
    return Array.from(new Set(prepared.filter((value): value is string => typeof value === 'string' && value.length > 0)));
}

export async function operatorReconcileBoDraftAuthority(
    input: OperatorReconcileBoDraftAuthorityInput,
    ctx: McpContext,
): Promise<OperatorReconcileBoDraftAuthorityOutput> {
    const gate = requireMutatePermission(ctx);
    if (!gate.ok) return gate.envelope;
    const tenantId = getTenantConfig().id;

    if (!input.confirmation_token) {
        const { evaluations, counts } = await previewReconciliation();
        const safePolicyIds = evaluations.filter((evaluation): evaluation is Extract<Evaluation, { safe: true }> => evaluation.safe)
            .map((evaluation) => evaluation.candidate.id);
        const preview = {
            kind: 'bo_draft_authority_reconciliation',
            tenantId,
            safe_policy_ids: safePolicyIds,
            counts,
        };
        const inputHash = hashPreviewInput({ actorId: ctx.userId, tenantId, preview });
        const issued = await issueConfirmationToken(
            {
                actorId: ctx.userId,
                toolName: TOOL_NAME,
                entityId: tenantId,
                inputHash,
                issuedAt: new Date().toISOString(),
                preview,
            },
            PREVIEW_TTL_SECONDS,
        );
        await AuditLogger.log(
            tenantId,
            'OPERATOR_ACTION',
            'OPERATOR.BO_DRAFT_AUTHORITY_BACKFILL_PREVIEWED',
            ctx.userId,
            'SYSTEM',
            { ...counts, correlationId: gate.action.correlationId, source: 'operator-mcp-v2' },
            'Operator Agent',
        );
        const envelope: OperatorPreviewEnvelope = {
            ok: true,
            status: 'preview',
            action_id: gate.action.actionId,
            correlation_id: gate.action.correlationId,
            summary: `Preview: ${counts.affected_count} affected BO draft(s); ${counts.safe_to_backfill_count} safe to backfill; ${counts.skipped_count} skipped. Confirm explicitly to apply only the safe rows.`,
            requires_confirmation: true,
            confirmation_token: issued.token,
            expires_at: issued.expiresAt,
            entities: { tenantId },
            diff: evaluations.filter((evaluation) => evaluation.safe).flatMap((evaluation) => [
                { field: `${evaluation.candidate.id}.programId`, from: evaluation.candidate.programId, to: evaluation.resolution.programId },
                { field: `${evaluation.candidate.id}.binderId`, from: evaluation.candidate.binderId, to: evaluation.resolution.binderId },
            ]),
            readiness_blockers: Object.entries(counts.skipped_by_reason).map(([code, count]) => ({
                code,
                message: `${count} draft(s) skipped: ${code}.`,
            })),
            preview_extra: {
                affected_count: counts.affected_count,
                safe_to_backfill_count: counts.safe_to_backfill_count,
                skipped_count: counts.skipped_count,
                skipped_by_reason: counts.skipped_by_reason,
                safe_policy_ids: safePolicyIds,
            },
        };
        return envelope;
    }

    const consumed = await consumeConfirmationToken(input.confirmation_token, {
        actorId: ctx.userId,
        toolName: TOOL_NAME,
        entityId: tenantId,
    });
    if (!consumed) return tokenInvalidEnvelope();
    const policyIds = preparedPolicyIds(consumed.preview);
    if (policyIds.length === 0) return tokenInvalidEnvelope();

    const outcomes: Array<{ applied: boolean; reason?: SkipReason }> = [];
    for (const policyId of policyIds) outcomes.push(await applyCandidate(policyId));
    const skippedByReason: SkipCounts = {};
    for (const outcome of outcomes) {
        if (!outcome.applied && outcome.reason) skippedByReason[outcome.reason] = (skippedByReason[outcome.reason] ?? 0) + 1;
    }
    const appliedCount = outcomes.filter((outcome) => outcome.applied).length;
    const counts: ReconciliationCounts = {
        affected_count: policyIds.length,
        safe_to_backfill_count: appliedCount,
        skipped_count: policyIds.length - appliedCount,
        skipped_by_reason: skippedByReason,
    };
    await AuditLogger.log(
        tenantId,
        'OPERATOR_ACTION',
        'OPERATOR.BO_DRAFT_AUTHORITY_BACKFILL_APPLIED',
        ctx.userId,
        'SYSTEM',
        { ...counts, confirmationTokenInputHash: consumed.inputHash, correlationId: gate.action.correlationId, source: 'operator-mcp-v2' },
        'Operator Agent',
    );
    const envelope: OperatorSuccessEnvelope<ReconciliationCounts> = {
        ok: true,
        status: 'completed',
        action_id: gate.action.actionId,
        correlation_id: gate.action.correlationId,
        summary: `Applied authority backfill to ${appliedCount} BO draft(s); ${counts.skipped_count} row(s) changed after preview and were skipped.`,
        entities: { tenantId },
        next_actions: ['operator.get_quote'],
        extra: counts,
    };
    return envelope;
}
