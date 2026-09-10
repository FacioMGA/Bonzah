const EPSILON = 1e-12;

export function pgVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/**
 * L2-normalize a single vector. Returns a new array and never mutates input.
 */
export function l2Normalize(vector: number[]): number[] {
  if (!Array.isArray(vector)) {
    throw new TypeError('l2Normalize: vector must be an array');
  }
  const dim = vector.length;
  if (dim === 0) return [];

  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    const x = vector[i];
    if (!Number.isFinite(x)) {
      throw new Error(`l2Normalize: non-finite value at index ${i}`);
    }
    sumSq += x * x;
  }
  const norm = Math.sqrt(sumSq);
  if (norm < EPSILON) return new Array<number>(dim).fill(0);

  const inv = 1 / norm;
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) out[i] = vector[i] * inv;
  return out;
}
