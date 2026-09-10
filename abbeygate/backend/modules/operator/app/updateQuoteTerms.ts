/**
 * Operator MCP V2 — `operator.update_quote_terms` (ADR-0039).
 *
 * Applies a free-form quote-data patch via the canonical
 * `applyQuotePatchUseCase` (the new backend caller of
 * `validateForContext({ actor: 'underwriter' })`). Returns either a
 * validation-error envelope (no writes) or a success envelope with the
 * applied diff.
 *
 * `auditClass: 'mutate-staging'` because the patch lives only on the
 * working quoteData until `operator.send_revised_quote` (the
 * customer-visible commit, which carries the `confirmation_token` gate).
 */
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { applyQuotePatchUseCase } from '../../policy/app/quoteLifecycle/applyQuotePatchUseCase.js';
import { loadPolicyOrError, requireMutatePermission } from './operatorMutateGuards.js';

export interface OperatorUpdateQuoteTermsInput {
    policyId: string;
    /** Free-form subset of QuoteData. Deep-merged + validated. */
    patch: Record<string, unknown>;
}

export type OperatorUpdateQuoteTermsOutput = OperatorEnvelope<{
    changed_fields: Array<{ field: string; from: unknown; to: unknown }>;
    next_actions: string[];
    validation_errors?: Array<{ field: string; message: string; code?: string }>;
}>;

export async function operatorUpdateQuoteTerms(
    input: OperatorUpdateQuoteTermsInput,
    ctx: McpContext,
): Promise<OperatorUpdateQuoteTermsOutput> {
    const gate = requireMutatePermission(ctx);
    if (!gate.ok) return gate.envelope;
    const policyGate = await loadPolicyOrError(input.policyId);
    if (!policyGate.ok) return policyGate.envelope;
    if (!input.patch || typeof input.patch !== 'object') {
        return {
            ok: false,
            status: 'error',
            summary: 'patch must be an object.',
            error: { code: 'VALIDATION_ERROR', message: 'patch must be a non-null object.' },
        };
    }

    const result = await applyQuotePatchUseCase({
        policyId: input.policyId,
        patch: input.patch,
        actor: { id: ctx.userId, role: 'OPERATOR_AGENT', name: 'Operator Agent' },
        correlationId: gate.action.correlationId,
    });

    if (!result.ok) {
        if (result.code === 'VALIDATION_ERROR' && result.validationErrors) {
            const list = result.validationErrors.slice(0, 8)
                .map((v) => `${v.field}: ${v.message}`)
                .join('; ');
            return {
                ok: false,
                status: 'error',
                summary: `Patch rejected: ${result.validationErrors.length} validation error(s).`,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: list,
                    suggested_fix:
                        'Inspect each field-level message, correct the patch, and re-call operator.update_quote_terms.',
                },
            };
        }
        return {
            ok: false,
            status: 'error',
            summary: result.message,
            error: { code: result.code, message: result.message },
        };
    }

    const envelope: OperatorSuccessEnvelope<{
        changed_fields: Array<{ field: string; from: unknown; to: unknown }>;
        next_actions: string[];
    }> = {
        ok: true,
        status: 'completed',
        action_id: gate.action.actionId,
        correlation_id: gate.action.correlationId,
        summary:
            result.changedFields.length === 0
                ? 'No-op patch — quoteData unchanged.'
                : `Patched ${result.changedFields.length} field(s) on quote ${input.policyId}. Re-rate before previewing.`,
        entities: { policyId: input.policyId },
        next_actions: ['operator.rate_quote', 'operator.preview_quote_send'],
        extra: {
            changed_fields: result.changedFields,
            next_actions: ['operator.rate_quote'],
        },
    };
    return envelope;
}
