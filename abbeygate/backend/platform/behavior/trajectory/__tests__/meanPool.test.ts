import { describe, expect, it } from 'vitest';
import { isZeroVector, l2Normalize, meanPoolNormalized } from '../meanPool.js';

function magnitude(vec: number[]): number {
  let s = 0;
  for (const x of vec) s += x * x;
  return Math.sqrt(s);
}

describe('meanPoolNormalized', () => {
  it('returns [] for empty input (no behavior yet — caller decides)', () => {
    expect(meanPoolNormalized([])).toEqual([]);
  });

  it('returns [] when inner dimension is zero', () => {
    expect(meanPoolNormalized([[]])).toEqual([]);
  });

  it('single already-unit-norm vector round-trips with magnitude 1', () => {
    const v = [3 / 5, 4 / 5];
    const out = meanPoolNormalized([v]);
    expect(out).toHaveLength(2);
    expect(magnitude(out)).toBeCloseTo(1, 12);
    expect(out[0]).toBeCloseTo(3 / 5, 12);
    expect(out[1]).toBeCloseTo(4 / 5, 12);
  });

  it('mean of two opposing unit vectors collapses to zero (no NaN)', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    const out = meanPoolNormalized([a, b]);
    expect(isZeroVector(out)).toBe(true);
  });

  it('result of mean-pool is always L2-unit-norm when input has signal', () => {
    const inputs = [
      [1, 0, 0],
      [0, 1, 0],
      [0.5, 0.5, 0.7071],
    ];
    const out = meanPoolNormalized(inputs);
    expect(magnitude(out)).toBeCloseTo(1, 6);
  });

  it('mean direction matches the average direction of inputs', () => {
    const inputs = [
      [1, 0],
      [1, 0],
      [1, 0],
    ];
    const out = meanPoolNormalized(inputs);
    expect(out[0]).toBeCloseTo(1, 12);
    expect(out[1]).toBeCloseTo(0, 12);
  });

  it('throws on dimension mismatch (we refuse silent truncation)', () => {
    expect(() =>
      meanPoolNormalized([
        [1, 2, 3],
        [4, 5],
      ]),
    ).toThrow(/dimension mismatch/);
  });

  it('throws on non-finite values', () => {
    expect(() => meanPoolNormalized([[1, Number.NaN]])).toThrow(/non-finite/);
    expect(() => meanPoolNormalized([[1, Number.POSITIVE_INFINITY]])).toThrow(/non-finite/);
  });

  it('is consistent across input orderings (mean is commutative)', () => {
    const a = [0.2, 0.5, 0.7];
    const b = [-0.3, 0.4, 0.1];
    const c = [0.9, -0.2, 0.0];
    const ab = meanPoolNormalized([a, b, c]);
    const ba = meanPoolNormalized([c, a, b]);
    for (let i = 0; i < ab.length; i++) {
      expect(ab[i]).toBeCloseTo(ba[i], 12);
    }
  });

  it('handles realistic 1536-dim vectors and stays unit-norm', () => {
    const dim = 1536;
    function deterministicUnit(seed: number): number[] {
      const out: number[] = [];
      let s = 0;
      for (let i = 0; i < dim; i++) {
        const x = Math.sin((i + 1) * (seed + 1) * 0.0173);
        out.push(x);
        s += x * x;
      }
      const n = Math.sqrt(s);
      return out.map((x) => x / n);
    }
    const samples = [deterministicUnit(1), deterministicUnit(2), deterministicUnit(3), deterministicUnit(4)];
    const out = meanPoolNormalized(samples);
    expect(out).toHaveLength(dim);
    expect(magnitude(out)).toBeCloseTo(1, 6);
  });
});

describe('l2Normalize', () => {
  it('normalizes a non-unit vector to unit length', () => {
    const out = l2Normalize([3, 4]);
    expect(magnitude(out)).toBeCloseTo(1, 12);
    expect(out[0]).toBeCloseTo(0.6, 12);
    expect(out[1]).toBeCloseTo(0.8, 12);
  });

  it('returns zero vector for zero input (no NaN, no divide-by-zero)', () => {
    const out = l2Normalize([0, 0, 0]);
    expect(out).toEqual([0, 0, 0]);
  });

  it('returns [] for empty input', () => {
    expect(l2Normalize([])).toEqual([]);
  });

  it('does not mutate the input', () => {
    const v = [3, 4];
    l2Normalize(v);
    expect(v).toEqual([3, 4]);
  });

  it('throws on non-finite values', () => {
    expect(() => l2Normalize([1, Number.NaN, 3])).toThrow(/non-finite/);
  });
});

describe('isZeroVector', () => {
  it('returns true only for non-empty all-zero vectors', () => {
    expect(isZeroVector([0, 0, 0])).toBe(true);
    expect(isZeroVector([0, 0.0001, 0])).toBe(false);
    expect(isZeroVector([])).toBe(false);
  });
});
