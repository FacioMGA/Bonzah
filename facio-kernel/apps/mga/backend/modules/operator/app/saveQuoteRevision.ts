/**
 * Operator MCP V2 — `operator.save_quote_revision` (ADR-0039).
 *
 * Snapshots the current quoteData/quoteResponse into PolicyQuoteHistory
 * via the canonical `saveQuoteVersion` service — identical write to the
 * BO Premium tab "Save version" action (`POST /quote-history/save`).
 *
 * `auditClass: 'mutate-staging'` — the snapshot is internal versioning;
 * it does not reach the customer. Customer-impacting commit is
 * `operator.send_revised_quote`.
 */
import type { Prisma } from '@prisma/client';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { saveQuoteVersion } from '../../policy/app/history/saveQuoteVersion.js';
import { loadPolicyOrError, requireMutatePermission } from './operatorMutateGuards.js';

export interface OperatorSaveQuoteRevisionInput {
    policyId: string;
}

export type OperatorSaveQuoteRevisionOutput = OperatorEnvelope<{
    version: number;
    history_id: string;
}>;

export async function operatorSaveQuoteRevision(
    input: OperatorSaveQuoteRevisionInput,
    ctx: McpContext,
): Promise<OperatorSaveQuoteRevisionOutput> {
    const gate = requireMutatePermission(ctx);
    if (!gate.ok) return gate.envelope;
    const policyGate = await loadPolicyOrError(input.policyId);
    if (!policyGate.ok) return policyGate.envelope;

    const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: input.policyId },
        select: { id: true, quoteData: true, quoteResponse: true, isLocked: true },
    });
    if (!policy) {
        return {
            ok: false,
            status: 'error',
            summary: 'Policy disappeared mid-call.',
            error: { code: 'NOT_FOUND', message: 'Policy not found.' },
        };
    }

    const saved = await runTenantScopedTransaction(async (_tx) => {
        const tx = _tx as unknown as Prisma.TransactionClient;
        return saveQuoteVersion(tx, {
            policyId: input.policyId,
            quoteData: policy.quoteData || {},
            quoteResponse: policy.quoteResponse || {},
            isLockedSnapshot: Boolean(policy.isLocked),
        });
    });

    await AuditLogger.log(
        input.policyId,
        'OPERATOR_ACTION',
        'OPERATOR.QUOTE_REVISION_SAVED',
        ctx.userId,
        'SYSTEM',
        {
            policyId: input.policyId,
            historyId: saved.id,
            version: saved.version,
            correlationId: gate.action.correlationId,
            source: 'operator-mcp-v2',
        },
        'Operator Agent',
    );

    const envelope: OperatorSuccessEnvelope<{ version: number; history_id: string }> = {
        ok: true,
        status: 'completed',
        action_id: gate.action.actionId,
        correlation_id: gate.action.correlationId,
        summary: `Saved quote revision v${saved.version}. Use operator.preview_quote_send to confirm before sending.`,
        entities: { policyId: input.policyId },
        next_actions: ['operator.preview_quote_send'],
        extra: { version: saved.version, history_id: saved.id },
    };
    return envelope;
}
