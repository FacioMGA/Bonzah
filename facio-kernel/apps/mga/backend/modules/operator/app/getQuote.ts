import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import { getPolicyById } from '../infra/adapters/policyListAdapter.js';

export interface GetQuoteInput {
    /** Policy.id (quotes are Policy rows in DRAFT/QUOTED status). */
    policyId: string;
}

export type GetQuoteOutput = OperatorEnvelope<{ quote: Record<string, unknown> | null }>;

export async function getQuote(input: GetQuoteInput, ctx: McpContext): Promise<GetQuoteOutput> {
    const action = buildOperatorActionContext(ctx);
    const row = await getPolicyById(input.policyId);
    if (!row) {
        return {
            ok: false,
            status: 'error',
            summary: `No quote with id "${input.policyId}".`,
            error: { code: 'NOT_FOUND', message: 'Quote not found in this tenant.' },
        };
    }
    const envelope: OperatorSuccessEnvelope<{ quote: Record<string, unknown> }> = {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary: `Loaded quote ${row.policyNumber} for ${row.insuredName} (${row.status}).`,
        entities: { quoteId: row.policyId, policyId: row.policyId },
        next_actions: ['operator.send_quote_reminder'],
        extra: {
            quote: {
                policy_id: row.policyId,
                policy_number: row.policyNumber,
                insured_name: row.insuredName,
                product_type: row.productType,
                status: row.status,
                bo_status: row.boStatus,
                total_premium: row.totalPremium,
                uw_action_required: row.uwActionRequired,
                quote_expiry_date: row.quoteExpiryDate?.toISOString() ?? null,
            },
        },
    };
    return envelope;
}
