import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import {
    POLICY_STATUSES,
    searchPolicyList,
    type PolicyListRow,
} from '../infra/adapters/policyListAdapter.js';

export interface SearchPoliciesInput {
    q?: string;
    policyHolderId?: string;
    productType?: string;
    statusIn?: string[];
    limit?: number;
}

interface SerializableRow {
    policy_id: string;
    policy_number: string;
    insured_name: string;
    product_type: string | null;
    status: string;
    bo_status: string | null;
    total_premium: number;
    inception_date: string | null;
    expiry_date: string | null;
    updated_at: string;
}

function serialize(r: PolicyListRow): SerializableRow {
    return {
        policy_id: r.policyId,
        policy_number: r.policyNumber,
        insured_name: r.insuredName,
        product_type: r.productType,
        status: r.status,
        bo_status: r.boStatus,
        total_premium: r.totalPremium,
        inception_date: r.inceptionDate?.toISOString() ?? null,
        expiry_date: r.expiryDate?.toISOString() ?? null,
        updated_at: r.updatedAt.toISOString(),
    };
}

export type SearchPoliciesOutput = OperatorEnvelope<{ matches: SerializableRow[] }>;

export async function searchPolicies(
    input: SearchPoliciesInput,
    ctx: McpContext,
): Promise<SearchPoliciesOutput> {
    const action = buildOperatorActionContext(ctx);
    const rows = await searchPolicyList({
        q: input.q,
        policyHolderId: input.policyHolderId,
        productType: input.productType?.toUpperCase(),
        statusIn: input.statusIn?.length ? input.statusIn : [...POLICY_STATUSES],
        limit: input.limit,
    });
    const envelope: OperatorSuccessEnvelope<{ matches: SerializableRow[] }> = {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary: rows.length === 0 ? 'No matching policies.' : `Found ${rows.length} polic(y/ies).`,
        entities: {},
        next_actions: rows.length === 1 ? ['operator.get_policy', 'operator.resend_policy_documents'] : [],
        extra: { matches: rows.map(serialize) },
    };
    return envelope;
}
