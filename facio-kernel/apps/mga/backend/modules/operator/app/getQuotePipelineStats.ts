import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import {
    getTenantPeriod,
    type TenantPeriodLabel,
} from '../../../platform/tenant/tenantTime.js';
import {
    getQuotePipelineAggregates,
} from '../infra/adapters/salesStatsAdapter.js';

export interface GetQuotePipelineStatsInput {
    productType?: string;
    period?: TenantPeriodLabel;
}

export type GetQuotePipelineStatsOutput = OperatorEnvelope<{
    period_label: string;
    period: { start: string; end: string; tz: string };
    product_type: string | null;
    counters: {
        quotes_created: number;
        quotes_sent: number;
        quotes_accepted: number;
        policies_bound: number;
        policies_issued: number;
    };
}>;

/**
 * Audit-event-driven funnel counts (spec §6) for a tenant-calendar
 * period. Distinct from the wizard-stage funnel exposed by the BO
 * dashboard — this one tracks operator/customer actions captured in
 * `AuditAction` rows.
 */
export async function getQuotePipelineStats(
    input: GetQuotePipelineStatsInput,
    ctx: McpContext,
): Promise<GetQuotePipelineStatsOutput> {
    const action = buildOperatorActionContext(ctx);
    const period = getTenantPeriod(input.period ?? 'today');
    const agg = await getQuotePipelineAggregates({
        productType: input.productType,
        start: period.start,
        end: period.end,
    });
    const envelope: OperatorSuccessEnvelope<{
        period_label: string;
        period: { start: string; end: string; tz: string };
        product_type: string | null;
        counters: typeof agg.counters;
    }> = {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary: `Pipeline ${input.period ?? 'today'}: ${agg.counters.quotes_created} created → ${agg.counters.quotes_sent} sent → ${agg.counters.quotes_accepted} accepted → ${agg.counters.policies_bound} bound → ${agg.counters.policies_issued} issued.`,
        entities: {},
        next_actions: [],
        extra: {
            period_label: input.period ?? 'today',
            period: { start: period.start.toISOString(), end: period.end.toISOString(), tz: period.tz },
            product_type: agg.productType,
            counters: agg.counters,
        },
    };
    return envelope;
}
