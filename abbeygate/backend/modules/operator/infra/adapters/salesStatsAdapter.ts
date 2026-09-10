/**
 * Tenant-scoped read adapter for operator analytics — wraps the same
 * Prisma groupBy reads the canonical `GET /api/reports/dashboard`
 * endpoint uses ([backend/modules/policy/http/reportsRouter.ts]), but
 * scoped to a single (product, period) tuple. Keeps the operator MCP
 * tool surface clean of HTTP self-calls.
 *
 * V2 may extract a shared `salesAggregates` service in
 * `backend/modules/reporting/app/`; for V1 we read directly with the
 * same policy projection.
 */
import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';

const ISSUED_STATUSES = ['BOUND', 'ISSUED', 'ACTIVE'];
const REFERRAL_STATUSES = ['REFERRAL', 'INFO_REQUIRED'];

export interface SalesAggregatesInput {
    productType?: string;
    start: Date;
    end: Date;
}

export interface SalesAggregatesOutput {
    period: { start: string; end: string };
    productType: string | null;
    policiesIssued: number;
    grossWrittenPremium: number;
    policiesReferred: number;
    quotesCreated: number;
}

function buildPolicyDateWhere(input: SalesAggregatesInput): Prisma.PolicyWhereInput {
    const where: Prisma.PolicyWhereInput = {
        inceptionDate: { gte: input.start, lt: input.end },
    };
    if (input.productType) {
        where.productType = input.productType.toUpperCase();
    }
    return where;
}

export async function getSalesAggregates(input: SalesAggregatesInput): Promise<SalesAggregatesOutput> {
    const policyWhere = buildPolicyDateWhere(input);

    const [statusBuckets, quotesCreatedCount] = await Promise.all([
        tenantScopedPrisma.policySearchIndex.groupBy({
            by: ['status'],
            _count: { _all: true },
            _sum: { totalPremium: true },
            where: { policy: policyWhere },
        }),
        // "Quotes created" counts every policy row (DRAFT-stage included)
        // whose inceptionDate window matches; for the user's spec
        // semantics ("how many sales did we have today") issued count is
        // the headline KPI.
        tenantScopedPrisma.policy.count({
            where: {
                ...policyWhere,
                status: { in: ['DRAFT', 'QUOTED', 'REFERRAL', 'INFO_REQUIRED', 'PRICED', 'PAYMENT_PENDING'] },
            },
        }),
    ]);

    let policiesIssued = 0;
    let grossWrittenPremium = 0;
    let policiesReferred = 0;
    for (const bucket of statusBuckets) {
        const upper = String(bucket.status || '').toUpperCase();
        const count = bucket._count?._all ?? 0;
        const premium = Number(bucket._sum?.totalPremium?.toString() ?? '0');
        if (ISSUED_STATUSES.includes(upper)) {
            policiesIssued += count;
            grossWrittenPremium += premium;
        } else if (REFERRAL_STATUSES.includes(upper)) {
            policiesReferred += count;
        }
    }

    return {
        period: { start: input.start.toISOString(), end: input.end.toISOString() },
        productType: input.productType?.toUpperCase() ?? null,
        policiesIssued,
        grossWrittenPremium,
        policiesReferred,
        quotesCreated: quotesCreatedCount,
    };
}

export interface QuotePipelineInput extends SalesAggregatesInput {}

export interface QuotePipelineOutput {
    period: { start: string; end: string };
    productType: string | null;
    counters: {
        quotes_created: number;
        quotes_sent: number;
        quotes_accepted: number;
        policies_bound: number;
        policies_issued: number;
    };
}

/**
 * Counts canonical funnel events from the `AuditAction` log for a
 * tenant-scoped window. Audit-event-driven (spec §3.C.2), distinct
 * from the dashboard's wizard-stage funnel.
 */
export async function getQuotePipelineAggregates(
    input: QuotePipelineInput,
): Promise<QuotePipelineOutput> {
    const periodWhere: Prisma.AuditActionWhereInput = {
        occurredAt: { gte: input.start, lt: input.end },
    };
    const counters = await Promise.all(
        (
            [
                ['QUOTE.GENERATED', 'quotes_created'],
                ['QUOTE.SENT', 'quotes_sent'],
                ['POLICY.QUOTED', 'quotes_accepted'],
                ['POLICY.BOUND', 'policies_bound'],
                ['POLICY.ISSUED', 'policies_issued'],
            ] as const
        ).map(async ([actionName, key]) => {
            const count = await tenantScopedPrisma.auditAction.count({
                where: { ...periodWhere, actionName },
            });
            return [key, count] as const;
        }),
    );
    const out: QuotePipelineOutput['counters'] = {
        quotes_created: 0,
        quotes_sent: 0,
        quotes_accepted: 0,
        policies_bound: 0,
        policies_issued: 0,
    };
    for (const [key, value] of counters) out[key] = value;
    return {
        period: { start: input.start.toISOString(), end: input.end.toISOString() },
        productType: input.productType?.toUpperCase() ?? null,
        counters: out,
    };
}
