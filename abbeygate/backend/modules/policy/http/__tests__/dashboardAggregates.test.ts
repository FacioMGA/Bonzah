/**
 * Regression contract for `summarizeAuthoritativeBuckets`. Pins the math that
 * produces writtenPremium / submissions / issued / referred / declined on the
 * BO dashboard. Paired with check-dashboard-no-policy-jsonb-hydration.mjs,
 * which keeps the live query projection-backed.
 */
import { describe, expect, it } from 'vitest';
import {
  summarizeOpenClaimsReserve,
  summarizeAuthoritativeBuckets,
  type AuthoritativeStatusBucket,
} from '../dashboardAggregates.js';

function bucket(status: string | null, count: number, totalPremium: unknown): AuthoritativeStatusBucket {
  return { status, _count: { _all: count }, _sum: { totalPremium } };
}

describe('dashboardAggregates — summarizeAuthoritativeBuckets', () => {
  it('returns zeros for an empty bucket list (no policies in window)', () => {
    expect(summarizeAuthoritativeBuckets([])).toEqual({
      submissions: 0,
      issuedCount: 0,
      referredCount: 0,
      declinedCount: 0,
      writtenPremium: 0,
    });
  });

  it('sums premium ONLY for ISSUED + ACTIVE statuses (writtenPremium contract)', () => {
    const result = summarizeAuthoritativeBuckets([
      bucket('ISSUED', 10, 1000),
      bucket('ACTIVE', 5, 500),
      bucket('QUOTED', 3, 999),
      bucket('REFERRAL', 2, 999),
      bucket('DECLINED', 1, 999),
    ]);
    expect(result.writtenPremium).toBe(1500);
  });

  it('counts submissions across every status (raw policy count, not just issued)', () => {
    const result = summarizeAuthoritativeBuckets([
      bucket('ISSUED', 10, 1000),
      bucket('ACTIVE', 5, 500),
      bucket('QUOTED', 3, 0),
      bucket('REFERRAL', 2, 0),
      bucket('DECLINED', 1, 0),
    ]);
    expect(result.submissions).toBe(21);
  });

  it('reports issued / referred / declined as separate per-status counts', () => {
    const result = summarizeAuthoritativeBuckets([
      bucket('ISSUED', 7, 700),
      bucket('ACTIVE', 3, 300),
      bucket('REFERRAL', 4, 0),
      bucket('DECLINED', 2, 0),
    ]);
    expect(result.issuedCount).toBe(10);
    expect(result.referredCount).toBe(4);
    expect(result.declinedCount).toBe(2);
  });

  it('treats status comparisons case-insensitively (Prisma can return lowercase / mixed)', () => {
    const result = summarizeAuthoritativeBuckets([
      bucket('issued', 4, 400),
      bucket('Active', 1, 100),
      bucket('referral', 2, 0),
      bucket('Declined', 1, 0),
    ]);
    expect(result.issuedCount).toBe(5);
    expect(result.writtenPremium).toBe(500);
    expect(result.referredCount).toBe(2);
    expect(result.declinedCount).toBe(1);
  });

  it('coerces Decimal-like / string premium values without producing NaN', () => {
    const result = summarizeAuthoritativeBuckets([
      bucket('ISSUED', 1, '123.45'),
      bucket('ACTIVE', 1, { toString: () => '50.00' }),
      bucket('ISSUED', 1, null),
      bucket('ISSUED', 1, undefined),
      bucket('ISSUED', 1, NaN),
    ]);
    expect(Number.isFinite(result.writtenPremium)).toBe(true);
    expect(result.writtenPremium).toBeCloseTo(173.45, 2);
  });

  it('treats unknown / missing / null statuses as submissions but excludes them from premium', () => {
    const result = summarizeAuthoritativeBuckets([
      bucket(null, 2, 999),
      bucket('', 1, 999),
      bucket('CANCELLED', 3, 999),
      bucket('ISSUED', 1, 100),
    ]);
    expect(result.submissions).toBe(7);
    expect(result.issuedCount).toBe(1);
    expect(result.writtenPremium).toBe(100);
    expect(result.referredCount).toBe(0);
    expect(result.declinedCount).toBe(0);
  });

  it('does NOT double-count when both ISSUED and ACTIVE buckets are present (renewal book scenario)', () => {
    const result = summarizeAuthoritativeBuckets([
      bucket('ISSUED', 1000, 250000),
      bucket('ACTIVE', 4000, 1000000),
    ]);
    expect(result.submissions).toBe(5000);
    expect(result.issuedCount).toBe(5000);
    expect(result.writtenPremium).toBe(1250000);
  });

  it('matches the legacy in-memory sum semantics for a representative book of policies', () => {
    // Equivalent in-memory loop the previous implementation ran over hydrated
    // `Policy.quoteResponse` rows. We synthesise per-policy rows, run that
    // legacy loop, and check the projection-backed aggregate matches.
    type LegacyRow = { status: string; totalPremium: number };
    const legacyRows: LegacyRow[] = [
      ...Array.from({ length: 1234 }, () => ({ status: 'ISSUED', totalPremium: 412.5 })),
      ...Array.from({ length:  876 }, () => ({ status: 'ACTIVE', totalPremium: 198.75 })),
      ...Array.from({ length:   42 }, () => ({ status: 'REFERRAL', totalPremium: 0 })),
      ...Array.from({ length:   17 }, () => ({ status: 'DECLINED', totalPremium: 0 })),
      ...Array.from({ length:   91 }, () => ({ status: 'QUOTED', totalPremium: 250.0 })),
    ];

    const legacy = (() => {
      const issued = new Set(['ISSUED', 'ACTIVE']);
      let submissions = 0;
      let issuedCount = 0;
      let referredCount = 0;
      let declinedCount = 0;
      let writtenPremium = 0;
      for (const row of legacyRows) {
        const upper = row.status.toUpperCase();
        submissions += 1;
        if (issued.has(upper)) { issuedCount += 1; writtenPremium += row.totalPremium; }
        else if (upper === 'REFERRAL') referredCount += 1;
        else if (upper === 'DECLINED') declinedCount += 1;
      }
      return { submissions, issuedCount, referredCount, declinedCount, writtenPremium };
    })();

    const grouped = new Map<string, { count: number; sum: number }>();
    for (const row of legacyRows) {
      const g = grouped.get(row.status) ?? { count: 0, sum: 0 };
      g.count += 1;
      g.sum += row.totalPremium;
      grouped.set(row.status, g);
    }
    const buckets: AuthoritativeStatusBucket[] = Array.from(grouped.entries()).map(([status, g]) =>
      bucket(status, g.count, g.sum),
    );

    const projected = summarizeAuthoritativeBuckets(buckets);

    expect(projected.submissions).toBe(legacy.submissions);
    expect(projected.issuedCount).toBe(legacy.issuedCount);
    expect(projected.referredCount).toBe(legacy.referredCount);
    expect(projected.declinedCount).toBe(legacy.declinedCount);
    expect(projected.writtenPremium).toBeCloseTo(legacy.writtenPremium, 2);
  });
});

describe('dashboardAggregates — summarizeOpenClaimsReserve', () => {
  it('uses the open Claim.amountReserved aggregate for the dashboard portfolio reserve', () => {
    expect(summarizeOpenClaimsReserve('1500')).toBe(1500);
    expect(summarizeOpenClaimsReserve({ toString: () => '123.456' })).toBe(123.46);
  });

  it('returns zero for empty claim reserve aggregates without producing NaN', () => {
    expect(summarizeOpenClaimsReserve(null)).toBe(0);
    expect(summarizeOpenClaimsReserve(undefined)).toBe(0);
    expect(summarizeOpenClaimsReserve(NaN)).toBe(0);
  });
});
