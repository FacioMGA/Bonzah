import type {
    OperatorCandidate,
    OperatorEnvelope,
    OperatorSuccessEnvelope,
} from '../domain/operatorEnvelope.js';
import { extractEmailFromContact, maskEmail } from '../domain/operatorEnvelope.js';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import { searchPolicyHoldersByText } from '../infra/adapters/policyHolderAdapter.js';

export interface SearchCustomersInput {
    q: string;
    limit?: number;
}

export type SearchCustomersOutput = OperatorEnvelope<{ matches: OperatorCandidate[] }>;

/**
 * Returns all matching PolicyHolders. Unlike most operator tools this
 * one is OK with multiple candidates — the agent is explicitly asking
 * for a list. The disambiguation pattern kicks in only inside
 * mutating / send-link tools.
 */
export async function searchCustomers(
    input: SearchCustomersInput,
    ctx: McpContext,
): Promise<SearchCustomersOutput> {
    const action = buildOperatorActionContext(ctx);
    const rows = await searchPolicyHoldersByText({ q: input.q, limit: input.limit });
    const candidates: OperatorCandidate[] = rows.map((r) => ({
        id: r.id,
        kind: 'customer',
        label: r.name,
        // PolicyHolder.contact may be a bare email OR a JSON blob
        // (`{"email":"…","phone":"…","idnumber":"…"}`). Extract first,
        // mask second — never expose the raw column (would leak DOBs,
        // passport numbers, addresses to the LLM).
        emailMasked: maskEmail(extractEmailFromContact(r.contact)),
        annotations: { active_policies: r.activePolicyCount },
    }));
    const envelope: OperatorSuccessEnvelope<{ matches: OperatorCandidate[] }> = {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary:
            candidates.length === 0
                ? `No customers matched "${input.q}".`
                : `Found ${candidates.length} customer(s) matching "${input.q}".`,
        entities: {},
        next_actions:
            candidates.length === 1
                ? ['operator.get_customer_context']
                : candidates.length > 1
                  ? ['operator.search_quotes', 'operator.search_policies']
                  : [],
        extra: { matches: candidates },
    };
    return envelope;
}
