/**
 * Home proposer domicile classification for online underwriting.
 *
 * Canonical owner of the question "is this proposer domiciled in the United
 * Kingdom or an EU-27 member state?" — used by Home UW automation to decide
 * whether a non-resident holiday home can bind online or must be referred.
 *
 * Deliberately separate from `isUkOrEuLicenceCountry` in motor: that answers
 * whether a driving licence was issued in the UK/EU; this answers where the
 * proposer is domiciled. The country sets are aligned but the concepts differ.
 *
 * Domicile is captured as a country NAME from the canonical `countries` list
 * (`rule: 'countryName'` on `proposer.domicileCountry`).
 */

const UK_EU_DOMICILE_TOKENS = new Set<string>([
  // United Kingdom (accepted for online bind even though it is not EU).
  'united kingdom', 'uk', 'gb', 'gbr', 'great britain', 'england', 'scotland', 'wales', 'northern ireland',
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

/** True when domicile is the UK or an EU-27 member. Empty values return false. */
export function isUkOrEuDomicileCountry(value: unknown): boolean {
  return UK_EU_DOMICILE_TOKENS.has(normalizeCountryToken(value));
}
