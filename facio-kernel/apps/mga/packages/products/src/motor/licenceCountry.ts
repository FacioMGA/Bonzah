/**
 * Driving-licence country classification for motor underwriting.
 *
 * Canonical owner of the question "was this driving licence issued in a
 * country whose licences we accept online without an extra declaration?"
 * — i.e. the UK or an EU-27 member. A licence issued anywhere else (e.g.
 * Russia, the USA, Switzerland, Norway) is accepted online only after the
 * customer explicitly confirms it legally permits them to drive in the
 * operating country without supervision (ABY non-EU licence confirmation).
 *
 * This is deliberately SEPARATE from `isEuCountry` in
 * `backend/modules/claims/domain/claimCompliance.ts`: that predicate
 * answers a different question (is a CLAIM loss country inside the EU
 * coverage territory), excludes the UK, and lives in a backend domain that
 * the shared package and the public wizard cannot import. The two sets
 * differ (the UK is accepted for licences but is not EU claims territory),
 * so they are distinct concepts rather than a duplicated list.
 *
 * `licenseIssuedIn` is captured as a country NAME string from a dropdown
 * whose options are the canonical `countries` list plus a synthetic
 * "Other EU" entry; an empty value means "not yet answered".
 */

const UK_EU_LICENCE_TOKENS = new Set<string>([
  // United Kingdom (accepted for licences even though it is not EU).
  'united kingdom', 'uk', 'gb', 'gbr', 'great britain', 'england', 'scotland', 'wales', 'northern ireland',
  // The synthetic dropdown option that already means "an EU country".
  'other eu',
  // EU-27.
  'at', 'austria',
  'be', 'belgium',
  'bg', 'bulgaria',
  'hr', 'croatia',
  'cy', 'cyprus',
  'cz', 'czech republic', 'czechia',
  'dk', 'denmark',
  'ee', 'estonia',
  'fi', 'finland',
  'fr', 'france',
  'de', 'germany',
  'gr', 'greece',
  'hu', 'hungary',
  'ie', 'ireland',
  'it', 'italy',
  'lv', 'latvia',
  'lt', 'lithuania',
  'lu', 'luxembourg',
  'mt', 'malta',
  'nl', 'netherlands',
  'pl', 'poland',
  'pt', 'portugal',
  'ro', 'romania',
  'sk', 'slovakia',
  'si', 'slovenia',
  'es', 'spain',
  'se', 'sweden',
]);

function normalizeCountryToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, ' ')
    .replace(/[()]/g, '');
}

/**
 * True when the licence country is the UK or an EU-27 member (or the
 * synthetic "Other EU" option). An empty / unknown value returns false.
 */
export function isUkOrEuLicenceCountry(value: unknown): boolean {
  return UK_EU_LICENCE_TOKENS.has(normalizeCountryToken(value));
}

/**
 * True when a non-UK/EU licence has been selected and therefore the
 * customer must confirm it permits them to drive in the operating country.
 * An empty value (not yet answered) does NOT require the confirmation.
 */
export function requiresForeignLicenceConfirmation(value: unknown): boolean {
  const token = normalizeCountryToken(value);
  if (!token) return false;
  return !UK_EU_LICENCE_TOKENS.has(token);
}
