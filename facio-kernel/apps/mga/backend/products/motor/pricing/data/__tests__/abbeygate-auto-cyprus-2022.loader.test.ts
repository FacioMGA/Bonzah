import { describe, it, expect } from 'vitest';
import { loadAbbeygateAutoCyprus2022Matrix } from '../loader.js';

describe('abbeygate-auto-cyprus-2022 matrix loader', () => {

  it('loads, validates, and exposes the canonical matrix shape', () => {
    const matrix = loadAbbeygateAutoCyprus2022Matrix();
    expect(matrix.baseMatrix.engineSizeBands).toHaveLength(9);
    expect(matrix.baseMatrix.basePolicyExcessEngineSizeBands).toEqual([
      '0-999', '1000-1100', '1101-1249', '1250-1400', '1401-1899',
      '1900-2200', '2201-3500', '3501-3999', 'Over 3999',
    ]);
    expect(matrix.baseMatrix.basePolicyExcessByEngineBand).toEqual([250, 250, 250, 250, 250, 250, 350, 400, 750]);
    expect(matrix.baseMatrix.vehicleValueBands).toHaveLength(24);
    expect(matrix.baseMatrix.values).toHaveLength(9);
    matrix.baseMatrix.values.forEach((row) => expect(row).toHaveLength(24));
    expect(matrix.factors.proposerAge.length).toBeGreaterThan(0);
    expect(matrix.factors.vehicleAge.length).toBeGreaterThan(0);
    expect(matrix.factors.licencePeriod.length).toBeGreaterThan(0);
    expect(matrix.factors.addedDriversUnder25.length).toBeGreaterThan(0);
  });

  it('preserves canonical pre-externalisation values at known cells', () => {
    const matrix = loadAbbeygateAutoCyprus2022Matrix();
    expect(matrix.baseMatrix.values[0][0]).toBe(670);
    expect(matrix.baseMatrix.values[8][23]).toBe(6977);
    expect(matrix.factors.proposerAge[0]).toEqual({ label: 'Under 21', min: 0, max: 20, factor: 5.0 });
    expect(matrix.factors.vehicleAge[2]).toEqual({ label: 'Vehicle Age over 10', min: 11, max: Number.POSITIVE_INFINITY, factor: 0.875 });
    expect(matrix.classic.excessPctOfValue).toBe(0.015);
  });

  it('transforms null catch-all sentinels into Number.POSITIVE_INFINITY', () => {
    const matrix = loadAbbeygateAutoCyprus2022Matrix();
    const motorcycleCatchAll = matrix.motorcycle.basePremium[matrix.motorcycle.basePremium.length - 1];
    expect(motorcycleCatchAll.maxCc).toBe(Number.POSITIVE_INFINITY);
    expect(motorcycleCatchAll.premium).toBe(1167);

    const olderRiderEntry = matrix.motorcycle.riderAgeFactors[0];
    expect(olderRiderEntry.min).toBe(46);
    expect(olderRiderEntry.max).toBe(Number.POSITIVE_INFINITY);
    expect(olderRiderEntry.factor).toBe(0.875);

    const motorcaravanCatchAll = matrix.motorcaravan.basePremiumByAnnualKms[
      matrix.motorcaravan.basePremiumByAnnualKms.length - 1
    ];
    expect(motorcaravanCatchAll.maxKms).toBe(Number.POSITIVE_INFINITY);
    expect(motorcaravanCatchAll.premium).toBe(600);
  });

  it('deep-freezes the entire result', () => {
    const matrix = loadAbbeygateAutoCyprus2022Matrix();
    expect(Object.isFrozen(matrix)).toBe(true);
    expect(Object.isFrozen(matrix.baseMatrix)).toBe(true);
    expect(Object.isFrozen(matrix.baseMatrix.values)).toBe(true);
    expect(Object.isFrozen(matrix.baseMatrix.values[0])).toBe(true);
    expect(Object.isFrozen(matrix.baseMatrix.basePolicyExcessByEngineBand)).toBe(true);
    expect(Object.isFrozen(matrix.factors)).toBe(true);
    expect(Object.isFrozen(matrix.motorcycle.basePremium)).toBe(true);
    expect(Object.isFrozen(matrix.motorcycle.basePremium[0])).toBe(true);
  });

  it('rejects mutation attempts in strict mode', () => {
    const matrix = loadAbbeygateAutoCyprus2022Matrix();
    expect(() => {
      (matrix.baseMatrix.values[0] as number[])[0] = 0;
    }).toThrow(TypeError);
    expect(() => {
      (matrix.factors.proposerAge as Array<{ label: string; min: number; max: number; factor: number }>).push({ label: 'X', min: 1, max: 1, factor: 1 });
    }).toThrow(TypeError);
    expect(matrix.baseMatrix.values[0][0]).toBe(670);
  });

  it('caches the result across calls (same reference)', () => {
    const a = loadAbbeygateAutoCyprus2022Matrix();
    const b = loadAbbeygateAutoCyprus2022Matrix();
    expect(b).toBe(a);
  });
});
