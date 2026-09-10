/**
 * Driver coverage restriction factor tests (ABY-232 / ADR-0025).
 *
 * Locks the scheme-aligned behaviour for the canonical
 * `driverRestriction` enum:
 *
 *   POLICYHOLDER_ONLY    → NAMED_DRIVERS basis, −15% discount, no under-25 loading
 *   NAMED_DRIVERS        → NAMED_DRIVERS basis, −15% discount, under-25 loading possible
 *   ANY_DRIVER_25_PLUS   → OPEN_DRIVERS basis,  no discount,  no under-25 loading
 *   ANY_DRIVER_40_PLUS   → OPEN_DRIVERS basis,  −7.5% age-band discount, no under-25 loading
 *
 * Plus the legacy fallback: pre-ABY-232 quotes (no `driverRestriction`)
 * read `driverPricingBasis` if present, else default to NAMED_DRIVERS.
 */
import { describe, it, expect } from 'vitest';
import {
  addedDriversUnder25FactorFromScheme,
  addedDriversUnder25FactorWithRestriction,
  driverRestrictionMinAge,
  namedDriversDiscountFactor,
  openDriverAgeBandDiscountFactor,
  resolveDriverPricingBasis,
} from '../abbeygateFactors.js';
import type { QuoteData } from '../../../../../platform/types/autoInsurance.js';

function quoteWith(overrides: Partial<QuoteData>): QuoteData {
  return {
    proposer: {
      firstName: 'Test',
      lastName: 'Driver',
      email: 'test@example.com',
      phone: '+35799123456',
      dateOfBirth: '1985-05-15',
    },
    licenseYears: 10,
    licenseType: 'Full',
    licenseIssuedIn: 'Cyprus',
    hasClaims: false,
    claimsDetails: '',
    claimsCountLast5Years: '',
    claimsTotalCostLast5Years: '',
    maxFaultClaimCostLast5Years: '',
    hasConvictions: false,
    convictionsDetails: '',
    hasMajorConvictionLast5Years: null,
    convictionClass: '',
    majorConvictionWithinYears: '',
    hasAdditionalDrivers: false,
    youngestDriverAge: '',
    otherDriversClaims: false,
    otherDriversClaimsDetails: '',
    otherDriversConvictions: false,
    otherDriversConvictionsDetails: '',
    vehicleLocation: 'Cyprus',
    coverRequired: 'Comprehensive',
    renewalDate: '',
    vehicleType: 'Car',
    motorcycleRidersNamed: null,
    classicIsGenuine: null,
    classicIsSecondaryVehicle: null,
    make: 'Toyota',
    model: 'Yaris',
    cabrio: 'No',
    fuelType: 'Petrol',
    kmsPerYear: '10000',
    year: 2019,
    countryOfRegistration: 'Cyprus',
    registrationNumber: 'ABC123',
    vin: '',
    numberOfSeats: 5,
    modified: false,
    modificationsDetails: '',
    parking: 'Driveway',
    parkingOther: '',
    garageTotalValue: '',
    engineSize: 1800,
    vehicleValue: 20000,
    ncb: '5+ Years',
    protectNCB: false,
    vehicleUse: 'Private',
    businessUseDetails: '',
    requiredExcess: '300',
    homeInsuranceRenewalDate: '',
    infoTrueAndAccurate: true,
    fairProcessingAccepted: true,
    ...overrides,
  };
}

describe('driverRestrictionMinAge', () => {
  it('returns null for named-mode restrictions (no blanket age gate)', () => {
    expect(driverRestrictionMinAge('POLICYHOLDER_ONLY')).toBeNull();
    expect(driverRestrictionMinAge('NAMED_DRIVERS')).toBeNull();
  });

  it('returns 25 for ANY_DRIVER_25_PLUS and 40 for ANY_DRIVER_40_PLUS', () => {
    expect(driverRestrictionMinAge('ANY_DRIVER_25_PLUS')).toBe(25);
    expect(driverRestrictionMinAge('ANY_DRIVER_40_PLUS')).toBe(40);
  });

  it('returns null for unknown / legacy values (no silent default)', () => {
    expect(driverRestrictionMinAge('UNKNOWN')).toBeNull();
    expect(driverRestrictionMinAge(undefined)).toBeNull();
    expect(driverRestrictionMinAge(null)).toBeNull();
  });
});

describe('resolveDriverPricingBasis (ABY-232 projection)', () => {
  it('projects POLICYHOLDER_ONLY and NAMED_DRIVERS to NAMED_DRIVERS basis', () => {
    expect(resolveDriverPricingBasis(quoteWith({ driverRestriction: 'POLICYHOLDER_ONLY' }))).toBe('NAMED_DRIVERS');
    expect(resolveDriverPricingBasis(quoteWith({ driverRestriction: 'NAMED_DRIVERS' }))).toBe('NAMED_DRIVERS');
  });

  it('projects ANY_DRIVER_25_PLUS and ANY_DRIVER_40_PLUS to OPEN_DRIVERS basis', () => {
    expect(resolveDriverPricingBasis(quoteWith({ driverRestriction: 'ANY_DRIVER_25_PLUS' }))).toBe('OPEN_DRIVERS');
    expect(resolveDriverPricingBasis(quoteWith({ driverRestriction: 'ANY_DRIVER_40_PLUS' }))).toBe('OPEN_DRIVERS');
  });

  it('honours legacy `driverPricingBasis` when no `driverRestriction` is set', () => {
    expect(resolveDriverPricingBasis(quoteWith({ driverPricingBasis: 'OPEN_DRIVERS' }))).toBe('OPEN_DRIVERS');
    expect(resolveDriverPricingBasis(quoteWith({ driverPricingBasis: 'NAMED_DRIVERS' }))).toBe('NAMED_DRIVERS');
  });

  it('defaults to NAMED_DRIVERS when neither field is set (historical default)', () => {
    expect(resolveDriverPricingBasis(quoteWith({}))).toBe('NAMED_DRIVERS');
  });

  it('prefers `driverRestriction` over a legacy `driverPricingBasis` when both are present', () => {
    expect(resolveDriverPricingBasis(quoteWith({
      driverRestriction: 'ANY_DRIVER_25_PLUS',
      driverPricingBasis: 'NAMED_DRIVERS',
    }))).toBe('OPEN_DRIVERS');
  });
});

describe('namedDriversDiscountFactor', () => {
  it('applies the scheme −15% for NAMED_DRIVERS, no discount for OPEN_DRIVERS', () => {
    expect(namedDriversDiscountFactor('NAMED_DRIVERS')).toBeCloseTo(0.85, 4);
    expect(namedDriversDiscountFactor('OPEN_DRIVERS')).toBeCloseTo(1.0, 4);
  });
});

describe('openDriverAgeBandDiscountFactor', () => {
  it('applies Peter-approved −7.5% discount only for ANY_DRIVER_40_PLUS', () => {
    expect(openDriverAgeBandDiscountFactor('ANY_DRIVER_40_PLUS')).toBeCloseTo(0.925, 4);
    expect(openDriverAgeBandDiscountFactor('ANY_DRIVER_25_PLUS')).toBeCloseTo(1.0, 4);
    expect(openDriverAgeBandDiscountFactor('NAMED_DRIVERS')).toBeCloseTo(1.0, 4);
    expect(openDriverAgeBandDiscountFactor('POLICYHOLDER_ONLY')).toBeCloseTo(1.0, 4);
  });
});

describe('addedDriversUnder25FactorWithRestriction', () => {
  it('matches the scheme ladder in NAMED_DRIVERS mode (21=3.0, 22=2.5, 23=2.25, 24=1.9)', () => {
    expect(addedDriversUnder25FactorWithRestriction('NAMED_DRIVERS', true, 21)).toBeCloseTo(3.0);
    expect(addedDriversUnder25FactorWithRestriction('NAMED_DRIVERS', true, 22)).toBeCloseTo(2.5);
    expect(addedDriversUnder25FactorWithRestriction('NAMED_DRIVERS', true, 23)).toBeCloseTo(2.25);
    expect(addedDriversUnder25FactorWithRestriction('NAMED_DRIVERS', true, 24)).toBeCloseTo(1.9);
  });

  it('collapses to 1.0 in POLICYHOLDER_ONLY (no additional drivers possible)', () => {
    expect(addedDriversUnder25FactorWithRestriction('POLICYHOLDER_ONLY', false, 0)).toBe(1.0);
  });

  it('collapses to 1.0 in open modes regardless of stale hasAdditionalDrivers/youngestAge values', () => {
    // Even if a stale `hasAdditionalDrivers=true` and youngest=22 leaks
    // through, the open-mode restriction excludes under-25 drivers so
    // the loading must not apply.
    expect(addedDriversUnder25FactorWithRestriction('ANY_DRIVER_25_PLUS', true, 22)).toBe(1.0);
    expect(addedDriversUnder25FactorWithRestriction('ANY_DRIVER_40_PLUS', true, 22)).toBe(1.0);
  });

  it('matches the legacy scheme factor when the restriction is unknown (back-compat)', () => {
    // Legacy quotes without `driverRestriction` go through the legacy
    // factor (delegated path). Behaviour must be identical to the
    // direct function for the named-drivers shape.
    expect(addedDriversUnder25FactorWithRestriction(undefined, true, 23)).toBe(
      addedDriversUnder25FactorFromScheme(true, 23),
    );
  });
});
