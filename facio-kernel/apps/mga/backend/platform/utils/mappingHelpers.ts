import { z } from 'zod';

const RecordSchema = z.record(z.string(), z.unknown());
export const POLICY_START_MAX_DAYS_AHEAD = 45;

export function parseRecord(value: unknown): Record<string, unknown> {
    const parsed = RecordSchema.safeParse(value);
    return parsed.success ? parsed.data : {};
}

export function parseSnapshot(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') {
        try {
            return parseRecord(JSON.parse(value));
        } catch {
            return {};
        }
    }
    return parseRecord(value);
}

export function quoteCurrency(quoteResponse: unknown, fallback: string): string {
    const q = parseRecord(quoteResponse);
    return String(q.currency || fallback);
}

export function quotePrimaryAnnualPremium(quoteResponse: unknown): number {
    const q = parseRecord(quoteResponse);
    const primary = parseRecord(q.primaryOption);
    return Number(primary.annualPremium ?? primary.totalPremium ?? q.annualPremium ?? 0) || 0;
}

export function resolveInceptionDateFromRenewalDate(renewalDateRaw: unknown): Date {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const max = new Date(today);
    max.setDate(max.getDate() + POLICY_START_MAX_DAYS_AHEAD);

    if (renewalDateRaw === null || renewalDateRaw === undefined || String(renewalDateRaw).trim() === '') {
        return now;
    }

    const renewalDate = new Date(String(renewalDateRaw));
    if (Number.isNaN(renewalDate.getTime())) {
        throw new Error('Renewal date is invalid');
    }
    const renewalDateOnly = new Date(renewalDate);
    renewalDateOnly.setHours(0, 0, 0, 0);
    if (renewalDateOnly > max) {
        throw new Error(`Renewal date must be between today and ${POLICY_START_MAX_DAYS_AHEAD} days ahead`);
    }
    return renewalDate > now ? renewalDate : now;
}

export function resolveAnnualPolicyExpiryDate(inceptionDateRaw: Date): Date {
    const expiryDate = new Date(inceptionDateRaw);
    expiryDate.setDate(expiryDate.getDate() + 365);
    expiryDate.setHours(12, 0, 0, 0);
    return expiryDate;
}

/**
 * Canonical inception/expiry resolution at issuance time.
 *
 * The customer's requested cover start date lives in a product-specific slot
 * of the canonical quoteData: `trip.startDate` (TRAVEL), `policy.startDate`
 * (HOME), `period.inceptionDate` (HEALTH). Motor renewals carry a top-level
 * `renewalDate`. The previous implementation only consulted `renewalDate`, so
 * a home/travel policy bought ahead of its start date was incepted on the
 * purchase date — the schedule (which reads quoteData directly) showed the
 * requested start while the Policy columns, welcome email and dashboards
 * showed the purchase date (PT go-live feedback, 24 Jul 2026).
 *
 * A requested date in the past clamps to "now" (cover can never begin before
 * issuance). An invalid/absent requested date falls back to the legacy
 * renewal-date resolution — we deliberately never throw on the requested-date
 * path, because this runs after payment capture and a throw would strand the
 * policy PAID-but-never-issued.
 *
 * Expiry: single-trip travel cover ends on the declared `trip.endDate`;
 * everything else is annual (+365 days).
 */
export function resolvePolicyIssuanceDates(
    productType: string | null | undefined,
    quoteData: unknown,
    resolveFromRenewalDate: (renewalDateRaw: unknown) => Date,
): { inceptionDate: Date; expiryDate: Date } {
    const qd = parseRecord(quoteData);
    const product = String(productType || '').toUpperCase();
    const requestedRaw =
        product === 'TRAVEL' ? parseRecord(qd.trip).startDate
        : product === 'HOME' ? parseRecord(qd.policy).startDate
        : product === 'HEALTH' ? parseRecord(qd.period).inceptionDate
        : undefined;

    const now = new Date();
    let inceptionDate: Date | null = null;
    if (requestedRaw !== undefined && requestedRaw !== null && String(requestedRaw).trim() !== '') {
        const requested = new Date(String(requestedRaw));
        if (!Number.isNaN(requested.getTime())) {
            inceptionDate = requested > now ? requested : now;
        }
    }
    if (!inceptionDate) {
        inceptionDate = resolveFromRenewalDate(qd.renewalDate);
    }

    if (product === 'TRAVEL') {
        const trip = parseRecord(qd.trip);
        if (String(trip.planType || '') === 'single_trip' && trip.endDate) {
            const end = new Date(String(trip.endDate));
            if (!Number.isNaN(end.getTime()) && end > inceptionDate) {
                end.setHours(12, 0, 0, 0);
                return { inceptionDate, expiryDate: end };
            }
        }
    }
    return { inceptionDate, expiryDate: resolveAnnualPolicyExpiryDate(inceptionDate) };
}

export function normalizeOverrideExcess(value: unknown): number | string | null | undefined {
    if (value === null || value === undefined) return value;
    if (typeof value === 'number' || typeof value === 'string') return value;
    return undefined;
}

export function getMethod(target: unknown, methodName: string): ((...args: unknown[]) => unknown) | null {
    const obj = parseRecord(target);
    const method = obj[methodName];
    return typeof method === 'function' ? (...args: unknown[]) => method(...args) : null;
}
