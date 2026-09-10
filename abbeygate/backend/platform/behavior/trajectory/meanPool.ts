/**
 * Mean-pool + L2-normalize a list of equal-dimension vectors.
 *
 * Why L2 normalization is non-negotiable here:
 *   pgvector's `<=>` operator computes cosine distance, which compares angles.
 *   A mean-pooled vector lands on a *different* sphere than its constituent
 *   embeddings (its norm is < 1 in general). If we don't put it back on the
 *   unit sphere, similarity rankings get systematically skewed and our
 *   trajectory-similarity demo becomes a lie.
 *
 * Manifesto reason: trajectoryEmbedding represents recent behavioral
 * trajectory, and is formally:
 *
 *   trajectoryEmbedding =
 *     L2Normalize( mean( last N BehaviorEvent.embedding ordered by occurredAt desc ) )
 *
 * This module is the single source of that formula. Everything that builds a
 * trajectory vector must call `meanPoolNormalized` — never roll its own.
 */

import { l2Normalize } from '../vector.js';
export { l2Normalize };

/**
 * Element-wise mean of `vectors`, then L2-normalized.
 *
 * Behavior:
 *   - Empty input            → returns `[]` (caller decides how to treat
 *                              "no behavior yet"; we never invent a vector).
 *   - Single-vector input    → returns the vector L2-normalized; if the input
 *                              is already unit-norm the result is identical
 *                              up to floating-point noise.
 *   - Zero-vector mean       → returns the all-zero vector (no NaN).  The
 *                              caller can detect this with `isZeroVector`.
 *   - Mixed dimensions       → throws.  We refuse to silently truncate.
 *   - Non-finite values      → throws.  Garbage in must not become garbage out.
 */
export function meanPoolNormalized(vectors: number[][]): number[] {
  if (!Array.isArray(vectors)) {
    throw new TypeError('meanPoolNormalized: vectors must be an array');
  }
  if (vectors.length === 0) {
    return [];
  }

  const dim = vectors[0].length;
  if (dim === 0) {
    return [];
  }

  const mean = new Array<number>(dim).fill(0);
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    if (!Array.isArray(v) || v.length !== dim) {
      throw new Error(
        `meanPoolNormalized: dimension mismatch — vectors[0].length=${dim}, vectors[${i}].length=${v && v.length}`,
      );
    }
    for (let j = 0; j < dim; j++) {
      const x = v[j];
      if (!Number.isFinite(x)) {
        throw new Error(`meanPoolNormalized: non-finite value at vectors[${i}][${j}]`);
      }
      mean[j] += x;
    }
  }
  const inv = 1 / vectors.length;
  for (let j = 0; j < dim; j++) {
    mean[j] *= inv;
  }

  return l2Normalize(mean);
}

/** True iff every element is exactly zero. Used to detect "no signal" rows. */
export function isZeroVector(vector: number[]): boolean {
  for (let i = 0; i < vector.length; i++) {
    if (vector[i] !== 0) return false;
  }
  return vector.length > 0;
}
