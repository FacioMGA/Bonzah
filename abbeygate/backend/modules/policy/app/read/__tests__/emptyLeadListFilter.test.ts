import { describe, expect, it } from 'vitest';
import {
  EMPTY_LEAD_STALE_DAYS,
  EMPTY_LEAD_STATUSES,
  buildEmptyLeadExclusionWhere,
  buildEmptyLeadWhere,
  emptyLeadStaleCutoff,
  shouldIncludeEmptyLeads,
  stableEmptyLeadNow,
} from '../emptyLeadListFilter.js';

describe('emptyLeadListFilter', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');

  it('floors the reference now to the start of the UTC day', () => {
    expect(stableEmptyLeadNow(now).toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });

  it('produces a cache-stable exclusion across a single UTC day', () => {
    // Two instants on the same UTC day must yield an identical exclusion
    // fragment so the hot-view cache key stays constant and can actually hit.
    const morning = new Date('2026-08-11T00:00:01.000Z');
    const evening = new Date('2026-08-11T23:59:59.000Z');
    const a = buildEmptyLeadExclusionWhere(stableEmptyLeadNow(morning));
    const b = buildEmptyLeadExclusionWhere(stableEmptyLeadNow(evening));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('cuts off at exactly EMPTY_LEAD_STALE_DAYS before now', () => {
    const cutoff = emptyLeadStaleCutoff(now);
    const expected = new Date(now.getTime() - EMPTY_LEAD_STALE_DAYS * 24 * 60 * 60 * 1000);
    expect(cutoff.toISOString()).toBe(expected.toISOString());
  });

  it('matches only earliest-status, contactless, stale rows', () => {
    const where = buildEmptyLeadWhere(now);
    expect(where.status).toEqual({ in: [...EMPTY_LEAD_STATUSES] });
    expect(where.lastActivityAt).toEqual({ lt: emptyLeadStaleCutoff(now) });
    // Both email AND phone must be blank (null or empty string).
    expect(where.AND).toEqual([
      { OR: [{ policyholderEmail: null }, { policyholderEmail: '' }] },
      { OR: [{ policyholderPhone: null }, { policyholderPhone: '' }] },
    ]);
  });

  it('exclusion is the exact negation of the match predicate', () => {
    const exclusion = buildEmptyLeadExclusionWhere(now);
    expect(exclusion).toEqual({ NOT: buildEmptyLeadWhere(now) });
  });

  it('parses the opt-in flag from common truthy forms', () => {
    expect(shouldIncludeEmptyLeads('true')).toBe(true);
    expect(shouldIncludeEmptyLeads('1')).toBe(true);
    expect(shouldIncludeEmptyLeads('TRUE')).toBe(true);
    expect(shouldIncludeEmptyLeads('false')).toBe(false);
    expect(shouldIncludeEmptyLeads('')).toBe(false);
    expect(shouldIncludeEmptyLeads(undefined)).toBe(false);
    expect(shouldIncludeEmptyLeads(null)).toBe(false);
  });
});
