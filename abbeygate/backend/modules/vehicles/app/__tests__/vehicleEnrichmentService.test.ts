import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getVehicleEnrichmentByVariantId,
  lookupVehicleVariants,
  vehicleEnrichmentNormalization,
} from '../vehicleEnrichmentService.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('vehicleEnrichmentNormalization', () => {
  it('normalizes fuel types to Abbeygate values', () => {
    expect(vehicleEnrichmentNormalization.normalizeFuelType('gasoline')).toBe('Petrol');
    expect(vehicleEnrichmentNormalization.normalizeFuelType('plug_in_hybrid')).toBe('Hybrid');
    expect(vehicleEnrichmentNormalization.normalizeFuelType('diesel')).toBe('Diesel');
    expect(vehicleEnrichmentNormalization.normalizeFuelType('electric')).toBe('Electric');
  });

  it('normalizes body styles to supported vehicle types', () => {
    expect(vehicleEnrichmentNormalization.normalizeVehicleType('suv')).toBe('4x4 or MPV');
    expect(vehicleEnrichmentNormalization.normalizeVehicleType('saloon')).toBe('Car');
    expect(vehicleEnrichmentNormalization.normalizeVehicleType('pickup')).toBe('Pickup');
    expect(vehicleEnrichmentNormalization.normalizeVehicleType('motorhome')).toBe('Motorcaravan');
  });

  it('normalizes registration country values', () => {
    expect(vehicleEnrichmentNormalization.normalizeCountry('United Kingdom')).toBe('UK');
    expect(vehicleEnrichmentNormalization.normalizeCountry('Cyprus')).toBe('Cyprus');
    expect(vehicleEnrichmentNormalization.normalizeCountry('Channel Islands')).toBe('Channel Islands');
  });
});

describe('vehicle enrichment trim lookup', () => {
  it('returns dropdown variants and caches the matching enrichment payload from CarDog rows', async () => {
    vi.stubEnv('CARDOG_API_BASE_URL', 'https://cardog.example.test');
    vi.stubEnv('CARDOG_API_KEY', 'test-key');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [
        {
          id: 'toyota-corolla-icon-hybrid',
          make: 'Toyota',
          model: 'Corolla',
          year: 2020,
          trimName: 'Icon Hybrid',
          fuelType: 'hybrid',
          engineSizeCc: 1798,
          seats: 5,
          bodyStyle: 'hatchback',
          country: 'Cyprus',
        },
      ],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const options = await lookupVehicleVariants({ make: 'Toyota', model: 'Corolla', year: 2020 });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://cardog.example.test/research/make/Toyota/model/Corolla/year/2020?region=EU',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'x-api-key': 'test-key',
        }),
      }),
    );
    expect(options).toEqual([
      expect.objectContaining({
        variantId: 'toyota-corolla-icon-hybrid',
        label: 'Icon Hybrid',
        fuelType: 'Hybrid',
        engineSizeCc: 1798,
        vehicleType: 'Car',
      }),
    ]);

    const enrichment = await getVehicleEnrichmentByVariantId('toyota-corolla-icon-hybrid');
    expect(enrichment).toEqual(expect.objectContaining({
      source: 'cardog',
      normalizedQuoteData: expect.objectContaining({
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
        fuelType: 'Hybrid',
        engineSize: 1798,
        numberOfSeats: 5,
        vehicleType: 'Car',
        countryOfRegistration: 'Cyprus',
      }),
    }));
  });
});
