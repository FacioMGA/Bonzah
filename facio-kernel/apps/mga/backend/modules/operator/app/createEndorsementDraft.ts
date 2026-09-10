/**
 * Operator MCP V2 — `operator.create_endorsement_draft` (ADR-0039 §B3).
 *
 * Wraps the canonical `executeCreateEndorsementDraft` use case so the
 * agent can spin up a DRAFT RiskTransaction for address change or
 * named-driver change without bypassing the existing dedupe + lifecycle
 * + audit logic. The created draft is SUBMITTABLE-FOR-REVIEW via
 * `operator.submit_endorsement_for_review`; binding stays with the BO
 * endorsement flow (ADR-0039 §forbidden).
 *
 * `auditClass: 'mutate-staging'` — the draft is internal and reversible
 * (cancellable by BO). Customer impact happens only when the operator
 * calls `operator.send_endorsement_link` (separate tool,
 * customer-facing).
 *
 * No confirmation token because endorsement creation has the existing
 * canonical dedupe (a second call returns `deduped: true` instead of
 * creating a second draft).
 */
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { executeCreateEndorsementDraft } from '../../policy/app/CreateEndorsementDraft.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { loadPolicyOrError, requireMutatePermission } from './operatorMutateGuards.js';

export interface OperatorCreateEndorsementDraftInput {
    policyId: string;
    /** Free-text reason; surfaced verbatim to UW review. */
    reason: string;
    /**
     * Canonical reason code. V2 supports the two highest-volume codes
     * named in the spec (address + named driver). The BO endorsement
     * flow remains the single source of truth for the full code list;
     * unsupported codes are rejected up-front.
     */
    reasonCode: 'ADDRESS_CHANGE' | 'NAMED_DRIVER_CHANGE';
    /** ISO date the endorsement should become effective. */
    effectiveDate: string;
}

export type OperatorCreateEndorsementDraftOutput = OperatorEnvelope<{
    risk_transaction_id: string;
    transaction_number: number;
    deduped: boolean;
    next_actions: string[];
}>;

export async function operatorCreateEndorsementDraft(
    input: OperatorCreateEndorsementDraftInput,
    ctx: McpContext,
): Promise<OperatorCreateEndorsementDraftOutput> {
    const gate = requireMutatePermission(ctx);
    if (!gate.ok) return gate.envelope;
    const policyGate = await loadPolicyOrError(input.policyId);
    if (!policyGate.ok) return policyGate.envelope;

    const effective = new Date(input.effectiveDate);
    if (Number.isNaN(effective.valueOf())) {
        return {
            ok: false,
            status: 'error',
            summary: 'effectiveDate is not a valid ISO date.',
            error: { code: 'VALIDATION_ERROR', message: 'effectiveDate must be an ISO date string.' },
        };
    }

    const result = await executeCreateEndorsementDraft({
        policyId: input.policyId,
        effectiveDate: effective,
        reason: input.reason || null,
        reasonCode: input.reasonCode,
        actor: {
            id: ctx.userId,
            name: 'Operator Agent',
            email: null,
            role: 'OPERATOR_AGENT',
        },
        transactionType: 'ENDORSEMENT',
    });

    if (result.status === 'NOT_FOUND') {
        return {
            ok: false,
            status: 'error',
            summary: `Policy "${input.policyId}" not found.`,
            error: { code: 'NOT_FOUND', message: 'Policy not found.' },
        };
    }
    if (result.status === 'INVALID_STATUS') {
        const err = result.error as { code?: string; message?: string } | null;
        return {
            ok: false,
            status: 'error',
            summary: 'Endorsement requires an issued policy.',
            error: {
                code: err?.code || 'INVALID_STATUS',
                message: err?.message || 'Policy is not in an issued status.',
            },
        };
    }
    if (result.status !== 'SUCCESS') {
        return {
            ok: false,
            status: 'error',
            summary: 'Endorsement draft creation failed.',
            error: { code: 'INTERNAL_ERROR', message: 'Unexpected error creating endorsement draft.' },
        };
    }

    await AuditLogger.log(
        input.policyId,
        'OPERATOR_ACTION',
        'OPERATOR.ENDORSEMENT_DRAFT_CREATED',
        ctx.userId,
        'SYSTEM',
        {
            policyId: input.policyId,
            riskTransactionId: result.data.riskTransactionId,
            transactionNumber: result.data.transactionNumber,
            reasonCode: input.reasonCode,
            deduped: Boolean(result.data.deduped),
            effectiveDate: effective.toISOString(),
            correlationId: gate.action.correlationId,
            source: 'operator-mcp-v2',
        },
        'Operator Agent',
    );

    const envelope: OperatorSuccessEnvelope<{
        risk_transaction_id: string;
        transaction_number: number;
        deduped: boolean;
        next_actions: string[];
    }> = {
        ok: true,
        status: 'completed',
        action_id: gate.action.actionId,
        correlation_id: gate.action.correlationId,
        summary: result.data.deduped
            ? `Reused existing DRAFT endorsement #${result.data.transactionNumber}.`
            : `Created DRAFT endorsement #${result.data.transactionNumber} (${input.reasonCode}). Use operator.send_endorsement_link to email the customer.`,
        entities: { policyId: input.policyId, riskTransactionId: result.data.riskTransactionId },
        next_actions: [
            'operator.send_endorsement_link',
            'operator.submit_endorsement_for_review',
        ],
        extra: {
            risk_transaction_id: result.data.riskTransactionId,
            transaction_number: result.data.transactionNumber,
            deduped: Boolean(result.data.deduped),
            next_actions: ['operator.send_endorsement_link'],
        },
    };
    return envelope;
}
