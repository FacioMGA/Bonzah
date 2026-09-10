import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import {
    QUOTE_STATUSES,
    searchPolicyList,
    type PolicyListRow,
} from '../infra/adapters/policyListAdapter.js';

export interface SearchQuotesInput {
    q?: string;
    policyHolderId?: string;
    productType?: string;
    /** Optional override of the default quote-stage status set. */
    statusIn?: string[];
    limit?: number;
}

export type SearchQuotesOutput = OperatorEnvelope<{ matches: SerializableRow[] }>;

interface SerializableRow {
    policy_id: string;
    policy_number: string;
    insured_name: string;
    product_type: string | null;
    status: string;
    bo_status: string | null;
    total_premium: number;
    uw_action_required: boolean;
    compliance_state: string;
    quote_expiry_date: string | null;
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
        uw_action_required: r.uwActionRequired,
        compliance_state: r.complianceState,
        quote_expiry_date: r.quoteExpiryDate?.toISOString() ?? null,
        updated_at: r.updatedAt.toISOString(),
    };
}

export async function searchQuotes(
    input: SearchQuotesInput,
    ctx: McpContext,
): Promise<SearchQuotesOutput> {
    const action = buildOperatorActionContext(ctx);
    const rows = await searchPolicyList({
        q: input.q,
        policyHolderId: input.policyHolderId,
        productType: input.productType?.toUpperCase(),
        statusIn: input.statusIn?.length ? input.statusIn : [...QUOTE_STATUSES],
        limit: input.limit,
    });
    const envelope: OperatorSuccessEnvelope<{ matches: SerializableRow[] }> = {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary:
            rows.length === 0
                ? 'No matching quotes.'
                : `Found ${rows.length} quote(s).`,
        entities: {},
        next_actions: rows.length === 1 ? ['operator.get_quote', 'operator.send_quote_reminder'] : [],
        extra: { matches: rows.map(serialize) },
    };
    return envelope;
}
