import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import { getPolicyById } from '../infra/adapters/policyListAdapter.js';

export interface GetPolicyInput {
    policyId: string;
}

export type GetPolicyOutput = OperatorEnvelope<{ policy: Record<string, unknown> | null }>;

export async function getPolicy(input: GetPolicyInput, ctx: McpContext): Promise<GetPolicyOutput> {
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
    const envelope: OperatorSuccessEnvelope<{ policy: Record<string, unknown> }> = {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary: `Loaded policy ${row.policyNumber} for ${row.insuredName} (${row.status}).`,
        entities: { policyId: row.policyId },
        next_actions: ['operator.resend_policy_documents'],
        extra: {
            policy: {
                policy_id: row.policyId,
                policy_number: row.policyNumber,
                insured_name: row.insuredName,
                product_type: row.productType,
                status: row.status,
                bo_status: row.boStatus,
                total_premium: row.totalPremium,
                inception_date: row.inceptionDate?.toISOString() ?? null,
                expiry_date: row.expiryDate?.toISOString() ?? null,
            },
        },
    };
    return envelope;
}
