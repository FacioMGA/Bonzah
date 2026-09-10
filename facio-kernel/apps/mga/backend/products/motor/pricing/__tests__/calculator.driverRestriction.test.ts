/**
 * Driver coverage restriction → motor premium parity tests
 * (ABY-232 / ADR-0025).
 *
 * Locks the four-mode pricing behaviour end-to-end:
 *
 *   POLICYHOLDER_ONLY    → NAMED_DRIVERS basis, −15% discount
 *   NAMED_DRIVERS        → NAMED_DRIVERS basis, −15% discount
 *   ANY_DRIVER_25_PLUS   → OPEN_DRIVERS basis,  no discount
 *   ANY_DRIVER_40_PLUS   → OPEN_DRIVERS basis,  −7.5% age-band discount
 *
 * Peter Sheppard approved the 40–70 age-band discount on 2026-05-19
 * (see ADR-0026 §pricing).
 */
import { describe, expect, it } from 'vitest';
import { calculateAutoInsurancePremium as calculateMotorPremium } from '../autoInsuranceCalculator.js';
import { loadAbbeygateAutoCyprus2022Matrix } from '../data/loader.js';
import { registerAllProducts } from '../../../registerProducts.js';
import type { QuoteData } from '../../../../platform/types/autoInsurance.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';

registerAllProducts();
const motorModel = loadAbbeygateAutoCyprus2022Matrix();
const calculateAutoInsurancePremium = (...[quoteData, overrideExcess, appliedEndorsements = []]: Parameters<typeof calculateMotorPremium>) =>
  calculateMotorPremium(quoteData, overrideExcess, appliedEndorsements, motorModel);

// ADR-0019: `getTenantConfig()` is ALS-only. Wrap every calculation
// in `runWithOperatingTenant` using the Cyprus fixture.
const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;
const runInCY = <T>(fn: () => T): T => runWithOperatingTenant(cyTenant, fn);

function baseQuote(): QuoteData {
  return {
    proposer: {
      firstName: 'Test',
      lastName: 'Driver',
      email: 'test@example.com',
      phone: '+35799123456',
      dateOfBirth: '1985-05-15',
    },
    vehicleValue: 20000,
    engineSize: 1800,
    year: 2019,
    ncb: '5+ Years',
    coverRequired: 'Comprehensive',
    kmsPerYear: '10000',
    licenseYears: 10,
    licenseType: 'Full',
    licenseIssuedIn: 'Cyprus',
    vehicleUse: 'Private',
    hasConvictions: false,
    hasClaims: false,
    hasAdditionalDrivers: false,
    youngestDriverAge: '',
    requiredExcess: '300',
    vehicleType: 'Car',
    make: 'Toyota',
    model: 'Yaris',
    vehicleLocation: 'Cyprus',
    renewalDate: '',
    motorcycleRidersNamed: null,
    classicIsGenuine: null,
    classicIsSecondaryVehicle: null,
    cabrio: 'No',
    fuelType: 'Petrol',
    countryOfRegistration: 'Cyprus',
    registrationNumber: 'ABC123',
    vin: '',
    numberOfSeats: 5,
    modified: false,
    modificationsDetails: '',
    parking: 'Driveway',
    parkingOther: '',
    garageTotalValue: '',
    protectNCB: false,
    businessUseDetails: '',
    homeInsuranceRenewalDate: '',
    infoTrueAndAccurate: true,
    fairProcessingAccepted: true,
  };
}

describe('motor calculator — driverRestriction parity', () => {
  it('POLICYHOLDER_ONLY applies the named-drivers −15% discount', () => {
    const result = runInCY(() => calculateAutoInsurancePremium({
      ...baseQuote(),
      driverRestriction: 'POLICYHOLDER_ONLY',
    }));
    const trace = result.calculationDetails.steps;
    const namedDiscountStep = trace.find((s) => s.id === 'drivers.twoNamedDiscount');
    expect(namedDiscountStep).toBeDefined();
    expect(namedDiscountStep!.factor).toBeCloseTo(0.85, 4);
  });

  it('NAMED_DRIVERS applies the named-drivers −15% discount', () => {
    const result = runInCY(() => calculateAutoInsurancePremium({
      ...baseQuote(),
      driverRestriction: 'NAMED_DRIVERS',
      hasAdditionalDrivers: true,
      youngestDriverAge: 35,
      additionalDrivers: [{
        firstName: 'Alex',
        lastName: 'Driver',
        dateOfBirth: '1990-02-20',
        licenseYears: '10',
      }],
    }));
    const trace = result.calculationDetails.steps;
    const namedDiscountStep = trace.find((s) => s.id === 'drivers.twoNamedDiscount');
    expect(namedDiscountStep).toBeDefined();
    expect(namedDiscountStep!.factor).toBeCloseTo(0.85, 4);
  });

  it('ANY_DRIVER_25_PLUS does NOT apply the named-drivers discount', () => {
    const result = runInCY(() => calculateAutoInsurancePremium({
      ...baseQuote(),
      driverRestriction: 'ANY_DRIVER_25_PLUS',
    }));
    const trace = result.calculationDetails.steps;
    const namedDiscountStep = trace.find((s) => s.id === 'drivers.twoNamedDiscount');
    // Factor is 1.0 → step is suppressed by the compModule guard.
    expect(namedDiscountStep).toBeUndefined();
  });

  it('ANY_DRIVER_40_PLUS does NOT apply the named-drivers discount but does apply the 7.5% age-band discount', () => {
    const result = runInCY(() => calculateAutoInsurancePremium({
      ...baseQuote(),
      driverRestriction: 'ANY_DRIVER_40_PLUS',
    }));
    const trace = result.calculationDetails.steps;
    const namedDiscountStep = trace.find((s) => s.id === 'drivers.twoNamedDiscount');
    const openAgeBandDiscountStep = trace.find((s) => s.id === 'drivers.openAgeBandDiscount');
    expect(namedDiscountStep).toBeUndefined();
    expect(openAgeBandDiscountStep).toBeDefined();
    expect(openAgeBandDiscountStep!.factor).toBeCloseTo(0.925, 4);
  });

  it('ANY_DRIVER_40_PLUS prices below ANY_DRIVER_25_PLUS after Peter-approved 7.5% discount', () => {
    const r25 = runInCY(() => calculateAutoInsurancePremium({
      ...baseQuote(),
      driverRestriction: 'ANY_DRIVER_25_PLUS',
    }));
    const r40 = runInCY(() => calculateAutoInsurancePremium({
      ...baseQuote(),
      driverRestriction: 'ANY_DRIVER_40_PLUS',
    }));
    expect(r40.premium).toBeLessThan(r25.premium);
  });

  it('POLICYHOLDER_ONLY and NAMED_DRIVERS without additional drivers price identically', () => {
    const policyholder = runInCY(() => calculateAutoInsurancePremium({
      ...baseQuote(),
      driverRestriction: 'POLICYHOLDER_ONLY',
    }));
    const namedNoExtras = runInCY(() => calculateAutoInsurancePremium({
      ...baseQuote(),
      driverRestriction: 'NAMED_DRIVERS',
      hasAdditionalDrivers: false,
    }));
    expect(policyholder.premium).toBeCloseTo(namedNoExtras.premium, 2);
  });

  it('open modes drop the under-25 loading even if a stale youngestDriverAge is present', () => {
    const namedYoung = runInCY(() => calculateAutoInsurancePremium({
      ...baseQuote(),
      driverRestriction: 'NAMED_DRIVERS',
      hasAdditionalDrivers: true,
      youngestDriverAge: 22,
      additionalDrivers: [{
        firstName: 'Young',
        lastName: 'Driver',
        dateOfBirth: '2004-01-01',
        licenseYears: '2',
      }],
    }));
    const openYoung = runInCY(() => calculateAutoInsurancePremium({
      ...baseQuote(),
      driverRestriction: 'ANY_DRIVER_25_PLUS',
      // Stale leftover values from a previous basis — the calculator
      // must NOT charge the under-25 loading because the open mode
      // excludes drivers under 25.
      hasAdditionalDrivers: true,
      youngestDriverAge: 22,
    }));
    expect(openYoung.premium).toBeLessThan(namedYoung.premium);
  });

  it('legacy quote (no driverRestriction) prices identically to NAMED_DRIVERS basis', () => {
    const legacy = runInCY(() => calculateAutoInsurancePremium(baseQuote()));
    const named = runInCY(() => calculateAutoInsurancePremium({
      ...baseQuote(),
      driverRestriction: 'NAMED_DRIVERS',
      hasAdditionalDrivers: false,
    }));
    expect(legacy.premium).toBeCloseTo(named.premium, 2);
  });

  it('emits the driverRestriction step in the pricing trace', () => {
    const result = runInCY(() => calculateAutoInsurancePremium({
      ...baseQuote(),
      driverRestriction: 'ANY_DRIVER_25_PLUS',
    }));
    const restrictionStep = result.calculationDetails.steps.find((s) => s.id === 'drivers.coverageRestriction');
    expect(restrictionStep).toBeDefined();
    const inputs = restrictionStep!.inputs as Record<string, unknown>;
    expect(inputs.driverRestriction).toBe('ANY_DRIVER_25_PLUS');
    expect(inputs.driverPricingBasis).toBe('OPEN_DRIVERS');
    expect(inputs.minAuthorisedDriverAge).toBe(25);
  });
});
