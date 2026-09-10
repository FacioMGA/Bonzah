import { describe, expect, it } from 'vitest';
import { calculateRentalRating, RentalRatingError } from '../calculator.js';
import { goldenRentalQuote, summitVehicles } from '../../goldenFixtures.js';

const quoteFor = (vehicleIndex: number) => ({ ...goldenRentalQuote, risk: { ...goldenRentalQuote.risk, vehicle: summitVehicles[vehicleIndex] } });

describe('Bonzah rental demo calculator', () => {
  it('differentiates CDW by vehicle risk while keeping the service fee fixed', () => {
    const corolla = calculateRentalRating(quoteFor(0));
    const rav4 = calculateRentalRating(quoteFor(1));
    const tesla = calculateRentalRating(quoteFor(2));
    const cdw = (result: ReturnType<typeof calculateRentalRating>) => result.coveragePrices.find((coverage) => coverage.code === 'CDW')?.tripPrice ?? 0;
    expect(cdw(corolla)).toBeLessThan(cdw(rav4));
    expect(cdw(rav4)).toBeLessThan(cdw(tesla));
    expect(corolla.fees).toBe(rav4.fees);
  });

  it('uses charged 24-hour periods and rounds every price to cents', () => {
    const rating = calculateRentalRating(goldenRentalQuote);
    expect(rating.chargedPeriods).toBe(4);
    expect(rating.coveragePrices.every((coverage) => Number.isInteger(coverage.tripPrice * 100))).toBe(true);
    expect(rating.fees).toBe(4.95);
    expect(rating.total).toBe(rating.subtotal + rating.fees);
    expect(rating.feeComponents).toEqual([{ code: 'INSURANCE_SERVICE_FEE', label: 'Insurance service fee', amount: rating.fees }]);
  });

  it('declines Porsche 911 and refers ambiguous high-value trim without displaying premium', () => {
    expect(calculateRentalRating(quoteFor(3)).status).toBe('DECLINED');
    const referred = calculateRentalRating(quoteFor(4));
    expect(referred.status).toBe('REFERRED');
    expect(referred.total).toBe(0);
  });

  it('enforces the SLI dependency', () => {
    expect(() => calculateRentalRating({ ...goldenRentalQuote, coverages: ['CDW', 'SLI'] })).toThrowError(RentalRatingError);
    expect(() => calculateRentalRating({ ...goldenRentalQuote, coverages: ['CDW', 'SLI'] })).toThrow(/requires RCLI/i);
  });

  it('returns the documented package and declines excluded rental use', () => {
    const packaged = calculateRentalRating({ ...goldenRentalQuote, coverages: ['CDW', 'RCLI'], packageCode: 'COMPLETE_AUTO_GUARD' });
    expect(packaged.package).toMatchObject({ code: 'COMPLETE_AUTO_GUARD', coverages: ['CDW', 'RCLI'] });
    const commercial = calculateRentalRating({ ...goldenRentalQuote, risk: { ...goldenRentalQuote.risk, rentalUse: 'COMMERCIAL' } });
    expect(commercial).toMatchObject({ status: 'DECLINED', total: 0 });
    expect(commercial.internalRuleReferences).toContain('RENTAL_USE.EXCLUDED');
  });

  it('rejects a package when its requested coverages do not match', () => {
    expect(() => calculateRentalRating({ ...goldenRentalQuote, coverages: ['CDW'], packageCode: 'COMPLETE_AUTO_GUARD' })).toThrow(/configured coverages/i);
  });

  it('caps the vehicle multiplier at the configured maximum', () => {
    const rating = calculateRentalRating({ ...quoteFor(2), risk: { ...quoteFor(2).risk, vehicle: { ...summitVehicles[2], declaredValue: 60_000, class: 'suv' } } });
    expect(rating.vehicleMultiplier).toBeLessThanOrEqual(2);
  });

  it.each([
    ['declared value', 'DECLARED_VALUE', { declaredValue: 20_000 }, 0.9],
    ['low repair profile', 'REPAIR_PROFILE', { repairProfile: 'low' as const }, 0.9],
    ['high repair profile', 'REPAIR_PROFILE', { repairProfile: 'high' as const }, 1.2],
    ['compact class', 'VEHICLE_CLASS', { class: 'compact' as const }, 0.95],
    ['SUV class', 'VEHICLE_CLASS', { class: 'suv' as const }, 1.1],
    ['EV powertrain', 'POWERTRAIN', { powertrain: 'ev' as const }, 1.1],
  ])('applies the configured %s factor', (_label, factorCode, vehiclePatch, expected) => {
    const baseline = { ...summitVehicles[1], make: 'Unknown', model: 'Standard', class: 'sedan' as const, repairProfile: 'standard' as const, powertrain: 'combustion' as const, declaredValue: 31_500 };
    const rating = calculateRentalRating({ ...goldenRentalQuote, risk: { ...goldenRentalQuote.risk, vehicle: { ...baseline, ...vehiclePatch } } });
    expect(rating.factors.find((factor) => factor.code === factorCode)?.value).toBe(expected);
  });

  it('applies the 0.80 multiplier floor', () => {
    expect(calculateRentalRating(quoteFor(0)).vehicleMultiplier).toBe(0.8);
  });

  it('pins environmental source versions and changes liability premium by state and season', () => {
    const colorado = calculateRentalRating(goldenRentalQuote);
    const california = calculateRentalRating({ ...goldenRentalQuote, risk: { ...goldenRentalQuote.risk, pickup: { country: 'US', state: 'CA' } } });
    expect(colorado.ratingSource.datasetVersion).toBe('bonzah-us-state-season-2026.1');
    expect(colorado.factors.find((factor) => factor.code === 'ROAD_RISK')?.sourceVersion).toContain('FARS');
    expect(california.coveragePrices.find((coverage) => coverage.code === 'RCLI')?.dailyPrice).not.toBe(colorado.coveragePrices.find((coverage) => coverage.code === 'RCLI')?.dailyPrice);
    expect(california.fees).toBe(colorado.fees);
  });

  it('records an explicit theft fallback and refers an unsupported environmental state', () => {
    const fallback = calculateRentalRating({ ...goldenRentalQuote, risk: { ...goldenRentalQuote.risk, vehicle: { ...summitVehicles[1], make: 'Unknown', model: 'Model' } } });
    expect(fallback.ratingSource.fallbacks).toHaveLength(1);
    expect(fallback.factors.find((factor) => factor.code === 'THEFT')?.explanation).toMatch(/fallback/i);
    const unavailable = calculateRentalRating({ ...goldenRentalQuote, risk: { ...goldenRentalQuote.risk, pickup: { country: 'US', state: 'TX' } } });
    expect(unavailable).toMatchObject({ status: 'REFERRED', total: 0 });
    expect(unavailable.internalRuleReferences).toContain('ENVIRONMENT.DATASET_UNAVAILABLE.REFER');
  });
});
