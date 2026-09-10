/**
 * Pure rollup math for the BO dashboard's "authoritative core" tiles
 * (writtenPremium / submissions / issued / referred / declined).
 *
 * Lives in its own module so it can be unit-tested without Express or Prisma,
 * and so a static guard (tools/quality/check-dashboard-no-policy-jsonb-hydration.mjs)
 * can ensure the reports/dashboard handler keeps these tiles projection-backed
 * instead of regressing to in-memory sums over `Policy.quoteResponse` JSONB.
 */

export type AuthoritativeStatusBucket = {
  status: string | null;
  _count: { _all: number };
  _sum: { totalPremium: unknown };
};

type AuthoritativeCore = {
  submissions: number;
  issuedCount: number;
  referredCount: number;
  declinedCount: number;
  writtenPremium: number;
};

const ISSUED_STATUSES: ReadonlySet<string> = new Set(['ISSUED', 'ACTIVE']);

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Roll up per-status `groupBy` buckets into the dashboard's "core" tile shape.
 *
 * Invariants pinned by dashboardAggregates.test.ts:
 *   - submissions     = Σ count across all buckets
 *   - issuedCount     = Σ count where status ∈ {ISSUED, ACTIVE}
 *   - writtenPremium  = Σ totalPremium where status ∈ {ISSUED, ACTIVE}
 *   - referredCount / declinedCount are status-specific, NOT in writtenPremium
 *   - status comparison is case-insensitive
 *   - non-finite / null premium values contribute 0 (never NaN)
 */
export function summarizeAuthoritativeBuckets(buckets: AuthoritativeStatusBucket[]): AuthoritativeCore {
  let submissions = 0;
  let issuedCount = 0;
  let referredCount = 0;
  let declinedCount = 0;
  let writtenPremium = 0;
  for (const bucket of buckets) {
    const upper = String(bucket.status ?? '').toUpperCase();
    const count = Number(bucket._count?._all ?? 0);
    submissions += count;
    if (ISSUED_STATUSES.has(upper)) {
      issuedCount += count;
      writtenPremium += toNumber(bucket._sum?.totalPremium);
    } else if (upper === 'REFERRAL') {
      referredCount += count;
    } else if (upper === 'DECLINED') {
      declinedCount += count;
    }
  }
  return { submissions, issuedCount, referredCount, declinedCount, writtenPremium };
}

export function summarizeOpenClaimsReserve(amountReserved: unknown): number {
  return round2(toNumber(amountReserved));
}
