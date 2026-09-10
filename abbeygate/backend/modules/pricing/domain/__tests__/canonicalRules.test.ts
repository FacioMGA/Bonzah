import { describe, expect, it } from 'vitest';
import {
  ccBandMinimumExcess,
  computeCalculatedPolicyExcess,
  computeClassicExcess,
  computeDeclaredValueBasedExcess,
  computeMotorcaravanExcess,
  roundUpToNearest50,
} from '../../../../products/motor/pricing/canonicalRules.js';
import {
  calculateAutoInsurancePremium,
  calculateAutoInsuranceQuoteResponse,
} from '../../../../products/motor/pricing/autoInsuranceCalculator.js';
import { registerAllProducts } from '../../../../products/registerProducts.js';

registerAllProducts();

/**
 * Phase 6k canonical motor shape — personal-details (incl. dateOfBirth)
 * live exclusively under `proposer.*`. Helper builds a deep-merged
 * proposer block so individual tests can override DOB inline.
 */
const proposerWithDob = (dateOfBirth: string) => ({
  proposer: { dateOfBirth },
});

const baseQuote = {
  ...proposerWithDob('1988-05-10'),
  kmsPerYear: '10,000',
  requiredExcess: '400',
  vehicleValue: 37300,
  hasClaims: false,
  hasConvictions: false,
  licenseYears: 10,
  licenseType: 'Full',
  licenseIssuedIn: 'Cyprus',
  coverRequired: 'Comprehensive',
  ncb: '2 Years',
  engineSize: 1800,
  vehicleType: 'Car',
  make: 'Toyota',
  model: 'Yaris',
  vehicleUse: 'SD&P',
  hasAdditionalDrivers: false,
  year: 2020,
};

describe('canonical excess rules', () => {
  it('returns the flat scheme floor regardless of engine size', () => {
    // Per Abbeygate motor rating sheet (Peter Sheppard, 2026-05-15) the
    // private-car minimum excess is a flat €200 floor — the legacy
    // cc-band ladder (€250 / €300 / €400 / €500) is no longer used.
    expect(ccBandMinimumExcess(1900)).toBe(200);
    expect(ccBandMinimumExcess(1901)).toBe(200);
    expect(ccBandMinimumExcess(2201)).toBe(200);
    expect(ccBandMinimumExcess(3600)).toBe(200);
  });

  it('rounds up to nearest 50', () => {
    expect(roundUpToNearest50(373)).toBe(400);
    expect(roundUpToNearest50(400)).toBe(400);
    expect(roundUpToNearest50(401)).toBe(450);
  });

  it('uses max(1.5% declared value, €200 floor) rounded up to next €50', () => {
    // 1.5% × 5,000 = €75 → floored at €200, rounded to €200.
    expect(computeDeclaredValueBasedExcess(5000, 1800)).toBe(200);
    // 1.5% × 10,000 = €150 → floored at €200.
    expect(computeDeclaredValueBasedExcess(10000, 3500)).toBe(200);
    // 1.5% × 37,300 = €559.50 → rounded up to €600 (above the floor).
    expect(computeDeclaredValueBasedExcess(37300, 1800)).toBe(600);
    // 1.5% × 32,000 = €480 → rounded up to €500.
    expect(computeDeclaredValueBasedExcess(32000, 1500)).toBe(500);
    // Tiny value still hits the floor.
    expect(computeDeclaredValueBasedExcess(2000, 1400)).toBe(200);
  });

  it('rounds-up boundary still works at exact 50 and one cent above', () => {
    expect(roundUpToNearest50(50.01)).toBe(100);
  });

  it('returns zero excess for TPO', () => {
    const excess = computeCalculatedPolicyExcess({ ...baseQuote, coverRequired: 'Third Party Liability' });
    expect(excess).toBe(0);
  });

  it('supports classic and motorcaravan excess rules', () => {
    expect(computeClassicExcess(60000)).toBe(900);
    expect(computeMotorcaravanExcess(25000)).toBe(400);
    expect(computeMotorcaravanExcess(35000)).toBe(1000);
  });

  it('treats motorhome/caravan labels as motorcaravan risks for excess', () => {
    expect(computeCalculatedPolicyExcess({ ...baseQuote, vehicleType: 'Motorhome', vehicleValue: 25_000 })).toBe(400);
    expect(computeCalculatedPolicyExcess({ ...baseQuote, vehicleType: 'Caravan', vehicleValue: 35_000 })).toBe(1000);
  });

  it('uses classic matrix excess (age band x group) for classic risks', () => {
    const excess = computeCalculatedPolicyExcess({
      ...baseQuote,
      vehicleType: 'Classic Car',
      make: 'ALFA ROMEO',
      model: '1750',
      year: 1968,
      engineSize: 1779,
      vehicleValue: 40_000,
      kmsPerYear: '2,000',
      ...proposerWithDob('1988-05-10'),
    });
    expect(excess).toBe(600);
  });

  it('bands the displayed motorbike excess by engine size (ABY-325)', () => {
    // Motorbike excess comes from the rating workbook cc-band table, not the
    // private-car declared-value formula.
    expect(computeCalculatedPolicyExcess({ ...baseQuote, vehicleType: 'Motorbike', engineSize: 100 })).toBe(150);
    expect(computeCalculatedPolicyExcess({ ...baseQuote, vehicleType: 'Motorbike', engineSize: 250 })).toBe(250);
    expect(computeCalculatedPolicyExcess({ ...baseQuote, vehicleType: 'Motorbike', engineSize: 500 })).toBe(350);
    expect(computeCalculatedPolicyExcess({ ...baseQuote, vehicleType: 'Motorbike', engineSize: 900 })).toBe(400);
    expect(computeCalculatedPolicyExcess({ ...baseQuote, vehicleType: 'Motorbike', engineSize: 1200 })).toBe(500);
  });

  it('matches the displayed motorbike excess to the rater policy excess (ABY-325)', () => {
    const motorbike = {
      ...baseQuote,
      vehicleType: 'Motorbike',
      engineSize: 500,
      coverRequired: 'Comprehensive',
      ncb: '3 Years',
      motorcycleRidersNamed: true,
      // A selected excess below the workbook floor must not pull the rated
      // excess below the cc-band minimum.
      requiredExcess: '200',
    };
    const displayed = computeCalculatedPolicyExcess(motorbike);
    const rated = calculateAutoInsurancePremium(motorbike);
    expect(displayed).toBe(350);
    expect(rated.policyExcess).toBe(displayed);
  });
});

describe('TPO pricing', () => {
  it('prices TPO at 60% of comprehensive base before add-ons', () => {
    const comprehensive = calculateAutoInsurancePremium({ ...baseQuote, coverRequired: 'Comprehensive' });
    const tpo = calculateAutoInsurancePremium({ ...baseQuote, coverRequired: 'Third Party Liability' });
    const step = (tpo.calculationDetails.steps || []).find((s) => s.id === 'tpo.sixtyPctRule');
    expect(step).toBeTruthy();
    expect(Number(step?.factor || 0)).toBe(0.6);
    expect(tpo.premium).toBeGreaterThan(0);
    expect(tpo.premium).toBeLessThan(comprehensive.premium);
  });

  it('keeps TPO 60% rule when loadings change', () => {
    const quote = {
      ...baseQuote,
      hasClaims: true,
      claimsCountLast5Years: 2,
      claimsTotalCostLast5Years: 15000,
      hasAdditionalDrivers: true,
      youngestDriverAge: 24,
      vehicleUse: 'Class 2',
    };
    const tpo = calculateAutoInsurancePremium({ ...quote, coverRequired: 'Third Party Liability' });
    const step = (tpo.calculationDetails.steps || []).find((s) => s.id === 'tpo.sixtyPctRule');
    expect(step).toBeTruthy();
    expect(Number(step?.output || 0)).toBeCloseTo(Number(step?.inputs?.comprehensiveBaseRateBeforeAddOns || 0) * 0.6, 2);
  });

  it('applies motorcaravan loadings multiplicatively (>3t and Limassol)', () => {
    const calc = calculateAutoInsurancePremium({
      ...baseQuote,
      proposer: {
        ...baseQuote.proposer,
        address: { city: 'Limassol' },
      },
      vehicleType: 'Motorcaravan',
      kmsPerYear: '10,000',
      vehicleWeightTonnes: 3.5,
      coverRequired: 'Comprehensive',
    });
    expect(calc.calculationDetails.premiumBreakdown.compFinal).toBeCloseTo(450 * 1.3 * 1.25, 6);
  });

  it('routes motorhome aliases through the motorcaravan premium branch', () => {
    const calc = calculateAutoInsurancePremium({
      ...baseQuote,
      vehicleType: 'Motorhome',
      kmsPerYear: '10,000',
      vehicleWeightTonnes: 3.5,
      city: 'Nicosia',
      coverRequired: 'Comprehensive',
    });
    expect(calc.calculationDetails.premiumBreakdown.compFinal).toBeCloseTo(450 * 1.3, 6);
    const motorcaravanBaseStep = (calc.calculationDetails.steps || []).find((s) => s.id === 'motorcaravan.base');
    expect(motorcaravanBaseStep).toBeTruthy();
  });

  it('uses classic matrix base premium instead of standard base matrix', () => {
    const calc = calculateAutoInsurancePremium({
      ...baseQuote,
      vehicleType: 'Classic Car',
      make: 'ALFA ROMEO',
      model: '1750',
      year: 1968,
      engineSize: 1779,
      kmsPerYear: '2,000',
      ...proposerWithDob('1988-05-10'),
      vehicleValue: 40_000,
      requiredExcess: '250',
      coverRequired: 'Comprehensive',
    });
    const classicBaseStep = (calc.calculationDetails.steps || []).find((s) => s.id === 'comp.base.classic');
    expect(classicBaseStep?.output).toBe(250);
    expect(calc.calculationDetails.premiumBreakdown.compBase).toBe(250);
    expect(calc.policyExcess).toBe(600);
  });

  it('defaults to named-driver basis discount and allows OPEN_DRIVERS override', () => {
    const named = calculateAutoInsurancePremium({
      ...baseQuote,
      coverRequired: 'Comprehensive',
      driverPricingBasis: 'NAMED_DRIVERS',
    });
    const open = calculateAutoInsurancePremium({
      ...baseQuote,
      coverRequired: 'Comprehensive',
      driverPricingBasis: 'OPEN_DRIVERS',
    });
    expect(named.premium).toBeLessThan(open.premium);
  });

  it('applies +20% loading when an added driver is over 80', () => {
    const baseline = calculateAutoInsurancePremium({
      ...baseQuote,
      hasAdditionalDrivers: true,
      youngestDriverAge: 45,
      additionalDrivers: [{ firstName: 'A', lastName: 'B', dateOfBirth: '1970-01-01' }],
      coverRequired: 'Comprehensive',
    });
    const over80 = calculateAutoInsurancePremium({
      ...baseQuote,
      hasAdditionalDrivers: true,
      youngestDriverAge: 45,
      additionalDrivers: [{ firstName: 'A', lastName: 'B', dateOfBirth: '1930-01-01' }],
      coverRequired: 'Comprehensive',
    });
    expect(over80.premium).toBeGreaterThan(baseline.premium);
  });

  it('applies proposer over-80 loading from the scheme table', () => {
    const baseline = calculateAutoInsurancePremium({
      ...baseQuote,
      ...proposerWithDob('1970-01-01'),
      coverRequired: 'Comprehensive',
    });
    const over80 = calculateAutoInsurancePremium({
      ...baseQuote,
      ...proposerWithDob('1940-01-01'),
      coverRequired: 'Comprehensive',
    });
    expect(over80.premium).toBeGreaterThan(baseline.premium);
  });

  it('keeps over-85 proposers rateable when UW outcome accepts', () => {
    const response = calculateAutoInsuranceQuoteResponse({
      ...baseQuote,
      ...proposerWithDob('1934-12-01'),
      coverRequired: 'Comprehensive',
    }, undefined, {
      reference: 'AGE85-RED',
      currency: 'EUR',
      uwDecision: {
        outcome: 'accept',
        lane: 'green',
        reasons: [],
        triggers: [],
      },
    });
    expect(response.status).toBe('quoted');
    expect(response.primaryOption.annualPremium).toBeGreaterThan(0);
  });

  it('embeds CV 24 windscreen premium into core premium instead of add-ons', () => {
    const quoteData = {
      ...baseQuote,
      coverRequired: 'Comprehensive',
      policyTermMonths: 12,
      __mbePolicyTermMonths: 12,
    };
    const calculation = calculateAutoInsurancePremium(quoteData, undefined, [
      {
        code: 'CV 24',
        params: {
          premium_eur: 25,
          cy_limit_eur: 750,
          other_limit_eur: 1250,
        },
      },
    ]);

    expect(calculation.calculationDetails.premiumBreakdown.windscreen).toBe(25);
    const traceSteps = calculation.calculationDetails.steps || [];
    expect(traceSteps.some((step) => String(step.id || '') === 'coverage.windscreen')).toBe(true);
    expect(traceSteps.some((step) => String(step.id || '') === 'endorsement.premium.CV 24')).toBe(false);
  });

  it('caps UW discretionary percentage at 20% by default', () => {
    const baseline = calculateAutoInsurancePremium({
      ...baseQuote,
      coverRequired: 'Comprehensive',
    });
    const withLargeLoading = calculateAutoInsurancePremium({
      ...baseQuote,
      coverRequired: 'Comprehensive',
      uwAdjustments: [{ type: 'loading', mode: 'pct', value: 50 }],
    });
    const expectedMax = Math.round((baseline.calculationDetails.costBreakdown.subtotalNetPremiumBeforeUwAdj || 0) * 0.2 * 100) / 100;
    const actualDelta = Math.round((withLargeLoading.calculationDetails.costBreakdown.uwAdjustmentAmount || 0) * 100) / 100;
    expect(actualDelta).toBeCloseTo(expectedMax, 2);
  });

  it('normalizes CY country code before UW decisioning', () => {
    const response = calculateAutoInsuranceQuoteResponse({
      ...baseQuote,
      vehicleType: 'Car',
      countryOfRegistration: 'CY',
    });
    expect(response.warnings.join(' ')).not.toContain('outside Cyprus, Portugal, or Spain');
  });

  it('applies coverage-scoped adjustment to selected section only', () => {
    const baseline = calculateAutoInsurancePremium({ ...baseQuote, coverRequired: 'Comprehensive' });
    const policyScoped = calculateAutoInsurancePremium({
      ...baseQuote,
      coverRequired: 'Comprehensive',
      uwAdjustments: [
        {
          id: 'adj-policy-loading',
          lineType: 'pricing',
          type: 'loading',
          mode: 'pct',
          value: 10,
          scopeType: 'policy',
          reasonText: 'Policy loading test',
        },
      ],
    });
    const ownDamageScoped = calculateAutoInsurancePremium({
      ...baseQuote,
      coverRequired: 'Comprehensive',
      uwAdjustments: [
        {
          id: 'adj-own-loading',
          lineType: 'pricing',
          type: 'loading',
          mode: 'pct',
          value: 10,
          scopeType: 'coverage',
          scopeRef: 'OWN_DAMAGE',
          reasonText: 'Coverage loading test',
        },
      ],
    });

    const policyDelta = Number(policyScoped.premium) - Number(baseline.premium);
    const ownDamageDelta = Number(ownDamageScoped.premium) - Number(baseline.premium);
    expect(policyDelta).toBeGreaterThan(0);
    expect(ownDamageDelta).toBeGreaterThan(0);
    expect(policyDelta).toBeGreaterThan(ownDamageDelta);
  });

  it('ignores schedule-note lines for premium math', () => {
    const baseline = calculateAutoInsurancePremium({ ...baseQuote, coverRequired: 'Comprehensive' });
    const withScheduleNote = calculateAutoInsurancePremium({
      ...baseQuote,
      coverRequired: 'Comprehensive',
      uwAdjustments: [
        {
          id: 'note-1',
          lineType: 'schedule_note',
          category: 'EXCLUSION',
          text: 'No cover while racing.',
        },
      ],
    });
    const uwSteps = (withScheduleNote.calculationDetails.steps || []).filter((s) => String(s.id || '').startsWith('uw.adjustment.'));
    expect(withScheduleNote.premium).toBe(baseline.premium);
    expect(uwSteps).toHaveLength(0);
  });
});
