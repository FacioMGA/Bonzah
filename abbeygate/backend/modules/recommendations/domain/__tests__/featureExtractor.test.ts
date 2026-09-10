import { describe, it, expect } from 'vitest';
import { extractAutoRecsFeatures } from '../featureExtractor.js';

describe('extractAutoRecsFeatures', () => {
  it('normalizes core bands from quoteData', () => {
    const qd = {
      dateOfBirth: '1990-02-01',
      renewalDate: '2026-03-01',
      coverRequired: 'Comprehensive',
      vehicleValue: 22000,
      ncb: '4',
      hasAdditionalDrivers: true,
      vehicleUse: 'Private',
    };

    const f = extractAutoRecsFeatures(qd);
    expect(f.coverType).toBe('Comp');
    expect(f.valueBand).toBe('20k+');
    expect(f.ncbBand).toBe('3-5');
    expect(f.driversClass).toBe('multi');
    expect(f.useClass).toBe('Private');
    expect(typeof f.ageBand).toBe('string');
  });
});

