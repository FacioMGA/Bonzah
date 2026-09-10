/**
 * Recursive plain-object merge.
 *
 * One canonical implementation, mirrored byte-for-byte at
 * `backend/shared/lib/deepMerge.ts`. Frontend and backend cannot share
 * imports across the monorepo boundary, so we mirror; the
 * `mirror-parity` test pins the two files together.
 *
 * Semantics:
 *
 *   - Plain-object siblings are preserved (this is the fix for the BO
 *     save bug where editing one nested leaf in `trip.planType` used to
 *     wipe the rest of `trip.*` because RHF `dirtyFields` only carries
 *     the touched leaves).
 *   - Arrays and primitives are replaced atomically (a multiselect like
 *     `trip.destinations` always represents the FULL desired set, not a
 *     delta).
 *   - Both inputs are treated as immutable; a fresh object is returned.
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function deepMergePlain(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    const baseValue = out[key];
    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      out[key] = deepMergePlain(baseValue, patchValue);
    } else {
      out[key] = patchValue;
    }
  }
  return out;
}

function isEmptyLeaf(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

type QuoteDataPrimitive = string | number | boolean | null | undefined;
type QuoteDataValue = QuoteDataPrimitive | QuoteDataObject | QuoteDataValue[];

export interface QuoteDataObject {
  [key: string]: QuoteDataValue;
}

function isQuoteDataObject(value: unknown): value is QuoteDataObject {
  return isPlainObject(value);
}

/**
 * Nested quoteData merge that keeps a filled leaf when the incoming
 * side is empty (null / undefined / ''). Used by BO policy GET
 * (ABY-256) and public session PATCH (ABY-414) so a later wizard
 * autosave cannot blank proposer.name / email / phone that already
 * landed on the policy.
 *
 * `false`, `0`, and empty arrays are not empty — those are valid answers.
 */
export function deepMergeQuoteData(
  baseQuoteData: unknown,
  incomingQuoteData: unknown,
): QuoteDataObject {
  const base = isQuoteDataObject(baseQuoteData) ? baseQuoteData : {};
  const incoming = isQuoteDataObject(incomingQuoteData) ? incomingQuoteData : {};
  const out: QuoteDataObject = { ...base };
  for (const key of Object.keys(incoming)) {
    const incomingVal = incoming[key];
    const baseVal = out[key];
    if (isQuoteDataObject(incomingVal) && isQuoteDataObject(baseVal)) {
      out[key] = deepMergeQuoteData(baseVal, incomingVal);
    } else if (isEmptyLeaf(incomingVal) && !isEmptyLeaf(baseVal)) {
      // keep base
    } else {
      out[key] = incomingVal;
    }
  }
  return out;
}
