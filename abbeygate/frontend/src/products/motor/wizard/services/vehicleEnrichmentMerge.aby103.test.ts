/**
 * ABY-103 — explicit trim selection ALWAYS re-applies the merge fields,
 * including the case where the incoming value happens to equal the
 * current value. Without this, picking the same trim twice (or picking a
 * trim whose specs match what the customer already typed) silently
 * skipped every field and the green-pulse never fired — exactly the
 * report "Selecting trim should re-trigger fuel type, cabrio, and no.
 * of seats".
 *
 * VIN background lookups (`source: 'vin'`) keep the silent same-value
 * skip — that path is automatic and shouldn't pulse on every keystroke.
 */
import { describe, expect, it } from 'vitest';
import type { VehicleEnrichmentResult } from '@facio/products';
import type { QuoteData } from '../types';
import { applyVehicleEnrichment } from './vehicleEnrichmentMerge';

function buildQuoteData(overrides: Partial<QuoteData> = {}): QuoteData {
  const base: Partial<QuoteData> = {
    fuelType: 'Petrol',
    numberOfSeats: 5,
    engineSize: 1500,
    cabrio: 'No',
    vehicleValue: 12000,
    registrationNumber: '',
    make: 'Toyota',
    model: 'Yaris',
    year: 2020,
    vehicleType: 'Car',
    countryOfRegistration: 'Cyprus',
    ...overrides,
  };
  return base as QuoteData;
}

function buildEnrichment(
  normalizedQuoteData: Record<string, unknown>,
): VehicleEnrichmentResult {
  const built: VehicleEnrichmentResult = {
    source: 'cardog',
    variantId: 'TEST-VARIANT',
    normalizedQuoteData: normalizedQuoteData as VehicleEnrichmentResult['normalizedQuoteData'],
    fieldConfidence: {},
  };
  return built;
}

describe('applyVehicleEnrichment — ABY-103 trim re-trigger', () => {
  it('re-applies same-value fields on explicit trim pick (`source: cardog`)', () => {
    // Customer's current data already matches what the trim would
    // suggest. Previously the merge skipped every field as "sameValue
    // — no change needed", swallowing the user's intent to refresh.
    const quoteData = buildQuoteData({
      fuelType: 'Petrol',
      cabrio: 'No',
      numberOfSeats: 5,
    });
    const enrichment = buildEnrichment({
      fuelType: 'Petrol',
      cabrio: 'No',
      numberOfSeats: 5,
    });
    const result = applyVehicleEnrichment({
      quoteData,
      enrichment,
      source: 'cardog',
      onConflict: () => 'use_suggested',
    });

    expect(result.appliedFields.sort()).toEqual(['cabrio', 'fuelType', 'numberOfSeats']);
    // Every applied field must be marked `wasUserEdited: false` and
    // `source: 'cardog'` so the green-pulse fires AND so any prior
    // user-edited flag (which would have made the next trim pick a
    // "conflict" requiring confirmation) is cleared.
    const meta = result.nextQuoteData.__meta?.vehicleEnrichment as Record<string, { source: string; wasUserEdited: boolean }>;
    expect(meta.fuelType.source).toBe('cardog');
    expect(meta.fuelType.wasUserEdited).toBe(false);
    expect(meta.cabrio.source).toBe('cardog');
    expect(meta.numberOfSeats.source).toBe('cardog');
  });

  it('VIN background lookup keeps the silent same-value skip (no green-pulse on keystrokes)', () => {
    // Symmetric guarantee for the other source: VIN auto-lookup
    // shouldn't pulse on every keystroke, so unchanged values must
    // still be skipped here.
    const quoteData = buildQuoteData({ fuelType: 'Petrol', cabrio: 'No' });
    const enrichment = buildEnrichment({ fuelType: 'Petrol', cabrio: 'No' });
    const result = applyVehicleEnrichment({
      quoteData,
      enrichment,
      source: 'vin',
      onConflict: () => 'use_suggested',
    });
    expect(result.appliedFields).toEqual([]);
    expect(result.conflictFields).toEqual([]);
  });

  it('still applies cardog values that DIFFER from the current data (regression: no over-correction)', () => {
    // The previous merge already handled the "different value, not
    // user-edited" path. ABY-103 must not regress that.
    const quoteData = buildQuoteData({ fuelType: 'Petrol', cabrio: 'No' });
    const enrichment = buildEnrichment({ fuelType: 'Diesel', cabrio: 'Yes' });
    const result = applyVehicleEnrichment({
      quoteData,
      enrichment,
      source: 'cardog',
      onConflict: () => 'use_suggested',
    });
    expect(result.appliedFields.sort()).toEqual(['cabrio', 'fuelType']);
    expect(result.nextQuoteData.fuelType).toBe('Diesel');
    expect(result.nextQuoteData.cabrio).toBe('Yes');
  });
});
