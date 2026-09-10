import { describe, it, expect } from 'vitest';
import { calculateHomePremium as calculateHomePremiumWithRates } from '../homeCalculator.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';
import { loadHomeRates } from '../data/loader.js';

/**
 * ADR-0036 — Home underwriting profit loading.
 *
 * Directive: Peter (Abbeygate underwriting) 2026-05-29 — "On the home
 * also all countries I noted small change I think 3.4% please." The
 * loading is applied on `afterDiscounts` and before the per-country
 * tax engine; this test pins both the JSON config and the on-quote
 * identity for every binder country (CY / PT / GR / ES).
 */

const fixtures = getTenantFixtures();
const HOME_RATES = loadHomeRates();
const calculateHomePremium = (input: Parameters<typeof calculateHomePremiumWithRates>[0]) => calculateHomePremiumWithRates(input, HOME_RATES);

const baseInputs = {
  propertyUse: 'Permanent' as const,
  propertyType: 'Villa',
  buildingsSumInsured: 200_000,
  contentsSumInsured: 25_000,
  accidentalDamageBuildings: false,
  accidentalDamageContents: false,
  woodenConstruction: false,
  alarm: 'No' as const,
  yearBuilt: '1990 or Later' as const,
  previousClaims: 'None' as const,
  noClaimsDiscount: '0 Years' as const,
  increasedExcess: 'STD 150 XS' as const,
  proposerOver45: false,
};

function priceIn(countryCode: string) {
  const tenant = fixtures.find((t) => t.countryCode === countryCode);
  if (!tenant) throw new Error(`No fixture for ${countryCode}`);
  return runWithOperatingTenant(tenant, () => calculateHomePremium(baseInputs));
}

describe('home underwriting profit loading (ADR-0036)', () => {
  it('loads the canonical 3.4 % rate from the home rates JSON', () => {
    const loading = HOME_RATES.underwritingProfitLoading;
    expect(loading.rate).toBe(0.034);
    expect(loading.appliesTo).toBe('net_premium');
  });

  for (const country of ['CY', 'PT', 'GR', 'ES'] as const) {
    it(`applies the loading to ${country} (no per-tenant branch)`, () => {
      const result = priceIn(country);
      expect(result.declined).toBe(false);

      // The underwritten net (afterDiscounts) is identical across tenants
      // for the same risk shape — only tax / admin / CCS differ. The UW
      // profit loading rate is also identical (3.4 % on afterDiscounts).
      const expectedLoading = Number((result.breakdown.afterDiscounts * 0.034).toFixed(2));
      expect(result.breakdown.uwProfitLoading).toBeCloseTo(expectedLoading, 2);

      // netPremium is the LOADED amount that the tax engine saw.
      expect(result.breakdown.netPremium).toBeCloseTo(
        result.breakdown.afterDiscounts + result.breakdown.uwProfitLoading,
        2,
      );

      // grossPremium reconciles to loaded net + tax + admin + the
      // separate Europ Assistance pass-through (or the
      // €131 minimum-premium floor in CY — none of our test inputs
      // fall below 113 EUR loaded net, so no floor hit here).
      expect(result.breakdown.grossPremium).toBeCloseTo(
        result.breakdown.netPremium
          + result.breakdown.iptAmount
          + result.breakdown.adminFee
          + result.breakdown.europAssistanceFee,
        2,
      );

      // A calculation step is emitted so BO Premium / BDX / audit can
      // reconstruct the loaded vs unloaded identity.
      const steps = result.premium.calculationDetails?.steps ?? [];
      const loadingStep = steps.find((s) => s.id === 'home.uwProfitLoading');
      expect(loadingStep).toBeDefined();
      expect(loadingStep?.amount).toBeCloseTo(expectedLoading, 2);
      expect(loadingStep?.factor).toBe(0.034);
    });
  }

  it('preserves the minimum-premium floor when the loaded net is still below the threshold', () => {
    const tenant = fixtures.find((t) => t.countryCode === 'CY')!;
    // Buildings-only at a value too small to clear the €113 CY taxed
    // floor even after the 3.4 % loading. Pre-ADR-0036 the floor was
    // applied to afterDiscounts directly; ADR-0036 keeps the same
    // floor semantics, applied to the loaded net.
    const result = runWithOperatingTenant(tenant, () =>
      calculateHomePremium({
        ...baseInputs,
        buildingsSumInsured: 0,
        contentsSumInsured: 5_000,
        noClaimsDiscount: '5+ Years',
        increasedExcess: '750 XS',
        proposerOver45: true,
        alarm: 'Yes',
        // Isolate ADR-0036's underwritten-floor identity from the
        // separately-tested ADR-0042 partner pass-through.
        europAssistance: false,
      }),
    );
    // Floor hit → grossPremium = 131 EUR (CY), netPremium = 113 EUR.
    expect(result.breakdown.grossPremium).toBe(131);
    expect(result.breakdown.netPremium).toBeGreaterThanOrEqual(100);
  });
});
