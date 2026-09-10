/**
 * Shared eligibility helpers for HEALTH objective-expat checks.
 *
 * Brit Immigration Medical Insurance is sold only to expat residents of
 * Cyprus — a non-Cypriot national legally resident in the Republic of
 * Cyprus for the purposes of their immigration application. The same
 * objective-expat shape used by Travel (ADR-0025) applies: residence
 * must not match nationality, the applicant must remain resident for
 * the policy term, and must be legally permitted to reside in CY.
 *
 * The residence and nationality dropdowns both store "Cyprus". The
 * normaliser also maps the formal label so document copy and historical
 * fixtures do not create false-negative expat comparisons.
 */

const RESIDENCE_TO_CANONICAL_NATIONALITY: Readonly<Record<string, string>> = {
  'republic of cyprus': 'cyprus',
};

export function normalizeCountryNameForExpatCompare(value: unknown): string {
  const lowered = String(value || '').trim().toLowerCase();
  if (!lowered) return '';
  return RESIDENCE_TO_CANONICAL_NATIONALITY[lowered] ?? lowered;
}

export function residenceMatchesNationality(residence: unknown, nationality: unknown): boolean {
  const left = normalizeCountryNameForExpatCompare(residence);
  const right = normalizeCountryNameForExpatCompare(nationality);
  if (!left || !right) return false;
  return left === right;
}
