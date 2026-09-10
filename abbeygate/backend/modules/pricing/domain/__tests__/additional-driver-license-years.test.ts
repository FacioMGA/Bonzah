import { describe, expect, it } from 'vitest';
import { calculateAutoInsurancePremium } from '../../../../products/motor/pricing/autoInsuranceCalculator.js';
import type { QuoteData } from '../../../../platform/types/autoInsurance.js';
import { registerAllProducts } from '../../../../products/registerProducts.js';

registerAllProducts();

describe('additional driver licence years rating', () => {
  const baseQuoteData = {
    proposer: {
      firstName: 'Test',
      lastName: 'User',
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
    licenseYears: '10',
    licenseType: 'Full',
    licenseIssuedIn: 'Cyprus',
    vehicleUse: 'Private',
    hasConvictions: false,
    hasClaims: false,
    hasAdditionalDrivers: true,
    youngestDriverAge: 35,
    requiredExcess: '300',
    vehicleType: 'Car',
    make: 'Toyota',
    model: 'Yaris',
    additionalDrivers: [
      {
        firstName: 'Alex',
        lastName: 'Driver',
        dateOfBirth: '1990-02-20',
        licenseYears: '10',
        email: '',
        telephone: '',
      },
    ],
  } as unknown as QuoteData;

  it('includes additional driver DOB in rating scenario', () => {
    expect(baseQuoteData.additionalDrivers?.[0]?.dateOfBirth).toBe('1990-02-20');
  });

  it('uses additional driver licence years as a rating input', () => {
    const withExperiencedAdditionalDriver = calculateAutoInsurancePremium({
      ...baseQuoteData,
      additionalDrivers: [{ ...baseQuoteData.additionalDrivers![0], licenseYears: '10' }],
    });
    const withNewAdditionalDriver = calculateAutoInsurancePremium({
      ...baseQuoteData,
      additionalDrivers: [{ ...baseQuoteData.additionalDrivers![0], licenseYears: '0' }],
    });

    expect(withNewAdditionalDriver.premium).toBeGreaterThan(withExperiencedAdditionalDriver.premium);
  });
});

