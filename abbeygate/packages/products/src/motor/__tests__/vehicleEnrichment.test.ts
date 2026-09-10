import { describe, expect, it } from 'vitest';
import {
  cardogRowToVariantOption,
  enrichmentToQuoteDataUpdates,
  inferCabrioFromBodyStyle,
  normalizeCabrio,
  normalizeCardogRowToEnrichment,
  normalizeCountry,
  normalizeEnrichmentTargetValue,
  normalizeFuelType,
  normalizeVehicleType,
  variantOptionToEnrichmentResult,
} from '../vehicleEnrichment.js';

describe('motor/vehicleEnrichment normalizers', () => {
  it('normalises every fuel-type variant CarDog ships', () => {
    expect(normalizeFuelType('gasoline')).toBe('Petrol');
    expect(normalizeFuelType('Gasoline')).toBe('Petrol');
    expect(normalizeFuelType('petrol')).toBe('Petrol');
    expect(normalizeFuelType('Petrol')).toBe('Petrol');
    expect(normalizeFuelType('gas')).toBe('Petrol');
    expect(normalizeFuelType('diesel')).toBe('Diesel');
    expect(normalizeFuelType('Diesel')).toBe('Diesel');
    expect(normalizeFuelType('hybrid')).toBe('Hybrid');
    expect(normalizeFuelType('mild_hybrid')).toBe('Hybrid');
    expect(normalizeFuelType('mhev')).toBe('Hybrid');
    expect(normalizeFuelType('hev')).toBe('Hybrid');
    expect(normalizeFuelType('phev')).toBe('Hybrid');
    expect(normalizeFuelType('plug_in_hybrid')).toBe('Hybrid');
    expect(normalizeFuelType('electric')).toBe('Electric');
    expect(normalizeFuelType('ev')).toBe('Electric');
    expect(normalizeFuelType('bev')).toBe('Electric');
    expect(normalizeFuelType('other')).toBe('Other');
    expect(normalizeFuelType('lpg')).toBeUndefined();
    expect(normalizeFuelType('')).toBeUndefined();
    expect(normalizeFuelType(undefined)).toBeUndefined();
  });

  it('normalises body styles to vehicle types', () => {
    expect(normalizeVehicleType('SUV')).toBe('4x4 or MPV');
    expect(normalizeVehicleType('saloon')).toBe('Car');
    expect(normalizeVehicleType('Sedan')).toBe('Car');
    expect(normalizeVehicleType('Hatchback')).toBe('Car');
    expect(normalizeVehicleType('Coupe')).toBe('Car');
    expect(normalizeVehicleType('liftback')).toBe('Car');
    expect(normalizeVehicleType('targa')).toBe('Car');
    expect(normalizeVehicleType('motorhome')).toBe('Motorcaravan');
    expect(normalizeVehicleType('pickup')).toBe('Pickup');
    expect(normalizeVehicleType('van')).toBe('Van to 3.5 tons');
    expect(normalizeVehicleType('motorbike')).toBe('Motorbike');
    expect(normalizeVehicleType('motorcycle')).toBe('Motorbike');
  });

  it('normalises country tokens', () => {
    expect(normalizeCountry('United Kingdom')).toBe('UK');
    expect(normalizeCountry('UK')).toBe('UK');
    expect(normalizeCountry('Cyprus')).toBe('Cyprus');
    expect(normalizeCountry('Channel Islands')).toBe('Channel Islands');
    expect(normalizeCountry('USA')).toBeUndefined();
  });

  it('infers cabrio booleans from body styles', () => {
    expect(inferCabrioFromBodyStyle('Convertible')).toBe(true);
    expect(inferCabrioFromBodyStyle('Cabrio')).toBe(true);
    expect(inferCabrioFromBodyStyle('Roadster')).toBe(true);
    expect(inferCabrioFromBodyStyle('Targa')).toBe(true);
    expect(inferCabrioFromBodyStyle('Hatchback')).toBe(false);
    expect(inferCabrioFromBodyStyle('Saloon')).toBe(false);
    expect(inferCabrioFromBodyStyle('SUV')).toBe(false);
    expect(inferCabrioFromBodyStyle('Coupe')).toBe(false);
    expect(inferCabrioFromBodyStyle('Liftback')).toBe(false);
    expect(inferCabrioFromBodyStyle('Pickup')).toBe(false);
    expect(inferCabrioFromBodyStyle('Motorbike')).toBe(false);
    expect(inferCabrioFromBodyStyle('shooting brake')).toBeUndefined();
    expect(inferCabrioFromBodyStyle('')).toBeUndefined();
  });

  it('coerces cabrio Yes/No across every legacy shape', () => {
    expect(normalizeCabrio(true)).toBe('Yes');
    expect(normalizeCabrio(false)).toBe('No');
    expect(normalizeCabrio('Yes')).toBe('Yes');
    expect(normalizeCabrio('No')).toBe('No');
    expect(normalizeCabrio('YES')).toBe('Yes');
    expect(normalizeCabrio('no')).toBe('No');
    expect(normalizeCabrio('true')).toBe('Yes');
    expect(normalizeCabrio('false')).toBe('No');
    expect(normalizeCabrio('y')).toBe('Yes');
    expect(normalizeCabrio('n')).toBe('No');
    expect(normalizeCabrio(1)).toBe('Yes');
    expect(normalizeCabrio(0)).toBe('No');
    expect(normalizeCabrio('')).toBeUndefined();
    expect(normalizeCabrio(null)).toBeUndefined();
    expect(normalizeCabrio(undefined)).toBeUndefined();
  });

  it('normalises enrichment target values per field', () => {
    expect(normalizeEnrichmentTargetValue('engineSize', 1984.6)).toBe(1985);
    expect(normalizeEnrichmentTargetValue('numberOfSeats', '5')).toBe(5);
    expect(normalizeEnrichmentTargetValue('cabrio', false)).toBe('No');
    expect(normalizeEnrichmentTargetValue('cabrio', true)).toBe('Yes');
    expect(normalizeEnrichmentTargetValue('fuelType', '  Petrol  ')).toBe('Petrol');
    expect(normalizeEnrichmentTargetValue('fuelType', '')).toBeUndefined();
  });
});

describe('motor/vehicleEnrichment row normalisation', () => {
  // Realistic CarDog EU response for `/research/make/Audi/model/A3/year/2022`
  const audiA3 = {
    id: 'Audi-22EU-abc123',
    make: 'Audi',
    model: 'A3',
    year: 2022,
    trim: '40 TFSI (190 Hp) quattro S tronic',
    msrp: null,
    styleName: '40 TFSI (190 Hp) quattro S tronic',
    region: 'EU',
    bodyStyle: 'Hatchback',
    spec: {
      horsepower: 190,
      torque: 320,
      displacement: 1984,
      cylinders: 4,
      fuelType: 'gasoline',
      driveType: 'AWD',
      transmission: 'automatic',
      seats: 5,
      doors: 5,
    },
  };

  it('extracts every wizard-targetable field for the canonical Audi A3 EU response', () => {
    const enrichment = normalizeCardogRowToEnrichment(audiA3);
    expect(enrichment).not.toBeNull();
    expect(enrichment?.variantId).toBe('Audi-22EU-abc123');
    expect(enrichment?.normalizedQuoteData).toEqual({
      make: 'Audi',
      model: 'A3',
      year: 2022,
      fuelType: 'Petrol',
      engineSize: 1984,
      numberOfSeats: 5,
      vehicleType: 'Car',
      cabrio: false,
    });
    expect(enrichment?.fieldConfidence.fuelType).toBeGreaterThan(0);
    expect(enrichment?.fieldConfidence.cabrio).toBeGreaterThan(0);
  });

  it('produces a variant-option whose label and embedded fields match the cached enrichment', () => {
    const option = cardogRowToVariantOption(audiA3);
    expect(option).not.toBeNull();
    expect(option?.variantId).toBe('Audi-22EU-abc123');
    expect(option?.fuelType).toBe('Petrol');
    expect(option?.bodyStyle).toBe('Hatchback');
    expect(option?.engineSizeCc).toBe(1984);
    expect(option?.numberOfSeats).toBe(5);
    expect(option?.cabrio).toBe(false);
    expect(option?.vehicleType).toBe('Car');
    expect(option?.driveType).toBe('AWD');
    expect(option?.transmission).toBe('automatic');
  });

  it('reads spec-level fields from the rawSpecs envelope when CarDog returns the EU extra block', () => {
    const enrichment = normalizeCardogRowToEnrichment({
      id: 'BMW-20EU-foo',
      make: 'BMW',
      model: '320i',
      year: 2020,
      bodyStyle: 'Sedan',
      extra: {
        rawSpecs: {
          fuelType: 'gasoline',
          seats: 5,
          displacement: 1998,
        },
      },
    });
    expect(enrichment?.normalizedQuoteData).toEqual({
      make: 'BMW',
      model: '320i',
      year: 2020,
      fuelType: 'Petrol',
      engineSize: 1998,
      numberOfSeats: 5,
      vehicleType: 'Car',
      cabrio: false,
    });
  });

  it('derives a stable fallback variantId when CarDog omits id', () => {
    const enrichment = normalizeCardogRowToEnrichment({
      make: 'Renault',
      model: 'Clio',
      year: 2018,
      trim: '0.9 TCe (90 Hp)',
      bodyStyle: 'Hatchback',
      spec: { fuelType: 'gasoline', seats: 5, displacement: 898 },
    });
    expect(enrichment?.variantId.length).toBeGreaterThan(0);
    expect(enrichment?.variantId).toMatch(/renault.*clio.*2018/);
  });
});

describe('motor/vehicleEnrichment bridges', () => {
  it('round-trips a variant option to an enrichment result without losing fuelType or cabrio', () => {
    const option = {
      variantId: 'v-1',
      label: 'Audi A3 — Petrol · 1984cc · 5 seats',
      make: 'Audi',
      model: 'A3',
      year: 2022,
      fuelType: 'Petrol',
      bodyStyle: 'Hatchback',
      engineSizeCc: 1984,
      numberOfSeats: 5,
      vehicleType: 'Car',
      cabrio: false,
    };
    const enrichment = variantOptionToEnrichmentResult(option);
    expect(enrichment.source).toBe('cardog');
    expect(enrichment.normalizedQuoteData).toEqual({
      make: 'Audi',
      model: 'A3',
      year: 2022,
      fuelType: 'Petrol',
      engineSize: 1984,
      numberOfSeats: 5,
      vehicleType: 'Car',
      cabrio: false,
    });
  });

  it('projects an enrichment result to wizard-shaped quote-data updates', () => {
    const updates = enrichmentToQuoteDataUpdates({
      source: 'cardog',
      variantId: 'v-2',
      normalizedQuoteData: {
        fuelType: 'Petrol',
        engineSize: 1984,
        numberOfSeats: 5,
        cabrio: false,
        vehicleType: 'Car',
      },
      fieldConfidence: {},
    });
    expect(updates.fuelType).toBe('Petrol');
    expect(updates.engineSize).toBe(1984);
    expect(updates.numberOfSeats).toBe(5);
    expect(updates.cabrio).toBe('No');
    expect(updates.vehicleType).toBe('Car');
  });
});
