/**
 * Operator MCP V2 — `operator.fork_quote_workspace` (ADR-0039).
 *
 * Archives the current quoteData/quoteResponse into PolicyQuoteHistory
 * and unlocks the policy for editing — the same write `POST
 * /api/policies/:id/quote-history/archive` does. After this call the
 * agent can patch via `operator.update_quote_terms`, re-rate, and
 * preview a fresh revision to send.
 *
 * `auditClass: 'mutate-staging'` because the action is reversible: the
 * archived version is restorable via the existing
 * `quote-history/:historyId/restore` route, and the operator's next
 * step is bounded inside the workspace until they hit
 * `operator.send_revised_quote` (which carries the customer-impacting
 * confirmation_token gate).
 */
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { forkQuoteWorkspace } from '../../policy/app/quoteLifecycle/forkQuoteWorkspace.js';
import { loadPolicyOrError, requireMutatePermission } from './operatorMutateGuards.js';

export interface OperatorForkQuoteWorkspaceInput {
    policyId: string;
}

export type OperatorForkQuoteWorkspaceOutput = OperatorEnvelope<{
    archived_version: number;
    next_actions: string[];
}>;

export async function operatorForkQuoteWorkspace(
    input: OperatorForkQuoteWorkspaceInput,
    ctx: McpContext,
): Promise<OperatorForkQuoteWorkspaceOutput> {
    const gate = requireMutatePermission(ctx);
    if (!gate.ok) return gate.envelope;
    const policyGate = await loadPolicyOrError(input.policyId);
    if (!policyGate.ok) return policyGate.envelope;

    const result = await forkQuoteWorkspace({
        policyId: input.policyId,
        actor: {
            id: ctx.userId,
            role: 'OPERATOR_AGENT',
            name: 'Operator Agent',
        },
        correlationId: gate.action.correlationId,
    });

    const envelope: OperatorSuccessEnvelope<{
        archived_version: number;
        next_actions: string[];
    }> = {
        ok: true,
        status: 'completed',
        action_id: gate.action.actionId,
        correlation_id: gate.action.correlationId,
        summary: `Archived quoteData as version ${result.archivedVersion}; policy unlocked for editing.`,
        entities: { policyId: input.policyId },
        next_actions: [
            'operator.update_quote_terms',
            'operator.rate_quote',
            'operator.preview_quote_send',
        ],
        extra: {
            archived_version: result.archivedVersion,
            next_actions: ['operator.update_quote_terms'],
        },
    };
    return envelope;
}
