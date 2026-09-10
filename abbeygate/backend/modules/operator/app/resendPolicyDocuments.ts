import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import { logger } from '../../../platform/utils/logger.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { emailPolicyDocumentsUseCase } from '../../policy/app/read/emailPolicyDocumentsUseCase.js';
import { buildEmailPolicyDocumentsDeps } from '../../policy/app/read/emailPolicyDocumentsDeps.js';
import { getPolicyById } from '../infra/adapters/policyListAdapter.js';

const RESEND_ELIGIBLE_STATUSES = new Set(['ACTIVE', 'ISSUED', 'EXPIRED']);

export interface ResendPolicyDocumentsInput {
    policyId: string;
    /** Optional explicit Document.id list. If omitted, the most recent
     * ISSUED_POLICY_PACK documents for the policy are resent. */
    documentIds?: string[];
}

export type ResendPolicyDocumentsOutput = OperatorEnvelope<{
    policy_id: string;
    policy_number: string;
    email_to: string;
    documents_sent: number;
}>;

/**
 * B1 flow (spec §3.B.1): re-email the existing stored ISSUED_POLICY_PACK
 * for an active / issued policy. We wrap the canonical
 * `emailPolicyDocumentsUseCase` so we never regenerate the pack or
 * touch the documents themselves.
 *
 * Eligibility:
 *   - Policy status must be ACTIVE / ISSUED / EXPIRED (within retention).
 *   - At least one Document row with `docPack='ISSUED_POLICY_PACK'`
 *     and `status='GENERATED'` must exist for the policy.
 */
export async function resendPolicyDocuments(
    input: ResendPolicyDocumentsInput,
    ctx: McpContext,
): Promise<ResendPolicyDocumentsOutput> {
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
    if (!RESEND_ELIGIBLE_STATUSES.has(row.status)) {
        return {
            ok: false,
            status: 'error',
            summary: `Policy ${row.policyNumber} is in status "${row.status}" — documents resend is not allowed.`,
            error: {
                code: 'NOT_ELIGIBLE',
                message: `Document resend is only allowed for: ${[...RESEND_ELIGIBLE_STATUSES].join(', ')}.`,
            },
        };
    }
    if (!row.policyholderEmail) {
        return {
            ok: false,
            status: 'missing_required_fields',
            summary: 'Policy has no registered customer email.',
            required_fields: ['policyholder.email'],
        };
    }

    // Resolve documents to send: explicit list or the most recent
    // ISSUED_POLICY_PACK for this policy.
    let documentIds = input.documentIds ?? [];
    if (documentIds.length === 0) {
        const docs = await tenantScopedPrisma.document.findMany({
            where: { policyId: input.policyId, docPack: 'ISSUED_POLICY_PACK', status: 'GENERATED' },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
            take: 10,
        });
        documentIds = docs.map((d) => d.id);
    }
    if (documentIds.length === 0) {
        return {
            ok: false,
            status: 'error',
            summary: 'No issued document pack found for this policy.',
            error: { code: 'DOCUMENT_PACK_NOT_FOUND', message: 'Document pack must be generated before resend.' },
        };
    }

    try {
        const tenantId = (await tenantScopedPrisma.policy.findUnique({
            where: { id: input.policyId },
            select: { operatingTenantId: true },
        }))?.operatingTenantId;
        if (!tenantId) {
            return {
                ok: false,
                status: 'error',
                summary: 'Policy tenant context could not be resolved.',
                error: { code: 'INTERNAL_ERROR', message: 'Missing operatingTenantId.' },
            };
        }
        await emailPolicyDocumentsUseCase(
            { policyId: input.policyId, tenantId, documentIds },
            buildEmailPolicyDocumentsDeps(),
        );
    } catch (err) {
        logger.warn({ err, policyId: input.policyId }, 'operator.resend_policy_documents.failed');
        return {
            ok: false,
            status: 'error',
            summary: 'Document resend failed.',
            error: {
                code: 'EMAIL_SEND_FAILED',
                message: err instanceof Error ? err.message : 'Email dispatch error.',
            },
        };
    }

    const envelope: OperatorSuccessEnvelope<{
        policy_id: string;
        policy_number: string;
        email_to: string;
        documents_sent: number;
    }> = {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary: `Resent the current issued policy document pack to ${row.insuredName}'s registered email address.`,
        entities: { policyId: input.policyId },
        next_actions: ['operator.get_action_status'],
        extra: {
            policy_id: input.policyId,
            policy_number: row.policyNumber,
            email_to: row.policyholderEmail,
            documents_sent: documentIds.length,
        },
    };
    return envelope;
}
