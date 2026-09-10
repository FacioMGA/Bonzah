import { describe, expect, it } from 'vitest';
import { applyVehicleEnrichment, markVehicleFieldAsUserEdited, normalizeVehicleEnrichmentQuoteData } from './vehicleEnrichmentMerge';
import type { QuoteData } from '../types';

function baseQuoteData(): QuoteData {
  return {
    proposer: {
      firstName: '',
      lastName: '',
      address: { line1: '', city: '', province: '', postcode: '', country: 'Cyprus' },
      phone: '',
      dateOfBirth: '',
      email: '',
      nationality: '',
      nif: '',
      occupation: '',
      whereDidYouHear: '',
      marketingConsent: false,
      privacyPolicyAccepted: false,
    },
    licenseYears: '',
    licenseType: '',
    licenseIssuedIn: '',
    hasClaims: null,
    claimsDetails: '',
    claimsCountLast5Years: '',
    claimsTotalCostLast5Years: '',
    maxFaultClaimCostLast5Years: '',
    hasConvictions: null,
    convictionsDetails: '',
    hasMajorConvictionLast5Years: null,
    convictionClass: '',
    majorConvictionWithinYears: '',
    hasAdditionalDrivers: null,
    additionalDrivers: [],
    youngestDriverAge: '',
    otherDriversClaims: false,
    otherDriversClaimsDetails: '',
    otherDriversConvictions: false,
    otherDriversConvictionsDetails: '',
    vehicleLocation: 'Cyprus',
    coverRequired: 'Comprehensive',
    renewalDate: '',
    vehicleType: '',
    motorcycleRidersNamed: true,
    classicIsGenuine: null,
    classicIsSecondaryVehicle: null,
    make: 'BMW',
    model: '320i',
    cabrio: '',
    fuelType: '',
    kmsPerYear: '',
    year: 2018,
    countryOfRegistration: '',
    registrationNumber: '',
    vin: '',
    numberOfSeats: 0,
    modified: null,
    modificationsDetails: '',
    parking: 'Drive',
    parkingOther: '',
    engineSize: 0,
    vehicleValue: 0,
    ncb: '',
    protectNCB: false,
    vehicleUse: '',
    requiredExcess: '',
    infoTrueAndAccurate: false,
    fairProcessingAccepted: false,
  };
}

describe('vehicleEnrichmentMerge', () => {
  it('fills empty fields and stores cardog meta', () => {
    const quoteData = baseQuoteData();
    const result = applyVehicleEnrichment({
      quoteData,
      enrichment: {
        source: 'cardog',
        variantId: 'v1',
        normalizedQuoteData: {
          fuelType: 'Petrol',
          engineSize: 1998,
          numberOfSeats: 5,
          cabrio: false,
        },
        fieldConfidence: {
          fuelType: 0.95,
          engineSize: 0.97,
          numberOfSeats: 0.98,
          cabrio: 0.93,
        },
      },
      onConflict: () => 'keep_mine',
    });

    expect(result.nextQuoteData.fuelType).toBe('Petrol');
    expect(result.nextQuoteData.engineSize).toBe(1998);
    expect(result.nextQuoteData.numberOfSeats).toBe(5);
    expect(result.nextQuoteData.cabrio).toBe('No');
    const meta = (result.nextQuoteData.__meta as { vehicleEnrichment?: Record<string, { source?: string }> } | undefined)?.vehicleEnrichment || {};
    expect(meta.fuelType?.source).toBe('cardog');
    expect(meta.engineSize?.source).toBe('cardog');
  });

  it('normalizes cabrio booleans into quote-safe Yes/No values', () => {
    const normalized = normalizeVehicleEnrichmentQuoteData({
      source: 'cardog',
      variantId: 'v-cabrio-no',
      normalizedQuoteData: {
        cabrio: false,
        engineSize: 1998,
      },
      fieldConfidence: {
        cabrio: 0.93,
        engineSize: 0.97,
      },
    });

    expect(normalized.cabrio).toBe('No');
    expect(normalized.engineSize).toBe(1998);
  });

  it('regression: trim fallback (backend cache miss) populates fuelType AND cabrio for an Audi A3 hatchback', () => {
    // This reproduces the bug captured in the BO + wizard screenshot where
    // numberOfSeats and engineSize were applied but fuelType and cabrio were
    // dropped after trim selection. The fix is that the wizard fallback
    // path now goes through `variantOptionToEnrichmentResult` →
    // `applyVehicleEnrichment`, the same canonical merge as the backend
    // success path, so the fields cannot diverge.
    const quoteData = baseQuoteData();
    const result = applyVehicleEnrichment({
      quoteData,
      enrichment: {
        source: 'cardog',
        variantId: 'audi-a3-2022',
        normalizedQuoteData: {
          make: 'Audi',
          model: 'A3',
          year: 2022,
          fuelType: 'Petrol',
          engineSize: 1984,
          numberOfSeats: 5,
          vehicleType: 'Car',
          cabrio: false,
        },
        fieldConfidence: {
          fuelType: 0.95,
          cabrio: 0.93,
          engineSize: 0.97,
          numberOfSeats: 0.98,
        },
      },
      onConflict: () => 'keep_mine',
    });

    expect(result.nextQuoteData.fuelType).toBe('Petrol');
    expect(result.nextQuoteData.cabrio).toBe('No');
    expect(result.nextQuoteData.engineSize).toBe(1984);
    expect(result.nextQuoteData.numberOfSeats).toBe(5);
    expect(result.appliedFields).toEqual(
      expect.arrayContaining(['fuelType', 'cabrio', 'engineSize', 'numberOfSeats']),
    );
  });

  it('does not silently overwrite user-edited fields when conflicts are rejected', () => {
    const q0 = baseQuoteData();
    const q1 = { ...q0, engineSize: 1600 };
    const q2 = markVehicleFieldAsUserEdited(q1, 'engineSize');

    const result = applyVehicleEnrichment({
      quoteData: q2,
      enrichment: {
        source: 'cardog',
        variantId: 'v2',
        normalizedQuoteData: { engineSize: 1998 },
        fieldConfidence: { engineSize: 0.97 },
      },
      onConflict: () => 'keep_mine',
    });

    expect(result.nextQuoteData.engineSize).toBe(1600);
    expect(result.conflictFields).toContain('engineSize');
  });
});
