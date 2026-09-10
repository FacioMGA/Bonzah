/**
 * Operator MCP V2 — `operator.send_revised_quote` (ADR-0039).
 *
 * Consumes a `confirmation_token` issued by
 * `operator.preview_quote_send` (cross-actor/tool/entity-scoped,
 * 10-min TTL, single-use) and dispatches the customer email via the
 * canonical `sendRevisedQuoteUseCase` — same writes / audit / lifecycle
 * transition as the BO Premium "Send quote" button.
 *
 * `auditClass: 'mutate'` — customer-impacting commit. Token guard
 * pins the preview-then-confirm contract.
 *
 * The public-app base URL is resolved from the standard env override
 * because operator MCP requests don't carry an HTTP request context the
 * way BO clicks do. The customer link domain is the same one BO uses.
 */
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { sendRevisedQuoteUseCase } from '../../policy/app/quoteLifecycle/sendRevisedQuoteUseCase.js';
import { consumeConfirmationToken } from '../../mcp/infra/confirmationTokenStore.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { resolvePublicAppBaseUrlFromTenant } from '../../../platform/http/publicAppLinks.js';
import { loadPolicyOrError, requireMutatePermission } from './operatorMutateGuards.js';

export interface OperatorSendRevisedQuoteInput {
    policyId: string;
    /** Token returned by operator.preview_quote_send. Single-use, 10-min TTL. */
    confirmation_token: string;
}

export type OperatorSendRevisedQuoteOutput = OperatorEnvelope<{
    recipient: string;
    quote_link: string;
    message_id: string | null;
    lifecycle_recorded: boolean;
}>;

export async function operatorSendRevisedQuote(
    input: OperatorSendRevisedQuoteInput,
    ctx: McpContext,
): Promise<OperatorSendRevisedQuoteOutput> {
    const gate = requireMutatePermission(ctx);
    if (!gate.ok) return gate.envelope;
    const policyGate = await loadPolicyOrError(input.policyId);
    if (!policyGate.ok) return policyGate.envelope;

    // Consume the confirmation_token issued by the preview step.
    // Cross-actor / cross-tool / cross-entity redemption all reject
    // with a generic invalid envelope (we don't leak which check failed).
    const consumed = await consumeConfirmationToken(input.confirmation_token, {
        actorId: ctx.userId,
        toolName: 'operator.send_revised_quote',
        entityId: input.policyId,
    });
    if (!consumed) {
        return {
            ok: false,
            status: 'error',
            summary: 'Confirmation token is invalid or expired. Re-run operator.preview_quote_send.',
            error: {
                code: 'CONFIRMATION_TOKEN_INVALID',
                message:
                    'Token rejected. Tokens are single-use, expire after 10 minutes, and are bound to the issuing actor + policy.',
                suggested_fix: 'Call operator.preview_quote_send first and pass the new token here.',
            },
        };
    }

    const publicAppBaseUrl = resolvePublicAppBaseUrlFromTenant();
    const result = await sendRevisedQuoteUseCase({
        policyId: input.policyId,
        actor: { id: ctx.userId, role: 'OPERATOR_AGENT', name: 'Operator Agent' },
        correlationId: gate.action.correlationId,
        publicAppBaseUrl,
    });
    if (!result.ok) {
        return {
            ok: false,
            status: 'error',
            summary: result.message,
            error: { code: result.code, message: result.message },
        };
    }

    await AuditLogger.log(
        input.policyId,
        'OPERATOR_ACTION',
        'OPERATOR.QUOTE_REVISION_SENT',
        ctx.userId,
        'SYSTEM',
        {
            policyId: input.policyId,
            recipient: result.recipient,
            messageId: result.messageId,
            confirmationTokenInputHash: consumed.inputHash,
            correlationId: gate.action.correlationId,
            source: 'operator-mcp-v2',
        },
        'Operator Agent',
    );

    const envelope: OperatorSuccessEnvelope<{
        recipient: string;
        quote_link: string;
        message_id: string | null;
        lifecycle_recorded: boolean;
    }> = {
        ok: true,
        status: 'completed',
        action_id: gate.action.actionId,
        correlation_id: gate.action.correlationId,
        summary: `Sent revised quote to ${result.recipient}.`,
        entities: { policyId: input.policyId },
        next_actions: ['operator.get_quote'],
        extra: {
            recipient: result.recipient,
            quote_link: result.url,
            message_id: result.messageId,
            lifecycle_recorded: result.lifecycleRecorded,
        },
    };
    return envelope;
}
