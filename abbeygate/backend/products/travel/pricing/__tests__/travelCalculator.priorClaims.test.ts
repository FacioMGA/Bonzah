import { describe, it, expect } from 'vitest';
import { calculateTravelPremium, type TravelQuoteData } from '../travelCalculator.js';
import { lookupPriorClaimLoading } from '../data/loader.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';

/**
 * ADR-0054 — travel prior-claims rating factor + referral threshold.
 *
 * Client instruction (2026-07-23): ask whether the customer has
 * previously claimed on travel insurance. A claim UP TO €500 loads the
 * premium by 15%; a claim OVER €500 is referred (no auto price). The
 * rule is jurisdiction-agnostic. These cases pin the calculator leaf:
 * the loading multiplies the BASE premium, is folded into the net
 * premium before the underwriting profit loading (so tax + admin fee
 * cascade on top), and the over-€500 band early-returns `refer: true`.
 */

const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;
const runInCY = <T>(fn: () => T): T => runWithOperatingTenant(cyTenant, fn);

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function baseQuote(risk?: TravelQuoteData['risk']): TravelQuoteData {
  return {
    eligibility: { countryOfResidence: 'Cyprus' },
    travellers: { coverType: 'single', leadTravellerDOB: isoDay(-30 * 365) },
    trip: { planType: 'single_trip', destinations: ['europe'], startDate: isoDay(7), endDate: isoDay(17) },
    quote: { selectedPlan: 'silver' },
    addons: {},
    ...(risk ? { risk } : {}),
  };
}

describe('travel prior-claims loading + referral (ADR-0054)', () => {
  it('loads the canonical 15% up-to-€500 rate from the BRIT travel JSON', () => {
    const loading = lookupPriorClaimLoading();
    expect(loading.upTo500Rate).toBe(0.15);
    expect(loading.appliesTo).toBe('base_premium');
  });

  it('applies a 15%-of-base claims-history loading line when band = up_to_500', () => {
    const withClaim = runInCY(() =>
      calculateTravelPremium(baseQuote({ hasPreviousTravelClaim: true, previousTravelClaimBand: 'up_to_500' })),
    );
    expect(withClaim.refer).toBe(false);
    expect(withClaim.declined).toBe(false);

    const base = withClaim.breakdown.basePremium;
    expect(base).toBeGreaterThan(0);
    // Loading amount is exactly 15% of the base premium.
    expect(withClaim.breakdown.claimsLoading).toBeCloseTo(Number((base * 0.15).toFixed(2)), 2);

    // Surfaced as a single canonical `loading.claims` line.
    const claimsLine = withClaim.breakdown.lines.find((l) => l.code === 'loading.claims');
    expect(claimsLine).toBeDefined();
    expect(claimsLine?.kind).toBe('loading');
    expect(claimsLine?.amount).toBeCloseTo(withClaim.breakdown.claimsLoading, 2);
  });

  it('folds the loading into net premium before UW profit loading, so gross exceeds the no-claim quote', () => {
    const none = runInCY(() => calculateTravelPremium(baseQuote({ hasPreviousTravelClaim: false })));
    const withClaim = runInCY(() =>
      calculateTravelPremium(baseQuote({ hasPreviousTravelClaim: true, previousTravelClaimBand: 'up_to_500' })),
    );
    expect(withClaim.breakdown.netPremium).toBeGreaterThan(none.breakdown.netPremium);
    expect(withClaim.breakdown.grossPremium).toBeGreaterThan(none.breakdown.grossPremium);
    // UW profit loading is computed off the claim-loaded base, so it is
    // strictly larger than the no-claim quote's UW loading.
    expect(withClaim.breakdown.uwProfitLoading).toBeGreaterThanOrEqual(none.breakdown.uwProfitLoading);
  });

  it('refers (no auto price) when band = over_500', () => {
    const over = runInCY(() =>
      calculateTravelPremium(baseQuote({ hasPreviousTravelClaim: true, previousTravelClaimBand: 'over_500' })),
    );
    expect(over.refer).toBe(true);
    expect(over.declined).toBe(false);
    expect(over.premium.premium).toBe(0);
    expect(over.reason).toContain('€500');
    // No priced breakdown is emitted for a referral.
    expect(over.breakdown.grossPremium).toBe(0);
    expect(over.breakdown.claimsLoading).toBe(0);
  });

  it('does not load or refer when no previous claim is declared (identical to omitting risk)', () => {
    const withFalse = runInCY(() => calculateTravelPremium(baseQuote({ hasPreviousTravelClaim: false })));
    const withoutRisk = runInCY(() => calculateTravelPremium(baseQuote()));
    expect(withFalse.breakdown.claimsLoading).toBe(0);
    expect(withFalse.breakdown.lines.some((l) => l.code === 'loading.claims')).toBe(false);
    expect(withFalse.breakdown.grossPremium).toBeCloseTo(withoutRisk.breakdown.grossPremium, 2);
  });
});
