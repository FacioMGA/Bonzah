import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import {
    getTenantPeriod,
    type TenantPeriodLabel,
} from '../../../platform/tenant/tenantTime.js';
import { getSalesAggregates } from '../infra/adapters/salesStatsAdapter.js';

export interface GetSalesStatsInput {
    productType?: string;
    /**
     * Tenant-calendar period label. Default 'today'. Supported:
     * 'today' | 'yesterday' | 'wtd' (week-to-date, Monday-start)
     * | 'mtd' (month-to-date) | 'ytd' (year-to-date)
     * | 'last_7_days' | 'last_30_days'. All windows are computed in
     * the tenant's IANA timezone.
     */
    period?: TenantPeriodLabel;
}

export type GetSalesStatsOutput = OperatorEnvelope<{
    period_label: string;
    period: { start: string; end: string; tz: string };
    product_type: string | null;
    policies_issued: number;
    gross_written_premium: number;
    policies_referred: number;
    quotes_created: number;
}>;

/**
 * C2 flow (spec §3.C.2): "How many sales did we have in Cyprus motor
 * today?" — answers with policies_issued + GWP + quotes_created for
 * the requested tenant-calendar period (default today).
 *
 * "Today" is computed against the tenant's IANA timezone (CY →
 * Asia/Nicosia, etc.) via `getTenantPeriod` — not the LLM runtime tz.
 */
export async function getSalesStats(
    input: GetSalesStatsInput,
    ctx: McpContext,
): Promise<GetSalesStatsOutput> {
    const action = buildOperatorActionContext(ctx);
    const period = getTenantPeriod(input.period ?? 'today');
    const agg = await getSalesAggregates({
        productType: input.productType,
        start: period.start,
        end: period.end,
    });

    const envelope: OperatorSuccessEnvelope<{
        period_label: string;
        period: { start: string; end: string; tz: string };
        product_type: string | null;
        policies_issued: number;
        gross_written_premium: number;
        policies_referred: number;
        quotes_created: number;
    }> = {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary:
            agg.policiesIssued === 0
                ? `No ${input.productType ?? 'sales'} bound ${input.period ?? 'today'} in this tenant.`
                : `${agg.policiesIssued} ${input.productType ? `${input.productType} ` : ''}polic${agg.policiesIssued === 1 ? 'y' : 'ies'} issued ${input.period ?? 'today'} (GWP ${agg.grossWrittenPremium.toFixed(2)}).`,
        entities: {},
        next_actions: ['operator.get_quote_pipeline_stats'],
        extra: {
            period_label: input.period ?? 'today',
            period: { start: period.start.toISOString(), end: period.end.toISOString(), tz: period.tz },
            product_type: agg.productType,
            policies_issued: agg.policiesIssued,
            gross_written_premium: agg.grossWrittenPremium,
            policies_referred: agg.policiesReferred,
            quotes_created: agg.quotesCreated,
        },
    };
    return envelope;
}
