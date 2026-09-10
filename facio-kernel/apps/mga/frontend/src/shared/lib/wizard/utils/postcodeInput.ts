/**
 * Country-aware postcode input hints (ABY-341).
 *
 * Background: ABY-55 set every postcode field to `inputMode="numeric"` +
 * `pattern="[0-9]*"` so mobile keyboards surface the numeric keypad. That
 * holds for CY / ES / MT / IE (all-digit postcodes), but it breaks two
 * supported jurisdictions:
 *
 *   - Portugal postcodes are `NNNN-NNN`. On the mobile numeric keypad the
 *     hyphen key emits "." (period), so customers ended up typing
 *     "1234.567" instead of "1234-567".
 *   - United Kingdom postcodes are alphanumeric with a space (e.g.
 *     "SW1A 1AA") and cannot be entered on a numeric keypad at all.
 *
 * This is the single owner of the postcode keyboard decision; both the
 * universal `PolicyHolderStep` and the home `Step2Property` read from here
 * so the behaviour can never drift between surfaces.
 */
export type PostcodeInputHint = {
  inputMode: 'numeric' | 'text';
  pattern: string;
};

const NUMERIC_HINT: PostcodeInputHint = { inputMode: 'numeric', pattern: '[0-9]*' };
// Digits + hyphen for PT (NNNN-NNN); text keyboard so the hyphen is reachable.
const PORTUGAL_HINT: PostcodeInputHint = { inputMode: 'text', pattern: '[0-9-]*' };
// Letters, digits and a space for GB (e.g. SW1A 1AA).
const UK_HINT: PostcodeInputHint = { inputMode: 'text', pattern: '[A-Za-z0-9 ]*' };

function isPortugal(c: string): boolean {
  return c === 'pt' || c === 'prt' || c.includes('portug');
}

function isUnitedKingdom(c: string): boolean {
  return (
    c === 'gb' ||
    c === 'uk' ||
    c === 'gbr' ||
    c.includes('united kingdom') ||
    c.includes('great britain') ||
    c.includes('england') ||
    c.includes('scotland') ||
    c.includes('wales') ||
    c.includes('northern ireland')
  );
}

/**
 * Resolve the mobile keyboard hint for a postcode field given the address
 * country (accepts ISO codes like `PT`/`GB` or full names like `Portugal`).
 * Defaults to the numeric keypad for unknown / all-digit jurisdictions.
 */
export function postcodeInputHintForCountry(country: string | null | undefined): PostcodeInputHint {
  const c = String(country || '').trim().toLowerCase();
  if (!c) return NUMERIC_HINT;
  if (isPortugal(c)) return PORTUGAL_HINT;
  if (isUnitedKingdom(c)) return UK_HINT;
  return NUMERIC_HINT;
}
