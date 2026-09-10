import { describe, it, expect } from 'vitest';
import { evaluateMotorUwAutomation } from '../motorUwAutomation.js';
import type { QuoteData } from '../../../../platform/types/autoInsurance.js';

/**
 * Minimal compliant car QuoteData. Overrides target specific scenarios.
 * DOB produces a 35-year-old proposer at test-run time (within ±1 year is fine
 * for these behavioural tests — none of these cases depend on the exact year).
 */
function baseCarQuote(overrides: Partial<QuoteData> = {}): QuoteData {
  const q: QuoteData = {
    proposer: { firstName: 'Test', lastName: 'Driver', email: 't@example.com', dateOfBirth: '1989-06-01' },
    licenseType: 'Full',
    licenseYears: 10,
    licenseIssuedIn: 'Cyprus',
    hasClaims: false,
    claimsDetails: '',
    claimsCountLast5Years: 0,
    claimsTotalCostLast5Years: 0,
    maxFaultClaimCostLast5Years: 0,
    hasConvictions: false,
    convictionsDetails: '',
    hasMajorConvictionLast5Years: null,
    convictionClass: '',
    majorConvictionWithinYears: 0,
    hasAdditionalDrivers: false,
    youngestDriverAge: 0,
    otherDriversClaims: false,
    otherDriversClaimsDetails: '',
    otherDriversConvictions: false,
    otherDriversConvictionsDetails: '',
    vehicleLocation: 'Cyprus',
    countryOfRegistration: 'Cyprus',
    coverRequired: 'Comprehensive',
    renewalDate: '2026-06-01',
    vehicleType: 'Car',
    motorcycleRidersNamed: null,
    classicIsGenuine: null,
    classicIsSecondaryVehicle: null,
    make: 'Toyota',
    model: 'Corolla',
    cabrio: 'No',
    fuelType: 'Petrol',
    kmsPerYear: '10000',
    year: 2020,
    registrationNumber: 'ABC123',
    vin: '',
    numberOfSeats: 5,
    modified: false,
    modificationsDetails: '',
    parking: 'Garage',
    parkingOther: '',
    garageTotalValue: 0,
    engineSize: 1400,
    vehicleValue: 15_000,
    ncb: '3 Years',
    protectNCB: false,
    vehicleUse: 'Private',
    businessUseDetails: '',
    requiredExcess: '400',
    homeInsuranceRenewalDate: '',
    infoTrueAndAccurate: true,
    fairProcessingAccepted: true,
    ...overrides,
  };
  return q;
}

/** Builds a compliant motorcycle base that should produce no RED triggers. */
function baseMotorcycleQuote(overrides: Partial<QuoteData> = {}): QuoteData {
  return baseCarQuote({
    vehicleType: 'Motorbike',
    engineSize: 500,
    ncb: '3 Years',
    coverRequired: 'Comprehensive',
    motorcycleRidersNamed: true,
    vehicleValue: 8_000,
    ...overrides,
  });
}

// ─── Motorcycle: rider age ─────────────────────────────────────────────────

describe('RED.MOTORCYCLE_RIDER_UNDER_25', () => {
  it('declines (RED) when main motorcycle rider is under 25', () => {
    // DOB 3 years ago → age ~3, well under 25
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 22);
    const result = evaluateMotorUwAutomation(
      baseMotorcycleQuote({ proposer: { firstName: 'Y', lastName: 'R', email: 'y@r.com', dateOfBirth: dob.toISOString().slice(0, 10) } }),
    );
    expect(result.outcome).toBe('decline');
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_RIDER_UNDER_25')).toBe(true);
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_RIDER_UNDER_25' && t.lane === 'red')).toBe(true);
  });

  it('declines (RED) when added motorcycle rider is under 25', () => {
    const result = evaluateMotorUwAutomation(
      baseMotorcycleQuote({ hasAdditionalDrivers: true, youngestDriverAge: 22 }),
    );
    expect(result.outcome).toBe('decline');
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_RIDER_UNDER_25_AAD' && t.lane === 'red')).toBe(true);
  });

  it('does NOT fire the under-25 rule when main rider is exactly 25', () => {
    const startDate = new Date();
    const dob = new Date(startDate);
    dob.setUTCFullYear(dob.getUTCFullYear() - 25);
    const result = evaluateMotorUwAutomation(
      baseMotorcycleQuote({
        renewalDate: startDate.toISOString().slice(0, 10),
        proposer: { firstName: 'B', lastName: 'R', email: 'b@r.com', dateOfBirth: dob.toISOString().slice(0, 10) },
      }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_RIDER_UNDER_25')).toBe(false);
  });
});

describe('proposer age upper bound', () => {
  it('does NOT refer private motor risks solely because the proposer is over 85', () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 86);
    const result = evaluateMotorUwAutomation(
      baseCarQuote({
        proposer: {
          firstName: 'Older',
          lastName: 'Driver',
          email: 'older@example.com',
          dateOfBirth: dob.toISOString().slice(0, 10),
        },
      }),
    );
    expect(result.outcome).toBe('accept');
    expect(result.triggers?.some((t) => t.ruleId === 'RED.PROPOSER_AGE_OVER_85')).toBe(false);
  });
});

describe('vehicle referral requirements from EV directive', () => {
  it('refers electric vehicles before quote', () => {
    const result = evaluateMotorUwAutomation(baseCarQuote({ fuelType: 'Electric', batteryKWh: 60 }));
    expect(result.outcome).toBe('referral');
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.EV_REFERRAL' && t.lane === 'yellow')).toBe(true);
  });

  it('refers hybrid vehicles before quote', () => {
    const result = evaluateMotorUwAutomation(baseCarQuote({ fuelType: 'Hybrid' }));
    expect(result.outcome).toBe('referral');
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.HYBRID_REFERRAL' && t.lane === 'yellow')).toBe(true);
  });

  it('refers otherwise compliant motorcycles before quote', () => {
    const result = evaluateMotorUwAutomation(baseMotorcycleQuote());
    expect(result.outcome).toBe('referral');
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.MOTORCYCLE_REFERRAL' && t.lane === 'yellow')).toBe(true);
  });

  it('refers otherwise compliant motorhomes before quote', () => {
    const result = evaluateMotorUwAutomation(
      baseCarQuote({ vehicleType: 'Motorcaravan', vehicleValue: 25_000, kmsPerYear: '20,000' }),
    );
    expect(result.outcome).toBe('referral');
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.MOTORCARAVAN_REFERRAL' && t.lane === 'yellow')).toBe(true);
  });

  it('allows program metadata to opt out of the directive flags', () => {
    const result = evaluateMotorUwAutomation(baseCarQuote({ fuelType: 'Electric', batteryKWh: 60 }), {
      referralFlags: {
        referElectricVehicles: false,
        referHybridVehicles: true,
        referMotorcycle: true,
        referMotorcaravan: true,
      },
    });
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.EV_REFERRAL')).toBe(false);
  });
});

describe('YELLOW.PROPOSER_UNDER_25', () => {
  it('uses the policy start date when the proposer turns 25 on inception', () => {
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() + 1);
    const dob = new Date(startDate);
    dob.setUTCFullYear(dob.getUTCFullYear() - 25);

    const result = evaluateMotorUwAutomation(
      baseCarQuote({
        renewalDate: startDate.toISOString().slice(0, 10),
        proposer: {
          firstName: 'Birthday',
          lastName: 'Driver',
          email: 'birthday@example.com',
          dateOfBirth: dob.toISOString().slice(0, 10),
        },
      }),
    );

    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.PROPOSER_UNDER_25')).toBe(false);
  });
});

describe('YELLOW.STP_AGE_NOT_MET', () => {
  it('accepts a private motor risk when the proposer turns exactly 30 today', () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 30);
    const result = evaluateMotorUwAutomation(
      baseCarQuote({
        renewalDate: new Date().toISOString().slice(0, 10),
        proposer: {
          firstName: 'Thirty',
          lastName: 'Today',
          email: 'thirty@example.com',
          dateOfBirth: dob.toISOString().slice(0, 10),
        },
      }),
    );

    expect(result.outcome).toBe('accept');
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.STP_AGE_NOT_MET')).toBe(false);
  });

  it('refers a private motor risk when the proposer is still 29', () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 30);
    dob.setDate(dob.getDate() + 1);
    const result = evaluateMotorUwAutomation(
      baseCarQuote({
        proposer: {
          firstName: 'TwentyNine',
          lastName: 'Tomorrow',
          email: 'twenty-nine@example.com',
          dateOfBirth: dob.toISOString().slice(0, 10),
        },
      }),
    );

    expect(result.outcome).toBe('referral');
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.STP_AGE_NOT_MET' && t.lane === 'yellow')).toBe(true);
  });
});

// ─── Motorcycle: SD&P-only use (ABY-323) ──────────────────────────────────

describe('RED.MOTORCYCLE_USE_NOT_SDP', () => {
  it('accepts a motorbike on SD&P use', () => {
    const result = evaluateMotorUwAutomation(baseMotorcycleQuote({ vehicleUse: 'SD&P' }));
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_USE_NOT_SDP')).toBe(false);
  });

  it('accepts a motorbike on the legacy "Private" use value', () => {
    const result = evaluateMotorUwAutomation(baseMotorcycleQuote({ vehicleUse: 'Private' }));
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_USE_NOT_SDP')).toBe(false);
  });

  it('declines (RED) a motorbike on a business/haulage class', () => {
    const result = evaluateMotorUwAutomation(baseMotorcycleQuote({ vehicleUse: 'Class 3' }));
    expect(result.outcome).toBe('decline');
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_USE_NOT_SDP' && t.lane === 'red')).toBe(true);
  });
});

// ─── Motorcycle: open-driver coverage not allowed (ABY-324) ────────────────

describe('RED.MOTORCYCLE_OPEN_DRIVER_NOT_ALLOWED', () => {
  it('declines (RED) a motorbike on Any Driver Over 25', () => {
    const result = evaluateMotorUwAutomation(
      baseMotorcycleQuote({ driverRestriction: 'ANY_DRIVER_25_PLUS' }),
    );
    expect(result.outcome).toBe('decline');
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_OPEN_DRIVER_NOT_ALLOWED' && t.lane === 'red')).toBe(true);
  });

  it('accepts a motorbike on a named-driver basis', () => {
    const result = evaluateMotorUwAutomation(
      baseMotorcycleQuote({ driverRestriction: 'NAMED_DRIVERS' }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_OPEN_DRIVER_NOT_ALLOWED')).toBe(false);
  });
});

// ─── Motorcycle: over 200cc no NCD ────────────────────────────────────────

describe('RED.MOTORCYCLE_OVER_200CC_NO_NCD', () => {
  it('declines (RED) for motorcycle over 200cc with no NCD', () => {
    const result = evaluateMotorUwAutomation(
      baseMotorcycleQuote({ engineSize: 250, ncb: 'None' }),
    );
    expect(result.outcome).toBe('decline');
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_OVER_200CC_NO_NCD' && t.lane === 'red')).toBe(true);
  });

  it('does NOT fire for motorcycle ≤200cc with no NCD', () => {
    const result = evaluateMotorUwAutomation(
      baseMotorcycleQuote({ engineSize: 125, ncb: 'None' }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_OVER_200CC_NO_NCD')).toBe(false);
  });

  it('does NOT fire for motorcycle over 200cc WITH NCD', () => {
    const result = evaluateMotorUwAutomation(
      baseMotorcycleQuote({ engineSize: 600, ncb: '3 Years' }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_OVER_200CC_NO_NCD')).toBe(false);
  });
});

// ─── Motorcycle: cover type ────────────────────────────────────────────────

describe('RED.MOTORCYCLE_NON_COMPREHENSIVE_COVER', () => {
  it('declines (RED) when motorcycle cover is Third Party Liability', () => {
    const result = evaluateMotorUwAutomation(
      baseMotorcycleQuote({ coverRequired: 'Third Party Liability' }),
    );
    expect(result.outcome).toBe('decline');
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_NON_COMPREHENSIVE_COVER' && t.lane === 'red')).toBe(true);
  });

  it('does NOT fire when motorcycle cover is Comprehensive', () => {
    const result = evaluateMotorUwAutomation(
      baseMotorcycleQuote({ coverRequired: 'Comprehensive' }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_NON_COMPREHENSIVE_COVER')).toBe(false);
  });
});

// ─── Motorcycle: named riders ──────────────────────────────────────────────

describe('RED.MOTORCYCLE_RIDERS_NOT_NAMED', () => {
  it('declines (RED) when motorcycleRidersNamed is explicitly false', () => {
    const result = evaluateMotorUwAutomation(
      baseMotorcycleQuote({ motorcycleRidersNamed: false }),
    );
    expect(result.outcome).toBe('decline');
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_RIDERS_NOT_NAMED' && t.lane === 'red')).toBe(true);
  });

  it('refers (YELLOW) when motorcycleRidersNamed is null (not confirmed)', () => {
    const result = evaluateMotorUwAutomation(
      baseMotorcycleQuote({ motorcycleRidersNamed: null }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.MOTORCYCLE_RIDERS_NAMED_UNKNOWN' && t.lane === 'yellow')).toBe(true);
  });

  it('does NOT fire when motorcycleRidersNamed is true', () => {
    const result = evaluateMotorUwAutomation(
      baseMotorcycleQuote({ motorcycleRidersNamed: true }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_RIDERS_NOT_NAMED')).toBe(false);
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.MOTORCYCLE_RIDERS_NAMED_UNKNOWN')).toBe(false);
  });
});

// ─── Motorcycle: named-riders and cover rules are motorcycle-only ──────────

describe('motorcycle rules do not fire for standard car risks', () => {
  it('RED.MOTORCYCLE_NON_COMPREHENSIVE_COVER does not fire for a car with TPL cover', () => {
    const result = evaluateMotorUwAutomation(
      baseCarQuote({ coverRequired: 'Third Party Liability' }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'RED.MOTORCYCLE_NON_COMPREHENSIVE_COVER')).toBe(false);
  });

  it('YELLOW.MOTORCYCLE_RIDERS_NAMED_UNKNOWN does not fire for a car with null motorcycleRidersNamed', () => {
    const result = evaluateMotorUwAutomation(
      baseCarQuote({ motorcycleRidersNamed: null }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.MOTORCYCLE_RIDERS_NAMED_UNKNOWN')).toBe(false);
  });
});

// ─── Seats over 15 ────────────────────────────────────────────────────────

describe('YELLOW.SEATS_OVER_15', () => {
  it('refers (YELLOW) when numberOfSeats is 16', () => {
    const result = evaluateMotorUwAutomation(baseCarQuote({ numberOfSeats: 16 }));
    expect(result.outcome).toBe('referral');
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.SEATS_OVER_15' && t.lane === 'yellow')).toBe(true);
  });

  it('does NOT fire for exactly 15 seats', () => {
    const result = evaluateMotorUwAutomation(baseCarQuote({ numberOfSeats: 15 }));
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.SEATS_OVER_15')).toBe(false);
  });

  it('does NOT fire when numberOfSeats is 0 (not set)', () => {
    const result = evaluateMotorUwAutomation(baseCarQuote({ numberOfSeats: 0 }));
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.SEATS_OVER_15')).toBe(false);
  });
});

// ─── Serious technical multiple convictions ───────────────────────────────

describe('YELLOW.SERIOUS_TECHNICAL_MULTIPLE', () => {
  it('refers (YELLOW) when serious_technical count is 2', () => {
    const result = evaluateMotorUwAutomation(
      baseCarQuote({
        hasConvictions: true,
        convictionClass: 'serious_technical',
        hasMajorConvictionLast5Years: false,
        ...(({ seriousTechnicalOffenceCount: 2 } as unknown) as Partial<QuoteData>),
      }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.SERIOUS_TECHNICAL_MULTIPLE' && t.lane === 'yellow')).toBe(true);
  });

  it('does NOT refer for count of exactly 1 (single offence is priced, not referred)', () => {
    const result = evaluateMotorUwAutomation(
      baseCarQuote({
        hasConvictions: true,
        convictionClass: 'serious_technical',
        hasMajorConvictionLast5Years: false,
        ...(({ seriousTechnicalOffenceCount: 1 } as unknown) as Partial<QuoteData>),
      }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.SERIOUS_TECHNICAL_MULTIPLE')).toBe(false);
  });

  it('does NOT refer when convictionClass is not serious_technical', () => {
    const result = evaluateMotorUwAutomation(
      baseCarQuote({
        hasConvictions: true,
        convictionClass: 'minor_offence_10',
        hasMajorConvictionLast5Years: false,
      }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.SERIOUS_TECHNICAL_MULTIPLE')).toBe(false);
  });
});

// ─── Motorcaravan referral threshold ──────────────────────────────────────

describe('YELLOW.MOTORCARAVAN_OVER_30K', () => {
  it('refers (YELLOW) motorcaravan valued at €30,001', () => {
    const result = evaluateMotorUwAutomation(
      baseCarQuote({ vehicleType: 'Motorcaravan', vehicleValue: 30_001 }),
    );
    expect(result.outcome).toBe('referral');
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.MOTORCARAVAN_OVER_30K' && t.lane === 'yellow')).toBe(true);
  });

  it('does NOT refer motorcaravan valued at exactly €30,000', () => {
    const result = evaluateMotorUwAutomation(
      baseCarQuote({ vehicleType: 'Motorcaravan', vehicleValue: 30_000 }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.MOTORCARAVAN_OVER_30K')).toBe(false);
  });

  it('does NOT refer motorcaravan valued at €25,000 (comfortably under threshold)', () => {
    const result = evaluateMotorUwAutomation(
      baseCarQuote({ vehicleType: 'Motorcaravan', vehicleValue: 25_000 }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.MOTORCARAVAN_OVER_30K')).toBe(false);
  });
});

describe('YELLOW.MOTORCARAVAN_KM_OVER_30K', () => {
  it('refers (YELLOW) motorcaravan on the "Over 30,000" mileage band', () => {
    const result = evaluateMotorUwAutomation(
      baseCarQuote({ vehicleType: 'Motorcaravan', kmsPerYear: 'Over 30,000' }),
    );
    expect(result.outcome).toBe('referral');
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.MOTORCARAVAN_KM_OVER_30K' && t.lane === 'yellow')).toBe(true);
  });

  it('does NOT refer motorcaravan on the "30,000" mileage band (exactly 30k)', () => {
    const result = evaluateMotorUwAutomation(
      baseCarQuote({ vehicleType: 'Motorcaravan', kmsPerYear: '30,000' }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.MOTORCARAVAN_KM_OVER_30K')).toBe(false);
  });

  it('does NOT refer motorcaravan on the "20,000" mileage band', () => {
    const result = evaluateMotorUwAutomation(
      baseCarQuote({ vehicleType: 'Motorcaravan', kmsPerYear: '20,000' }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.MOTORCARAVAN_KM_OVER_30K')).toBe(false);
  });

  it('does NOT apply the mileage referral to a non-motorcaravan on the over-30k band', () => {
    const result = evaluateMotorUwAutomation(
      baseCarQuote({ vehicleType: 'Car', kmsPerYear: 'Over 30,000' }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.MOTORCARAVAN_KM_OVER_30K')).toBe(false);
  });
});

// ─── ABY-360: modified vehicle ─────────────────────────────────────────────

describe('YELLOW.VEHICLE_MODIFIED', () => {
  it('refers (YELLOW) when the vehicle is modified', () => {
    const result = evaluateMotorUwAutomation(
      baseCarQuote({ modified: true, modificationsDetails: 'Aftermarket exhaust + remap' }),
    );
    expect(result.outcome).toBe('referral');
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.VEHICLE_MODIFIED' && t.lane === 'yellow')).toBe(true);
  });

  it('does NOT refer an unmodified vehicle', () => {
    const result = evaluateMotorUwAutomation(baseCarQuote({ modified: false }));
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.VEHICLE_MODIFIED')).toBe(false);
  });
});

describe('YELLOW.LOCAL_MARKET_NATIONALITY_REFERRAL (must never regress)', () => {
  function proposerWithNationality(nationality: string): QuoteData['proposer'] {
    const proposer: QuoteData['proposer'] = {
      firstName: 'Test',
      lastName: 'Driver',
      email: 't@example.com',
      dateOfBirth: '1989-06-01',
      nationality,
    };
    return proposer;
  }

  it.each(['Cyprus', 'Portugal', 'Greece'] as const)(
    'refers %s nationals in their same operating market',
    (nationality) => {
      const result = evaluateMotorUwAutomation(
        baseCarQuote({ countryOfRegistration: nationality, proposer: proposerWithNationality(nationality) }),
      );
      expect(
        result.triggers?.some((t) => t.ruleId === 'YELLOW.LOCAL_MARKET_NATIONALITY_REFERRAL' && t.lane === 'yellow'),
      ).toBe(true);
    },
  );

  it('does not refer approved CY/PT cross-market expats', () => {
    const portugueseInCyprus = evaluateMotorUwAutomation(
      baseCarQuote({ countryOfRegistration: 'Cyprus', proposer: proposerWithNationality('Portugal') }),
    );
    expect(portugueseInCyprus.triggers?.some((t) => t.ruleId === 'YELLOW.LOCAL_MARKET_NATIONALITY_REFERRAL')).toBe(false);

    const cypriotInPortugal = evaluateMotorUwAutomation(
      baseCarQuote({ countryOfRegistration: 'Portugal', proposer: proposerWithNationality('Cyprus') }),
    );
    expect(cypriotInPortugal.triggers?.some((t) => t.ruleId === 'YELLOW.LOCAL_MARKET_NATIONALITY_REFERRAL')).toBe(false);

    const greekInCyprus = evaluateMotorUwAutomation(
      baseCarQuote({ countryOfRegistration: 'Cyprus', proposer: proposerWithNationality('Greece') }),
    );
    expect(greekInCyprus.triggers?.some((t) => t.ruleId === 'YELLOW.LOCAL_MARKET_NATIONALITY_REFERRAL')).toBe(false);
  });

  it('does not refer Spanish or Italian same-market nationals under the clarified live-market rule', () => {
    const spanishInSpain = evaluateMotorUwAutomation(
      baseCarQuote({ countryOfRegistration: 'Spain', proposer: proposerWithNationality('Spain') }),
    );
    expect(spanishInSpain.triggers?.some((t) => t.ruleId === 'YELLOW.LOCAL_MARKET_NATIONALITY_REFERRAL')).toBe(false);

    const italianInItaly = evaluateMotorUwAutomation(
      baseCarQuote({ countryOfRegistration: 'Italy', proposer: proposerWithNationality('Italy') }),
    );
    expect(italianInItaly.triggers?.some((t) => t.ruleId === 'YELLOW.LOCAL_MARKET_NATIONALITY_REFERRAL')).toBe(false);
  });

  it('does not refer UK (expat) nationals', () => {
    const result = evaluateMotorUwAutomation(
      baseCarQuote({ proposer: proposerWithNationality('United Kingdom') }),
    );
    expect(result.triggers?.some((t) => t.ruleId === 'YELLOW.LOCAL_MARKET_NATIONALITY_REFERRAL')).toBe(false);
  });
});
