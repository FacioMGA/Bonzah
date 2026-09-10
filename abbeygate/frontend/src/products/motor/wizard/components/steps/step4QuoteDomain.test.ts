import { describe, expect, it } from 'vitest';
import {
  deriveRecommendationCards,
  formatDateEu,
  formatDateOfBirthEu,
  formatDelta,
  generateBundleCopy,
  getIndicativeReferralPremium,
  getPolicyPeriod,
  parseExcess,
  sameBundle,
  type BundleSelection,
} from './step4QuoteDomain';
import type { RecommendationItem } from './step4QuoteApi';

describe('step4QuoteDomain', () => {
  it('projects a canonical referral price without recalculating it', () => {
    expect(getIndicativeReferralPremium({ status: 'referral', annualPremium: 1234.56 })).toBe(1234.56);
  });

  it.each([
    { status: 'quoted', annualPremium: 1234.56 },
    { status: 'referral', annualPremium: 0 },
    { status: 'referral', annualPremium: 'not-a-number' },
  ])('does not expose a non-referral or invalid premium %#', (args) => {
    expect(getIndicativeReferralPremium(args)).toBeNull();
  });

  it('formats date of birth as European date', () => {
    expect(formatDateOfBirthEu('1980-01-01')).toBe('01/01/1980');
    expect(formatDateOfBirthEu('not-a-date')).toBe('not-a-date');
  });

  it('formats quote dates as DD/MM/YYYY for European tenants', () => {
    expect(formatDateEu('2026-05-12T00:00:00.000Z')).toBe('12/05/2026');
  });

  it('parses excess robustly', () => {
    expect(parseExcess('€500')).toBe(500);
    expect(parseExcess('')).toBe(250);
  });

  it('formats deltas as signed euro amounts', () => {
    expect(formatDelta(12.5)).toBe('+€12.50');
    expect(formatDelta(-7)).toBe('−€7.00');
  });

  it('builds bundle copy and equality checks', () => {
    const copy = generateBundleCopy({ excess: 500, hasNcb: true, hasVip: false });
    expect(copy.title).toContain('Balanced');
    const a: BundleSelection = { excess: 500, claimProtection: true, vipRoadside: false };
    const b: BundleSelection = { excess: 500, claimProtection: true, vipRoadside: false };
    expect(sameBundle(a, b)).toBe(true);
  });

  it('derives recommendation cards and pins original to bottom', () => {
    const baseBundle: BundleSelection = { excess: 500, claimProtection: false, vipRoadside: false };
    const currentBundle: BundleSelection = { excess: 700, claimProtection: true, vipRoadside: false };
    const recommendations: RecommendationItem[] = [
      {
        bundleId: 'original',
        quoteOption: { annualPremium: 900, totalExcess: 500 },
        attrs: { claimProtection: false, vipRoadside: false },
      },
      {
        bundleId: 'candidate',
        quoteOption: { annualPremium: 980, totalExcess: 700 },
        attrs: { claimProtection: true, vipRoadside: false },
      },
    ];
    const cards = deriveRecommendationCards({
      recommendations,
      baseBundle,
      currentBundle,
      applyingBundleId: null,
    });
    expect(cards).toHaveLength(2);
    expect(cards[0]?.bundleId).toBe('candidate');
    expect(cards[1]?.bundleId).toBe('original');
    expect(cards[0]?.isSelected).toBe(true);
  });

  it('computes policy period from renewal date', () => {
    const period = getPolicyPeriod('2026-03-04');
    expect(period.start).toBe('04/03/2026 00:00');
    expect(period.end).toBe('04/03/2027 12:00');
    expect(period.days).toBe(365);
  });
});
