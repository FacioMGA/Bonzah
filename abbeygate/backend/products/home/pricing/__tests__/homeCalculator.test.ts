import { describe, it, expect } from 'vitest';
import { calculateHomePremium } from '../homeCalculator.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';

// ADR-0019: getTenantConfig() is ALS-only — every test must wrap its
// calculation in runWithOperatingTenant. We use the CY fixture for the
// default cohort and the PT fixture for the multi-jurisdiction case.
const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;
const runInCY = <T>(fn: () => T): T => runWithOperatingTenant(cyTenant, fn);

describe('calculateHomePremium', () => {
  it('rates a basic permanent home in Cyprus (small bracket, AD excluded)', () => {
    const result = runInCY(() => calculateHomePremium({
      propertyUse: 'Permanent',
      propertyType: 'Villa',
      buildingsSumInsured: 80_000,
      contentsSumInsured: 15_000,
      accidentalDamageBuildings: false,
      accidentalDamageContents: false,
      woodenConstruction: false,
      alarm: 'Yes',
      yearBuilt: '1990 or Later',
      previousClaims: 'None',
      noClaimsDiscount: '3 Years',
      increasedExcess: 'STD 150 XS',
      proposerOver45: true,
      // ADR-0042: this fixture pins the workbook baseline; opt out of
      // the bundled €12 Home Assistance default so the numbers stay
      // a verification of the rate-card-only path.
      europAssistance: false,
    }));

    expect(result.declined).toBe(false);
    // ADR-0074: rate-card ×1.2 must bump the audit version so pre/post
    // quotes cannot share a PriceCalculationAudit hash.
    expect(result.premium.calculationDetails?.calculatorVersion).toBe('home-xlsx-2022@1.3.0');
    // Base = 80_000 * 0.0021 + 15_000 * 0.00462 = 168 + 69.30 = 237.30
    // (2022 workbook rates × 1.2 — Peter Sheppard 2026-08-18 base uplift).
    expect(result.breakdown.basePremium).toBeCloseTo(237.30, 2);
    // No loadings
    expect(result.breakdown.loadings).toBe(0);
    // Discounts are applied in the same sequence as the workbook.
    expect(result.breakdown.discounts).toBeCloseTo(0.45, 3);
    // ADR-0036 — `afterDiscounts` keeps the pre-loading underwritten net
    // (the previous `netPremium` identity). `netPremium` is now the
    // LOADED net (afterDiscounts × 1.034) that the tax engine sees.
    expect(result.breakdown.afterDiscounts).toBeCloseTo(145.23, 1);
    expect(result.breakdown.uwProfitLoading).toBeCloseTo(4.94, 2);
    expect(result.breakdown.netPremium).toBeCloseTo(150.17, 1);
    // CY Home: no policy-level IPT (legacy Abbeygate schedule shows
    // Local Taxes = 0.00); admin = 18
    expect(result.breakdown.iptAmount).toBe(0);
    expect(result.breakdown.adminFee).toBe(18);
    expect(result.breakdown.grossPremium).toBeCloseTo(150.17 + 0 + 18, 1);
  });

  it('matches the workbook permanent-home Cyprus sample', () => {
    const result = runInCY(() => calculateHomePremium({
      propertyUse: 'Permanent',
      propertyType: 'Villa',
      buildingsSumInsured: 255_000,
      contentsSumInsured: 22_000,
      accidentalDamageBuildings: false,
      accidentalDamageContents: false,
      woodenConstruction: false,
      alarm: 'No',
      yearBuilt: '1990 or Later',
      previousClaims: 'None',
      noClaimsDiscount: '4 Years',
      increasedExcess: 'STD 150 XS',
      proposerOver45: true,
      // ADR-0042: opt out of bundled assistance to keep this fixture
      // a clean rate-card workbook check.
      europAssistance: false,
    }));

    // Workbook sample × 1.2 (Peter Sheppard 2026-08-18 base uplift).
    expect(result.breakdown.buildingsPremium).toBeCloseTo(454.13, 2);
    expect(result.breakdown.contentsPremium).toBeCloseTo(101.64, 2);
    expect(result.breakdown.basePremium).toBeCloseTo(555.77, 2);
    // ADR-0036 — underwritten net (afterDiscounts) preserved; loaded
    // net = afterDiscounts × 1.034 = 366.35.
    expect(result.breakdown.afterDiscounts).toBeCloseTo(354.30, 2);
    expect(result.breakdown.uwProfitLoading).toBeCloseTo(12.05, 2);
    expect(result.breakdown.netPremium).toBeCloseTo(366.35, 2);
    // CY Home: no policy-level IPT; gross = loadedNet + adminFee(18).
    expect(result.breakdown.iptAmount).toBe(0);
    expect(result.breakdown.grossPremium).toBeCloseTo(384.35, 2);
  });

  it('matches the workbook holiday-home Cyprus sample', () => {
    const result = runInCY(() => calculateHomePremium({
      propertyUse: 'Holiday',
      propertyType: 'Villa',
      buildingsSumInsured: 320_000,
      contentsSumInsured: 20_000,
      accidentalDamageBuildings: false,
      accidentalDamageContents: false,
      woodenConstruction: false,
      alarm: 'No',
      yearBuilt: '1990 or Later',
      previousClaims: 'None',
      noClaimsDiscount: '4 Years',
      increasedExcess: 'STD 150 XS',
      proposerOver45: true,
      // ADR-0042: opt out of bundled assistance to keep this fixture
      // a clean rate-card workbook check.
      europAssistance: false,
    }));

    // Workbook sample × 1.2 (Peter Sheppard 2026-08-18 base uplift).
    expect(result.breakdown.buildingsPremium).toBeCloseTo(725.76, 2);
    expect(result.breakdown.contentsPremium).toBeCloseTo(94.80, 2);
    expect(result.breakdown.basePremium).toBeCloseTo(820.56, 2);
    // ADR-0036 — underwritten net preserved at 523.11; loaded net = ×1.034.
    expect(result.breakdown.afterDiscounts).toBeCloseTo(523.11, 2);
    expect(result.breakdown.uwProfitLoading).toBeCloseTo(17.79, 2);
    expect(result.breakdown.netPremium).toBeCloseTo(540.90, 2);
    // CY Home: no policy-level IPT; gross = loadedNet + adminFee(18).
    expect(result.breakdown.iptAmount).toBe(0);
    expect(result.breakdown.grossPremium).toBeCloseTo(558.90, 2);
  });

  it('enforces 100 EUR minimum premium', () => {
    const result = runInCY(() => calculateHomePremium({
      propertyUse: 'Permanent',
      propertyType: 'Apartment',
      buildingsSumInsured: 0,
      contentsSumInsured: 5_000,
      alarm: 'Yes',
      yearBuilt: '1990 or Later',
      noClaimsDiscount: '5+ Years',
      increasedExcess: '750 XS',
      proposerOver45: true,
    }));
    expect(result.breakdown.netPremium).toBeGreaterThanOrEqual(100);
  });

  it('applies combustible construction loading', () => {
    const r1 = runInCY(() => calculateHomePremium({
      propertyUse: 'Permanent',
      propertyType: 'Villa',
      buildingsSumInsured: 200_000,
      contentsSumInsured: 25_000,
      woodenConstruction: false,
    }));
    const r2 = runInCY(() => calculateHomePremium({
      propertyUse: 'Permanent',
      propertyType: 'Villa',
      buildingsSumInsured: 200_000,
      contentsSumInsured: 25_000,
      woodenConstruction: true,
    }));
    expect(r2.breakdown.basePremium).toBe(r1.breakdown.basePremium);
    expect(r2.breakdown.loadingBreakdown.combustibleConstruction).toBe(1.0);
    expect(r2.breakdown.netPremium).toBeGreaterThan(r1.breakdown.netPremium);
  });

  it('applies claims loadings in correct order', () => {
    const r = runInCY(() => calculateHomePremium({
      propertyUse: 'Permanent',
      propertyType: 'Villa',
      buildingsSumInsured: 200_000,
      contentsSumInsured: 25_000,
      previousClaims: '2 claims < 3000',
    }));
    expect(r.breakdown.loadingBreakdown.previousClaims).toBe(0.55);
  });

  it('adds fixed Europ Assistance premium when selected', () => {
    const result = runInCY(() => calculateHomePremium({
      propertyUse: 'Permanent',
      propertyType: 'Villa',
      buildingsSumInsured: 120_000,
      contentsSumInsured: 20_000,
      europAssistance: true,
    }));

    expect(result.breakdown.grossPremium).toBeGreaterThan(result.breakdown.netPremium);
    expect(result.premium.calculationDetails?.steps?.some((step) => step.id === 'home.europAssistance')).toBe(true);
  });

  // ADR-0042 — Home Emergency Assistance is bundled by default for HOME
  // quotes on CY and GR (mirrors the canonical endorsement template
  // `HOME-EUROP-ASSISTANCE`). These cases pin the new defaulting rule
  // explicitly so the wizard <-> BO contract stays aligned, and so a
  // future "let's strip the default to save money" change fails loudly
  // here instead of silently undoing the customer-visible €12 line.
  describe('ADR-0042 — Home Emergency Assistance default-on contract', () => {
    it('CY HOME quote with `europAssistance` undefined includes the €12 fee step (bundled default)', () => {
      const result = runInCY(() => calculateHomePremium({
        propertyUse: 'Permanent',
        propertyType: 'Villa',
        buildingsSumInsured: 120_000,
        contentsSumInsured: 20_000,
      }));
      const feeStep = result.premium.calculationDetails?.steps?.find((step) => step.id === 'home.europAssistance');
      expect(feeStep).toBeDefined();
      expect((feeStep as { amount?: number } | undefined)?.amount).toBe(12);
    });

    it('GR HOME quote with `europAssistance` undefined includes the €12 fee step (bundled default)', () => {
      const grTenant = getTenantFixtures().find((t) => t.countryCode === 'GR');
      expect(grTenant).toBeDefined();
      const result = runWithOperatingTenant(grTenant!, () => calculateHomePremium({
        propertyUse: 'Permanent',
        propertyType: 'Villa',
        buildingsSumInsured: 120_000,
        contentsSumInsured: 20_000,
      }));
      const feeStep = result.premium.calculationDetails?.steps?.find((step) => step.id === 'home.europAssistance');
      expect(feeStep).toBeDefined();
      expect((feeStep as { amount?: number } | undefined)?.amount).toBe(12);
    });

    it('PT HOME quote with `europAssistance` undefined does NOT include the €12 (binder jurisdiction)', () => {
      const ptTenant = getTenantFixtures().find((t) => t.countryCode === 'PT');
      expect(ptTenant).toBeDefined();
      const result = runWithOperatingTenant(ptTenant!, () => calculateHomePremium({
        propertyUse: 'Permanent',
        buildingsSumInsured: 100_000,
        contentsSumInsured: 20_000,
      }));
      expect(result.premium.calculationDetails?.steps?.some((step) => step.id === 'home.europAssistance')).toBe(false);
    });

    it('CY HOME quote with explicit `europAssistance: false` honours the operator override (no defensive re-attach)', () => {
      const result = runInCY(() => calculateHomePremium({
        propertyUse: 'Permanent',
        propertyType: 'Villa',
        buildingsSumInsured: 120_000,
        contentsSumInsured: 20_000,
        europAssistance: false,
      }));
      expect(result.premium.calculationDetails?.steps?.some((step) => step.id === 'home.europAssistance')).toBe(false);
    });

    it('CY HOME quote with explicit `europAssistance: true` keeps charging in CY (binder jurisdiction)', () => {
      const result = runInCY(() => calculateHomePremium({
        propertyUse: 'Permanent',
        propertyType: 'Villa',
        buildingsSumInsured: 120_000,
        contentsSumInsured: 20_000,
        europAssistance: true,
      }));
      const feeStep = result.premium.calculationDetails?.steps?.find((step) => step.id === 'home.europAssistance');
      expect(feeStep).toBeDefined();
      expect((feeStep as { amount?: number } | undefined)?.amount).toBe(12);
    });

    it('does not make an explicitly selected €12 assistance pass-through eligible for CY risk pricing or profit loading', () => {
      const risk = {
        propertyUse: 'Permanent' as const,
        propertyType: 'Villa',
        buildingsSumInsured: 120_000,
        contentsSumInsured: 20_000,
      };
      const withoutAssistance = runInCY(() => calculateHomePremium({ ...risk, europAssistance: false }));
      const withAssistance = runInCY(() => calculateHomePremium({ ...risk, europAssistance: true }));

      expect(withAssistance.breakdown.basePremium).toBe(withoutAssistance.breakdown.basePremium);
      expect(withAssistance.breakdown.afterLoadings).toBe(withoutAssistance.breakdown.afterLoadings);
      expect(withAssistance.breakdown.afterDiscounts).toBe(withoutAssistance.breakdown.afterDiscounts);
      expect(withAssistance.breakdown.uwProfitLoading).toBe(withoutAssistance.breakdown.uwProfitLoading);
      expect(withAssistance.breakdown.netPremium).toBe(withoutAssistance.breakdown.netPremium);
      expect(withAssistance.breakdown.europAssistanceFee - withoutAssistance.breakdown.europAssistanceFee).toBe(12);
      expect(withAssistance.breakdown.iptAmount - withoutAssistance.breakdown.iptAmount).toBe(0);
      expect(withAssistance.breakdown.grossPremium - withoutAssistance.breakdown.grossPremium).toBe(12);
    });

    it('adds the CY pass-through after, rather than toward, the underwritten minimum premium', () => {
      const risk = {
        propertyUse: 'Permanent' as const,
        propertyType: 'Apartment',
        buildingsSumInsured: 0,
        contentsSumInsured: 5_000,
        alarm: 'Yes' as const,
        yearBuilt: '1990 or Later' as const,
        noClaimsDiscount: '5+ Years' as const,
        increasedExcess: '750 XS' as const,
        proposerOver45: true,
      };
      const withoutAssistance = runInCY(() => calculateHomePremium({ ...risk, europAssistance: false }));
      const withAssistance = runInCY(() => calculateHomePremium({ ...risk, europAssistance: true }));

      expect(withoutAssistance.breakdown.grossPremium).toBe(131);
      expect(withAssistance.breakdown.grossPremium).toBe(143);
      expect(withAssistance.breakdown.netPremium).toBe(withoutAssistance.breakdown.netPremium);
      expect(withAssistance.breakdown.europAssistanceFee).toBe(12);
    });

    it('applies Greece IPT to the €12 pass-through without loading, discounting, or profit-loading it', () => {
      const grTenant = getTenantFixtures().find((tenant) => tenant.countryCode === 'GR')!;
      const risk = {
        propertyUse: 'Permanent' as const,
        propertyType: 'Villa',
        buildingsSumInsured: 120_000,
        contentsSumInsured: 20_000,
      };
      const withoutAssistance = runWithOperatingTenant(grTenant, () => calculateHomePremium({ ...risk, europAssistance: false }));
      const withAssistance = runWithOperatingTenant(grTenant, () => calculateHomePremium({ ...risk, europAssistance: true }));

      expect(withAssistance.breakdown.basePremium).toBe(withoutAssistance.breakdown.basePremium);
      expect(withAssistance.breakdown.afterLoadings).toBe(withoutAssistance.breakdown.afterLoadings);
      expect(withAssistance.breakdown.afterDiscounts).toBe(withoutAssistance.breakdown.afterDiscounts);
      expect(withAssistance.breakdown.uwProfitLoading).toBe(withoutAssistance.breakdown.uwProfitLoading);
      expect(withAssistance.breakdown.netPremium).toBe(withoutAssistance.breakdown.netPremium);
      expect(withAssistance.breakdown.europAssistanceFee - withoutAssistance.breakdown.europAssistanceFee).toBeCloseTo(12, 2);
      expect(withAssistance.breakdown.iptAmount - withoutAssistance.breakdown.iptAmount).toBeCloseTo(1.8, 2);
      expect(withAssistance.breakdown.grossPremium - withoutAssistance.breakdown.grossPremium).toBeCloseTo(13.8, 2);
    });

    it.each(['PT', 'ES'] as const)('does not charge explicit assistance in %s because the binder does not authorise it', (countryCode) => {
      const tenant = getTenantFixtures().find((candidate) => candidate.countryCode === countryCode)!;
      const result = runWithOperatingTenant(tenant, () => calculateHomePremium({
        propertyUse: 'Permanent',
        propertyType: 'Villa',
        buildingsSumInsured: 120_000,
        contentsSumInsured: 20_000,
        europAssistance: true,
      }));

      expect(result.premium.calculationDetails?.steps?.some((step) => step.id === 'home.europAssistance')).toBe(false);
    });
  });

  // ADR-0052 — Greece shares the Cyprus base rate card but carries a flat
  // +20% country loading on every risk ("the Greek premium is 20% loading
  // on top of the Cyprus premium", Abbeygate underwriting 2026-07-17).
  describe('Greece country loading (ADR-0052)', () => {
    const grTenant = getTenantFixtures().find((t) => t.countryCode === 'GR')!;
    const cleanRisk = {
      propertyUse: 'Permanent' as const,
      propertyType: 'Villa' as const,
      buildingsSumInsured: 120_000,
      contentsSumInsured: 20_000,
      woodenConstruction: false,
      previousClaims: 'None' as const,
      // Isolate the rate-card + country-loading path from the €12 bundled
      // Home Assistance default so base premiums compare directly.
      europAssistance: false,
    };

    it('adds a +20% Greece country loading on top of the identical Cyprus base premium', () => {
      const cy = runInCY(() => calculateHomePremium(cleanRisk));
      const gr = runWithOperatingTenant(grTenant, () => calculateHomePremium(cleanRisk));

      // Same rate card → identical base premium; the 20% is a country uplift
      // on top. It is applied to the base, not summed into the risk-loading
      // pool, so `loadings` (risk loadings) stays 0 for a clean risk.
      expect(gr.breakdown.basePremium).toBeCloseTo(cy.breakdown.basePremium, 2);
      expect(gr.breakdown.loadingBreakdown.countryBaseLoading).toBe(0.2);
      expect(gr.breakdown.loadings).toBe(0);
      expect(gr.breakdown.afterLoadings).toBeCloseTo(cy.breakdown.basePremium * 1.2, 2);
      // Cyprus carries no country loading.
      expect(cy.breakdown.loadingBreakdown.countryBaseLoading).toBeUndefined();
    });

    it('compounds the +35% island surcharge on top of the 20%-loaded Greek premium (× 1.20 × 1.35)', () => {
      // Theo 2026-07-17: the island loading is "added on top" of the Greek
      // (Cyprus +20%) premium, i.e. it compounds rather than adding on base.
      const cy = runInCY(() => calculateHomePremium(cleanRisk));
      const grIsland = runWithOperatingTenant(grTenant, () => calculateHomePremium({
        ...cleanRisk,
        greekPostcode: 'zakinthos',
      }));

      expect(grIsland.breakdown.basePremium).toBeCloseTo(cy.breakdown.basePremium, 2);
      expect(grIsland.breakdown.loadingBreakdown.countryBaseLoading).toBe(0.2);
      expect(grIsland.breakdown.loadingBreakdown.greekPostcode).toBe(0.35);
      // Compound: base × 1.20 (Greece) × 1.35 (island), NOT base × 1.55.
      expect(grIsland.breakdown.afterLoadings).toBeCloseTo(cy.breakdown.basePremium * 1.2 * 1.35, 2);
      expect(grIsland.breakdown.afterLoadings).not.toBeCloseTo(cy.breakdown.basePremium * 1.55, 1);
    });
  });

  it('prices PT Home with tenant IPT for BDX migration imports', () => {
    const ptTenant = getTenantFixtures().find((tenant) => tenant.countryCode === 'PT');
    expect(ptTenant).toBeDefined();
    const result = runWithOperatingTenant(ptTenant!, () => calculateHomePremium({
      propertyUse: 'Permanent',
      buildingsSumInsured: 100000,
      contentsSumInsured: 20000,
    }));
    expect(result.breakdown.iptAmount).toBeGreaterThan(0);
    expect(result.breakdown.grossPremium).toBeGreaterThan(result.breakdown.netPremium);
  });
});
