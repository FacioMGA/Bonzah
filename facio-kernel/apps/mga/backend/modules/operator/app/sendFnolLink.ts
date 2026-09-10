import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import { logger } from '../../../platform/utils/logger.js';
import { sendFnolLinkForClaim } from '../../claims/app/claimsFnolLinkService.js';
import { getPolicyById } from '../infra/adapters/policyListAdapter.js';
import { createPolicyLinkedClaim } from '../infra/delegators/claimDelegate.js';

const FNOL_ELIGIBLE_STATUSES = new Set(['ACTIVE', 'ISSUED']);

export interface SendFnolLinkInput {
    policyId: string;
    /** Optional override of the recipient email; defaults to the policyholder's registered contact. */
    requestedEmail?: string;
    /** Optional explicit incident date; defaults to now. */
    incidentDate?: string;
}

export type SendFnolLinkOutput = OperatorEnvelope<{
    policy_id: string;
    policy_number: string;
    claim_id: string;
    claim_number: string;
    fnol_link: string;
    email_to: string;
}>;

/**
 * B2 flow (spec §3.B.2): create a policy-linked Claim and email the
 * customer a secure expiring FNOL link.
 *
 * Pipeline:
 *   1. Verify policy is ACTIVE / ISSUED.
 *   2. Create a PENDING Claim row bound to the policy (delegator).
 *   3. Call canonical `sendFnolLinkForClaim` (14-day JWT + email).
 *
 * No FNOL link is created for policies in CANCELLED / LAPSED status —
 * the spec is explicit that "no active policy found" must surface as
 * an error rather than create a dangling claim.
 */
export async function sendFnolLink(
    input: SendFnolLinkInput,
    ctx: McpContext,
): Promise<SendFnolLinkOutput> {
    const action = buildOperatorActionContext(ctx);
    const row = await getPolicyById(input.policyId);
    if (!row) {
        return {
            ok: false,
            status: 'error',
            summary: `No policy with id "${input.policyId}".`,
            error: { code: 'NOT_FOUND', message: 'Policy not found in this tenant.' },
        };
    }
    if (!FNOL_ELIGIBLE_STATUSES.has(row.status)) {
        return {
            ok: false,
            status: 'error',
            summary: `Policy ${row.policyNumber} is in status "${row.status}" — no active policy to attach a FNOL claim to.`,
            error: {
                code: 'NOT_ELIGIBLE',
                message: `FNOL is only allowed against: ${[...FNOL_ELIGIBLE_STATUSES].join(', ')}.`,
            },
        };
    }
    const recipientEmail = input.requestedEmail || row.policyholderEmail || '';
    if (!recipientEmail) {
        return {
            ok: false,
            status: 'missing_required_fields',
            summary: 'No recipient email on file for this policy.',
            required_fields: ['policyholder.email | requestedEmail'],
        };
    }

    let created: Awaited<ReturnType<typeof createPolicyLinkedClaim>>;
    try {
        created = await createPolicyLinkedClaim({
            policyId: input.policyId,
            actorId: ctx.userId,
            incidentDate: input.incidentDate ? new Date(input.incidentDate) : undefined,
        });
    } catch (err) {
        logger.warn({ err, policyId: input.policyId }, 'operator.send_fnol_link.create_claim_failed');
        return {
            ok: false,
            status: 'error',
            summary: 'Could not create a policy-linked FNOL claim.',
            error: {
                code: 'CLAIM_CREATE_FAILED',
                message: err instanceof Error ? err.message : 'Claim creation error.',
            },
        };
    }

    const sendResult = await sendFnolLinkForClaim({
        claimId: created.claimId,
        requestedEmail: recipientEmail,
        actor: {
            actorType: 'OPS',
            actorId: ctx.userId,
            actorName: ctx.userId,
        },
    });
    if (!sendResult.ok) {
        return {
            ok: false,
            status: 'error',
            summary: `FNOL link send failed (${sendResult.code}).`,
            error: { code: sendResult.code, message: sendResult.message },
        };
    }

    const envelope: OperatorSuccessEnvelope<{
        policy_id: string;
        policy_number: string;
        claim_id: string;
        claim_number: string;
        fnol_link: string;
        email_to: string;
    }> = {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary: `Created a policy-linked FNOL session and sent the FNOL link to ${row.insuredName}.`,
        entities: { policyId: input.policyId, claimId: created.claimId },
        next_actions: ['operator.get_action_status'],
        extra: {
            policy_id: input.policyId,
            policy_number: row.policyNumber,
            claim_id: created.claimId,
            claim_number: created.claimNumber,
            fnol_link: sendResult.fnolLink,
            email_to: sendResult.recipientEmail,
        },
    };
    return envelope;
}
