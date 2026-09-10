import { describe, it, expect } from 'vitest';
import {
  proposerAgeFactorFromScheme,
  motorcycleRiderAgeFactorFromWorkbook,
  convictionFactorFromScheme,
  protectedNcdPremiumFactor,
} from '../abbeygateFactors.js';
import type { QuoteData } from '../../../../../platform/types/autoInsurance.js';
import { loadAbbeygateAutoCyprus2022Matrix } from '../../data/loader.js';

const motorMatrix = loadAbbeygateAutoCyprus2022Matrix();
const factorBands = motorMatrix.factors;

/** Fully-typed minimal QuoteData for factor unit tests. Spread overrides to target a specific scenario. */
function baseQuote(overrides: Partial<QuoteData> = {}): QuoteData {
  const q: QuoteData = {
    proposer: { firstName: 'T', lastName: 'T', email: 't@t.com', dateOfBirth: '1989-06-01' },
    licenseType: 'Full', licenseYears: 10, licenseIssuedIn: 'Cyprus',
    hasClaims: false, claimsDetails: '', claimsCountLast5Years: 0,
    claimsTotalCostLast5Years: 0, maxFaultClaimCostLast5Years: 0,
    hasConvictions: false, convictionsDetails: '', hasMajorConvictionLast5Years: null,
    convictionClass: '', majorConvictionWithinYears: 0,
    hasAdditionalDrivers: false, youngestDriverAge: 0,
    otherDriversClaims: false, otherDriversClaimsDetails: '',
    otherDriversConvictions: false, otherDriversConvictionsDetails: '',
    vehicleLocation: 'Cyprus', countryOfRegistration: 'Cyprus',
    coverRequired: 'Comprehensive', renewalDate: '2026-06-01',
    vehicleType: 'Car', motorcycleRidersNamed: null,
    classicIsGenuine: null, classicIsSecondaryVehicle: null,
    make: 'Toyota', model: 'Corolla', cabrio: 'No', fuelType: 'Petrol',
    kmsPerYear: '10000', year: 2020, registrationNumber: 'ABC123', vin: '',
    numberOfSeats: 5, modified: false, modificationsDetails: '',
    parking: 'Garage', parkingOther: '', garageTotalValue: 0, engineSize: 1400,
    vehicleValue: 15_000, ncb: '3 Years', protectNCB: false,
    vehicleUse: 'Private', businessUseDetails: '', requiredExcess: '400',
    homeInsuranceRenewalDate: '', infoTrueAndAccurate: true, fairProcessingAccepted: true,
    ...overrides,
  };
  return q;
}

// ─── Proposer age factor ──────────────────────────────────────────────────

describe('proposerAgeFactorFromScheme', () => {
  it('applies +22.55% for proposer aged exactly 25 (confirmed by UW rating guide)', () => {
    expect(proposerAgeFactorFromScheme(25, factorBands.proposerAge)).toBeCloseTo(1.2255, 4);
  });

  it('maintains the correct ladder: 28–30 +12%, 26–27 +17.5%, 25 +22.55%', () => {
    expect(proposerAgeFactorFromScheme(29, factorBands.proposerAge)).toBeCloseTo(1.12, 4);
    expect(proposerAgeFactorFromScheme(27, factorBands.proposerAge)).toBeCloseTo(1.175, 4);
    expect(proposerAgeFactorFromScheme(25, factorBands.proposerAge)).toBeCloseTo(1.2255, 4);
  });

  it('applies -10% for proposer over 40', () => {
    expect(proposerAgeFactorFromScheme(50, factorBands.proposerAge)).toBeCloseTo(0.9, 4);
  });

  it('applies +20% for proposer aged 80 or over', () => {
    expect(proposerAgeFactorFromScheme(80, factorBands.proposerAge)).toBeCloseTo(1.2, 4);
    expect(proposerAgeFactorFromScheme(85, factorBands.proposerAge)).toBeCloseTo(1.2, 4);
  });

  it('applies rate (1.0) for proposer over 30 and up to 40', () => {
    expect(proposerAgeFactorFromScheme(35, factorBands.proposerAge)).toBe(1.0);
  });
});

// ─── Motorcycle rider age factor ──────────────────────────────────────────

describe('motorcycleRiderAgeFactorFromWorkbook', () => {
  it('applies -12.5% for rider over 45', () => {
    expect(motorcycleRiderAgeFactorFromWorkbook(46, motorMatrix.motorcycle.riderAgeFactors)).toBeCloseTo(0.875, 4);
    expect(motorcycleRiderAgeFactorFromWorkbook(55, motorMatrix.motorcycle.riderAgeFactors)).toBeCloseTo(0.875, 4);
  });

  it('applies standard rate for rider aged 31–45', () => {
    expect(motorcycleRiderAgeFactorFromWorkbook(40, motorMatrix.motorcycle.riderAgeFactors)).toBe(1.0);
    expect(motorcycleRiderAgeFactorFromWorkbook(31, motorMatrix.motorcycle.riderAgeFactors)).toBe(1.0);
  });

  it('applies +150% for rider aged 27–30', () => {
    expect(motorcycleRiderAgeFactorFromWorkbook(27, motorMatrix.motorcycle.riderAgeFactors)).toBeCloseTo(2.5, 4);
    expect(motorcycleRiderAgeFactorFromWorkbook(30, motorMatrix.motorcycle.riderAgeFactors)).toBeCloseTo(2.5, 4);
  });

  it('applies +300% for rider aged 25–26', () => {
    expect(motorcycleRiderAgeFactorFromWorkbook(25, motorMatrix.motorcycle.riderAgeFactors)).toBeCloseTo(4.0, 4);
    expect(motorcycleRiderAgeFactorFromWorkbook(26, motorMatrix.motorcycle.riderAgeFactors)).toBeCloseTo(4.0, 4);
  });

  it('returns 1.0 for rider under 25 (no-quote handled separately by UW automation)', () => {
    expect(motorcycleRiderAgeFactorFromWorkbook(22, motorMatrix.motorcycle.riderAgeFactors)).toBe(1.0);
  });

  it('returns 1.0 for invalid age', () => {
    expect(motorcycleRiderAgeFactorFromWorkbook(0, motorMatrix.motorcycle.riderAgeFactors)).toBe(1.0);
    expect(motorcycleRiderAgeFactorFromWorkbook(NaN, motorMatrix.motorcycle.riderAgeFactors)).toBe(1.0);
  });
});

// ─── Conviction factor — serious technical ────────────────────────────────

describe('convictionFactorFromScheme — serious_technical', () => {
  const oneOffence = baseQuote({ hasConvictions: true, convictionClass: 'serious_technical' });
  const twoOffences = baseQuote({ hasConvictions: true, convictionClass: 'serious_technical', ...{ seriousTechnicalOffenceCount: 2 } });
  const threeOffences = baseQuote({ hasConvictions: true, convictionClass: 'serious_technical', ...{ seriousTechnicalOffenceCount: 3 } });
  const noConvictions = baseQuote({ hasConvictions: false });

  it('applies +15% for one serious technical offence', () => {
    expect(convictionFactorFromScheme(oneOffence, factorBands.convictions)).toBeCloseTo(1.15, 4);
  });

  it('still applies +15% for count >= 2 (referral handles the rest — no +70% tier)', () => {
    expect(convictionFactorFromScheme(twoOffences, factorBands.convictions)).toBeCloseTo(1.15, 4);
    expect(convictionFactorFromScheme(threeOffences, factorBands.convictions)).toBeCloseTo(1.15, 4);
  });

  it('returns 1.0 when hasConvictions is false', () => {
    expect(convictionFactorFromScheme(noConvictions, factorBands.convictions)).toBe(1.0);
  });
});

// ─── Protected NCD factor ─────────────────────────────────────────────────

describe('protectedNcdPremiumFactor', () => {
  const { discounts, protectedFactor } = factorBands.ncd;

  it('returns 1.1 when NCD protection is selected and client has NCD', () => {
    expect(protectedNcdPremiumFactor(true, '3 Years', discounts, protectedFactor)).toBeCloseTo(1.1, 4);
    expect(protectedNcdPremiumFactor(true, '5+ Years', discounts, protectedFactor)).toBeCloseTo(1.1, 4);
  });

  it('returns 1.0 when NCD protection is selected but there is no NCD to protect', () => {
    expect(protectedNcdPremiumFactor(true, 'None', discounts, protectedFactor)).toBe(1.0);
    expect(protectedNcdPremiumFactor(true, '', discounts, protectedFactor)).toBe(1.0);
  });

  it('returns 1.0 when NCD protection is not selected', () => {
    expect(protectedNcdPremiumFactor(false, '5+ Years', discounts, protectedFactor)).toBe(1.0);
    expect(protectedNcdPremiumFactor(false, 'None', discounts, protectedFactor)).toBe(1.0);
  });
});
