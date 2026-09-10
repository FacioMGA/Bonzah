import { describe, expect, it } from 'vitest';
import { calculateRentalRating, discoverRentalCoverages } from '../calculator.js';
import { goldenRentalQuote, summitVehicles } from '../../goldenFixtures.js';
import type { RentalCoverageDiscoveryRequest } from '@facio/products';

const baseRequest: RentalCoverageDiscoveryRequest = {
  pickup: goldenRentalQuote.risk.pickup,
  residence: goldenRentalQuote.risk.residence,
  rentalStart: goldenRentalQuote.risk.rentalStart,
  rentalEnd: goldenRentalQuote.risk.rentalEnd,
  driver: { age: goldenRentalQuote.risk.driver.age, licenceValid: true },
  rentalUse: 'PERSONAL',
  vehicle: summitVehicles[1],
};

describe('rental coverage discovery', () => {
  it('returns the whole catalogue with the SLI dependency declared by the kernel', () => {
    const result = discoverRentalCoverages(baseRequest);
    expect(result.coverages.map((coverage) => coverage.code)).toEqual(['CDW', 'RCLI', 'SLI', 'PAI_PEI']);
    // The distribution surface must not re-implement this rule locally.
    expect(result.coverages.find((coverage) => coverage.code === 'SLI')?.requires).toEqual(['RCLI']);
    expect(result.coverages.find((coverage) => coverage.code === 'CDW')?.requires).toEqual([]);
  });

  it('agrees with the quote engine on price, so discovery can never contradict the quote that follows', () => {
    const discovered = discoverRentalCoverages(baseRequest);
    const quoted = calculateRentalRating({ ...goldenRentalQuote, risk: { ...goldenRentalQuote.risk, vehicle: summitVehicles[1] }, coverages: ['CDW', 'RCLI', 'SLI', 'PAI_PEI'] });
    for (const coverage of quoted.coveragePrices) {
      const match = discovered.coverages.find((item) => item.code === coverage.code);
      expect(match?.indicativeDailyPrice).toBe(coverage.dailyPrice);
      expect(match?.indicativeTripPrice).toBe(coverage.tripPrice);
    }
    expect(discovered.chargedPeriods).toBe(quoted.chargedPeriods);
    expect(discovered.fees).toBe(quoted.fees);
    expect(discovered.feeComponents).toEqual(quoted.feeComponents);
  });

  it('resolves renter eligibility without a vehicle, and withholds prices until one is supplied', () => {
    const { vehicle, ...withoutVehicle } = baseRequest;
    void vehicle;
    const result = discoverRentalCoverages(withoutVehicle);
    expect(result.eligibility.status).toBe('QUOTED');
    expect(result.chargedPeriods).toBeGreaterThan(0);
    expect(result.coverages.every((coverage) => coverage.available)).toBe(true);
    expect(result.coverages.every((coverage) => coverage.indicativeDailyPrice === null)).toBe(true);
    expect(result.ratingSource).toBeNull();
  });

  it('answers rather than throws when the renter is ineligible', () => {
    const underage = discoverRentalCoverages({ ...baseRequest, driver: { age: 19, licenceValid: true } });
    expect(underage.eligibility.status).toBe('DECLINED');
    expect(underage.eligibility.ruleReferences).toContain('DRIVER.AGE');
    expect(underage.coverages.every((coverage) => !coverage.available)).toBe(true);
    expect(underage.coverages.every((coverage) => coverage.unavailableReason !== null)).toBe(true);

    const noLicence = discoverRentalCoverages({ ...baseRequest, driver: { age: 30, licenceValid: false } });
    expect(noLicence.eligibility.ruleReferences).toContain('DRIVER.LICENCE_INVALID');

    const commercial = discoverRentalCoverages({ ...baseRequest, rentalUse: 'COMMERCIAL' });
    expect(commercial.eligibility.ruleReferences).toContain('RENTAL_USE.EXCLUDED');

    const reversed = discoverRentalCoverages({ ...baseRequest, rentalEnd: baseRequest.rentalStart });
    expect(reversed.eligibility.ruleReferences).toContain('RENTAL_PERIOD.INVALID');
  });

  it('never leaks a quote identity, expiry or bind token', () => {
    const result = discoverRentalCoverages(baseRequest) as unknown as Record<string, unknown>;
    for (const forbidden of ['quoteId', 'integrityToken', 'expiresAt', 'correlationId']) {
      expect(result[forbidden]).toBeUndefined();
    }
    expect(result.demoStatus).toBe('DEMO BUILD');
  });
});
