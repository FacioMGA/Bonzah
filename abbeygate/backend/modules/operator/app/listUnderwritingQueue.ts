import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import {
    searchPolicyList,
    type PolicyListRow,
} from '../infra/adapters/policyListAdapter.js';

export interface ListUnderwritingQueueInput {
    productType?: string;
    limit?: number;
}

interface UwQueueEntry {
    policy_id: string;
    policy_number: string;
    insured_name: string;
    product_type: string | null;
    status: string;
    bo_status: string | null;
    attention_score: number;
    compliance_state: string;
    quote_expiry_date: string | null;
    updated_at: string;
}

export type ListUnderwritingQueueOutput = OperatorEnvelope<{ queue: UwQueueEntry[] }>;

function serialize(r: PolicyListRow): UwQueueEntry {
    return {
        policy_id: r.policyId,
        policy_number: r.policyNumber,
        insured_name: r.insuredName,
        product_type: r.productType,
        status: r.status,
        bo_status: r.boStatus,
        attention_score: r.attentionScore,
        compliance_state: r.complianceState,
        quote_expiry_date: r.quoteExpiryDate?.toISOString() ?? null,
        updated_at: r.updatedAt.toISOString(),
    };
}

/**
 * C1 flow (spec §3.C.1): list quotes/policies pending underwriter
 * action. Two derivation signals on `policyListIndex`:
 *   - `uwActionRequired = true`  (set on REFERRAL, CANCELLATION_REQUESTED)
 *   - `status = REFERRAL` (also includes INFO_REQUIRED when relevant)
 *
 * Both reduce to `searchPolicyList({ uwActionRequired: true, ... })`
 * — the projection writer already collapses the signals.
 */
export async function listUnderwritingQueue(
    input: ListUnderwritingQueueInput,
    ctx: McpContext,
): Promise<ListUnderwritingQueueOutput> {
    const action = buildOperatorActionContext(ctx);
    const rows = await searchPolicyList({
        uwActionRequired: true,
        productType: input.productType?.toUpperCase(),
        limit: input.limit ?? 50,
    });
    const envelope: OperatorSuccessEnvelope<{ queue: UwQueueEntry[] }> = {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary:
            rows.length === 0
                ? 'No quotes currently pending underwriter action.'
                : `${rows.length} quote(s) / polic(y/ies) pending underwriter action.`,
        entities: {},
        next_actions: rows.length === 1 ? ['operator.get_quote'] : [],
        extra: { queue: rows.map(serialize) },
    };
    return envelope;
}
