/**
 * Bordereaux Repository — Prisma-backed data access for reporting domain.
 *
 * CHAMPS: Extracted from domain/bordereaux/lloydsV52.ts to keep domain pure.
 * The domain builds CRS v5.2 rows from plain objects; this repository fetches from DB.
 */

import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';

// ─── Reporting Period ────────────────────────────────────────────────

export function buildReportingPeriodBounds(year: number, month: number) {
    const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    return { startDate, endDate };
}

export async function getOrCreatePeriod(binderId: string, year: number, month: number) {
    const { startDate, endDate } = buildReportingPeriodBounds(year, month);
    const existing = await prisma.reportingPeriod.findUnique({
        where: { binderId_year_month: { binderId, year, month } },
    });
    if (existing) {
        const isStartMismatch = existing.startDate.getTime() !== startDate.getTime();
        const isEndMismatch = existing.endDate.getTime() !== endDate.getTime();
        if (!isStartMismatch && !isEndMismatch) return existing;
        return prisma.reportingPeriod.update({
            where: { id: existing.id },
            data: { startDate, endDate },
        });
    }

    return prisma.reportingPeriod.create({
        data: {
            binderId,
            year,
            month,
            startDate,
            endDate,
            status: 'OPEN',
        },
    });
}

// ─── Binder ──────────────────────────────────────────────────────────

export async function fetchBinder(binderId: string) {
    return tenantScopedPrisma.binder.findUnique({
        where: { id: binderId },
        include: { financials: true, reportingConfig: true },
    }).catch(() => null);
}

// ─── Risk Stream ─────────────────────────────────────────────────────

export async function fetchRiskTransactionsForPeriod(
    binderId: string,
    period: { startDate: Date; endDate: Date },
    productType?: string,
) {
    return tenantScopedPrisma.riskTransaction.findMany({
        where: {
            binderId,
            effectiveDate: { gte: period.startDate, lte: period.endDate },
            ...(productType ? { policy: { productType } } : {}),
        },
        include: { policy: { include: { policyHolder: true, binder: { include: { financials: true, reportingConfig: true } } } } },
        orderBy: { effectiveDate: 'asc' },
    });
}

export async function fetchPoliciesForPeriod(
    binderId: string,
    period: { startDate: Date; endDate: Date },
    productType?: string,
) {
    return tenantScopedPrisma.policy.findMany({
        where: {
            binderId,
            ...(productType ? { productType } : {}),
            status: { in: ['BOUND', 'ISSUED'] },
            inceptionDate: { gte: period.startDate, lte: period.endDate },
        },
        include: { policyHolder: true, binder: { include: { financials: true, reportingConfig: true } } },
        orderBy: { inceptionDate: 'asc' },
    });
}

// ─── Claims Stream ──────────────────────────────────────────────────

export async function fetchClaimsForBinder(binderId: string) {
    return tenantScopedPrisma.claim.findMany({
        where: {
            policy: { binderId },
        },
        include: {
            policy: { include: { policyHolder: true, binder: { include: { financials: true, reportingConfig: true } } } },
            events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
        },
        orderBy: { reportedDate: 'asc' },
    });
}

// ─── Premium Stream ─────────────────────────────────────────────────

export async function fetchPremiumTransactionsForPeriod(
    binderId: string,
    period: { startDate: Date; endDate: Date },
    productType?: string,
) {
    return prisma.premiumTransaction.findMany({
        where: {
            createdAt: { gte: period.startDate, lte: period.endDate },
            riskTransaction: {
                binderId,
                ...(productType ? { policy: { productType } } : {}),
            },
        },
        include: {
            riskTransaction: { include: { policy: { include: { policyHolder: true, binder: { include: { financials: true, reportingConfig: true } } } } } },
            taxLines: true,
        },
        orderBy: { createdAt: 'asc' },
    });
}

// ─── Claims Stream (product-aware) ──────────────────────────────────

export async function fetchClaimsForBinderAndProduct(binderId: string, productType?: string) {
    return tenantScopedPrisma.claim.findMany({
        where: {
            policy: {
                binderId,
                ...(productType ? { productType } : {}),
            },
        },
        include: {
            policy: { include: { policyHolder: true, binder: { include: { financials: true, reportingConfig: true } } } },
            events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
        },
        orderBy: { reportedDate: 'asc' },
    });
}
