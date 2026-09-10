/**
 * Operator MCP V2 — `operator.submit_endorsement_for_review`
 * (ADR-0039 §B3).
 *
 * Transitions a DRAFT endorsement RiskTransaction to REFERRED so the
 * BO underwriter can review and bind it. Uses the canonical
 * `transitionRiskTransactionStatus` writer — same domain event,
 * same projection refresh, same audit shape as the BO endorsement
 * flow. V2 explicitly does NOT auto-bind (ADR-0039 §forbidden).
 *
 * `auditClass: 'mutate'` because the REFERRED status means the
 * endorsement enters the underwriter's queue — that's the
 * customer-impacting commit point. Wraps with a confirmation_token
 * gate so the agent must explicitly confirm submission.
 */
import type { Prisma } from '@prisma/client';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { transitionRiskTransactionStatus } from '../../policy/app/commands/riskPaymentDocCommands.js';
import {
    consumeConfirmationToken,
    issueConfirmationToken,
    hashPreviewInput,
} from '../../mcp/infra/confirmationTokenStore.js';
import { loadPolicyOrError, requireMutatePermission } from './operatorMutateGuards.js';

const PREVIEW_TTL_SECONDS = 600;

export interface OperatorSubmitEndorsementForReviewInput {
    policyId: string;
    riskTransactionId: string;
    /**
     * Optional. When omitted, the tool returns an OperatorPreviewEnvelope
     * with a fresh confirmation_token (preview step). When supplied, the
     * tool consumes the token and performs the transition (commit step).
     */
    confirmation_token?: string;
}

export type OperatorSubmitEndorsementForReviewOutput = OperatorEnvelope<{
    risk_transaction_id: string;
    transaction_number: number;
    transitioned_to: 'REFERRED';
}> & { confirmation_token?: string; expires_at?: string };

export async function operatorSubmitEndorsementForReview(
    input: OperatorSubmitEndorsementForReviewInput,
    ctx: McpContext,
): Promise<OperatorSubmitEndorsementForReviewOutput> {
    const gate = requireMutatePermission(ctx);
    if (!gate.ok) return gate.envelope as OperatorSubmitEndorsementForReviewOutput;
    const policyGate = await loadPolicyOrError(input.policyId);
    if (!policyGate.ok) return policyGate.envelope as OperatorSubmitEndorsementForReviewOutput;

    const rt = await tenantScopedPrisma.riskTransaction.findUnique({
        where: { id: input.riskTransactionId },
        select: { id: true, policyId: true, status: true, transactionNumber: true },
    });
    if (!rt || rt.policyId !== input.policyId) {
        return {
            ok: false,
            status: 'error',
            summary: `Endorsement "${input.riskTransactionId}" not found on policy ${input.policyId}.`,
            error: { code: 'NOT_FOUND', message: 'Endorsement not found.' },
        };
    }
    if (String(rt.status || '').toUpperCase() !== 'DRAFT') {
        return {
            ok: false,
            status: 'error',
            summary: `Endorsement #${rt.transactionNumber} is not DRAFT (status: ${rt.status}).`,
            error: {
                code: 'INVALID_STATUS',
                message: 'Only DRAFT endorsements can be submitted for review.',
            },
        };
    }

    // Preview step: no token supplied → issue one and return preview.
    if (!input.confirmation_token) {
        const previewBody = {
            riskTransactionId: rt.id,
            transactionNumber: rt.transactionNumber,
            transitionTo: 'REFERRED' as const,
        };
        const inputHash = hashPreviewInput({ ...previewBody, actorId: ctx.userId });
        const issued = await issueConfirmationToken(
            {
                actorId: ctx.userId,
                toolName: 'operator.submit_endorsement_for_review',
                entityId: rt.id,
                inputHash,
                issuedAt: new Date().toISOString(),
                preview: previewBody,
            },
            PREVIEW_TTL_SECONDS,
        );
        await AuditLogger.log(
            input.policyId,
            'OPERATOR_ACTION',
            'OPERATOR.QUOTE_PREVIEW_GENERATED',
            ctx.userId,
            'SYSTEM',
            {
                policyId: input.policyId,
                riskTransactionId: rt.id,
                previewTool: 'operator.submit_endorsement_for_review',
                inputHash,
                correlationId: gate.action.correlationId,
                source: 'operator-mcp-v2',
            },
            'Operator Agent',
        );
        return {
            ok: false, // Status is "preview" not "completed" — the commit hasn't happened
            status: 'error',
            summary: `Preview: endorsement #${rt.transactionNumber} will transition DRAFT → REFERRED. Pass the confirmation_token to commit.`,
            error: {
                code: 'CONFIRMATION_REQUIRED',
                message: `Submit again with confirmation_token=${issued.token} within 10 minutes to commit.`,
                suggested_fix:
                    'Re-call operator.submit_endorsement_for_review with the same policyId/riskTransactionId and the returned confirmation_token.',
            },
            confirmation_token: issued.token,
            expires_at: issued.expiresAt,
        };
    }

    // Commit step: token supplied → consume + transition.
    const consumed = await consumeConfirmationToken(input.confirmation_token, {
        actorId: ctx.userId,
        toolName: 'operator.submit_endorsement_for_review',
        entityId: rt.id,
    });
    if (!consumed) {
        return {
            ok: false,
            status: 'error',
            summary: 'Confirmation token is invalid or expired. Re-run without the token to get a new one.',
            error: {
                code: 'CONFIRMATION_TOKEN_INVALID',
                message:
                    'Token rejected. Tokens are single-use, expire after 10 minutes, and are bound to the issuing actor + endorsement.',
                suggested_fix:
                    'Call operator.submit_endorsement_for_review without confirmation_token to get a fresh one.',
            },
        };
    }

    await tenantScopedPrisma.$transaction(async (_tx) => {
        const tx = _tx as unknown as Prisma.TransactionClient;
        await transitionRiskTransactionStatus({
            tx,
            riskTransactionId: rt.id,
            to: 'REFERRED',
            actorId: ctx.userId,
            actorType: 'SYSTEM',
            reasonCode: 'OPERATOR_MCP_SUBMITTED_FOR_REVIEW',
            correlationId: gate.action.correlationId,
        });
    });

    await AuditLogger.log(
        input.policyId,
        'OPERATOR_ACTION',
        'OPERATOR.ENDORSEMENT_SUBMITTED_FOR_REVIEW',
        ctx.userId,
        'SYSTEM',
        {
            policyId: input.policyId,
            riskTransactionId: rt.id,
            transactionNumber: rt.transactionNumber,
            from: 'DRAFT',
            to: 'REFERRED',
            confirmationTokenInputHash: consumed.inputHash,
            correlationId: gate.action.correlationId,
            source: 'operator-mcp-v2',
        },
        'Operator Agent',
    );

    const envelope: OperatorSuccessEnvelope<{
        risk_transaction_id: string;
        transaction_number: number;
        transitioned_to: 'REFERRED';
    }> = {
        ok: true,
        status: 'completed',
        action_id: gate.action.actionId,
        correlation_id: gate.action.correlationId,
        summary: `Submitted endorsement #${rt.transactionNumber} for UW review.`,
        entities: { policyId: input.policyId, riskTransactionId: rt.id },
        next_actions: ['operator.get_policy'],
        extra: {
            risk_transaction_id: rt.id,
            transaction_number: rt.transactionNumber,
            transitioned_to: 'REFERRED',
        },
    };
    return envelope;
}
