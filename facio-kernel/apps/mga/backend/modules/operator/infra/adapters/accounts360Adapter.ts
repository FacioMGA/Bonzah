/**
 * Tenant-scoped read adapter for the accounts360 per-account context
 * bundle (summary + portfolio + open alerts + activity feed).
 *
 * Mirrors `GET /api/accounts360/:id/overview` shape so the operator
 * MCP `get_customer_context` tool returns exactly what the BO 360
 * page would render. accounts360 is keyed by `accountId =
 * PolicyHolder.id` per `accounts-intelligence-api.md`.
 */
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';

export interface AccountContextBundle {
    summary: unknown;
    portfolio: unknown;
    openAlerts: unknown[];
    recentFeed: unknown[];
}

export async function getAccountContextBundle(args: {
    policyHolderId: string;
    feedLimit?: number;
    alertLimit?: number;
}): Promise<AccountContextBundle> {
    const id = String(args.policyHolderId || '').trim();
    if (!id) {
        return { summary: null, portfolio: null, openAlerts: [], recentFeed: [] };
    }
    const [summary, portfolio, openAlerts, recentFeed] = await Promise.all([
        tenantScopedPrisma.accountSummaryProjection.findUnique({ where: { accountId: id } }),
        tenantScopedPrisma.accountPortfolioMetrics.findUnique({ where: { accountId: id } }),
        tenantScopedPrisma.accountAlertsProjection.findMany({
            where: { accountId: id, isOpen: true },
            orderBy: { occurredAt: 'desc' },
            take: Math.min(Math.max(args.alertLimit ?? 10, 1), 50),
        }),
        tenantScopedPrisma.accountActivityFeed.findMany({
            where: { accountId: id },
            orderBy: { occurredAt: 'desc' },
            take: Math.min(Math.max(args.feedLimit ?? 20, 1), 100),
        }),
    ]);
    return { summary, portfolio, openAlerts, recentFeed };
}
