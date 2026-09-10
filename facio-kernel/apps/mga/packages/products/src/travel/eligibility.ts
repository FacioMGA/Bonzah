/**
 * Shared eligibility helpers for ADR-0025 Travel objective-expat checks.
 *
 * The Travel residence dropdown stores values like "Republic of Cyprus"
 * while the canonical nationality dropdown stores the ISO short form
 * "Cyprus". Both refer to the same country, so the validation profile
 * refinement and the backend UW automation use this shared normaliser
 * to compare residence vs nationality without false negatives.
 *
 * Adding a country to `TRAVEL_RESIDENCE_COUNTRY_OPTIONS` whose label
 * differs from its canonical nationality form requires an entry here.
 */

const RESIDENCE_TO_CANONICAL_NATIONALITY: Readonly<Record<string, string>> = {
  'republic of cyprus': 'cyprus',
};

/**
 * Normalise a country name for residence-vs-nationality equality
 * comparisons. Lowercases, trims whitespace, and applies the residence-
 * label alias map (so "Republic of Cyprus" and "Cyprus" compare equal).
 */
export function normalizeCountryNameForExpatCompare(value: unknown): string {
  const lowered = String(value || '').trim().toLowerCase();
  if (!lowered) return '';
  return RESIDENCE_TO_CANONICAL_NATIONALITY[lowered] ?? lowered;
}

/**
 * True when the supplied residence and nationality values represent the
 * same country. Used by the eligibility cross-field refinement and the
 * backend UW automation `deriveIsExpat` predicate.
 */
export function residenceMatchesNationality(residence: unknown, nationality: unknown): boolean {
  const left = normalizeCountryNameForExpatCompare(residence);
  const right = normalizeCountryNameForExpatCompare(nationality);
  if (!left || !right) return false;
  return left === right;
}
