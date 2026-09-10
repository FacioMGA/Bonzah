import { describe, it, expect } from 'vitest';
import { loadClassicCarRates } from '../loader.js';

describe('classic-car-rates loader', () => {

  it('loads, validates, and returns a populated rate table', () => {
    const rates = loadClassicCarRates();
    expect(rates.vehicleGroups.length).toBeGreaterThan(5000);
    expect(Object.keys(rates.premiumByMileageBand)).toEqual(
      expect.arrayContaining(['0-1500', '1501-3000', '3001-5000']),
    );
    expect(Object.keys(rates.policyExcessByAgeBand)).toEqual(
      expect.arrayContaining(['10-20', '20+']),
    );
  });

  it('deep-freezes the entire result', () => {
    const rates = loadClassicCarRates();
    expect(Object.isFrozen(rates)).toBe(true);
    expect(Object.isFrozen(rates.premiumByMileageBand)).toBe(true);
    expect(Object.isFrozen(rates.premiumByMileageBand['0-1500'])).toBe(true);
    expect(Object.isFrozen(rates.policyExcessByAgeBand)).toBe(true);
    expect(Object.isFrozen(rates.vehicleGroups)).toBe(true);
    expect(Object.isFrozen(rates.vehicleGroups[0])).toBe(true);
  });

  it('rejects mutation attempts in strict mode', () => {
    const rates = loadClassicCarRates();
    expect(() => {
      (rates.vehicleGroups as unknown as unknown[]).push({ make: 'X' });
    }).toThrow(TypeError);
    expect(() => {
      (rates.premiumByMileageBand['0-1500'] as Record<string, number>)['1'] = 9999;
    }).toThrow(TypeError);
    expect(rates.premiumByMileageBand['0-1500']['1']).toBe(200);
  });

  it('caches the result across calls (same reference)', () => {
    const a = loadClassicCarRates();
    const b = loadClassicCarRates();
    expect(b).toBe(a);
  });

  it('exposes the canonical ALFA ROMEO 33 (1350 CC) row at the right group', () => {
    const rates = loadClassicCarRates();
    const row = rates.vehicleGroups.find(
      (r) => r.make === 'ALFA ROMEO' && r.model === '33 (1350 CC)' && r.fromYear === 1983 && r.toYear === 1986,
    );
    expect(row).toBeDefined();
    expect(row?.group).toBe('4');
    expect(row?.engineCc).toBe(1350);
  });
});
