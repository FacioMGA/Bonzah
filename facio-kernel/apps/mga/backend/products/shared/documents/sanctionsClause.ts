/**
 * Canonical Economic & Trade Sanctions endorsement (CV1020) applied to
 * every product's issued policy schedule across the BRIT / Lloyd's binder
 * family. One source of truth for the code, title and clause wording so the
 * Motor, Home, Travel and Health schedules print byte-identical text.
 *
 * Supersedes the earlier CV1028 sanctions exclusion reference: this is the
 * standard Lloyd's "Sanctions Limitation Clause" wording (LMA-aligned).
 */
export const CV1020_SANCTIONS_CLAUSE = {
  code: 'CV1020',
  title: 'Economic and Trade Sanctions Exclusions: Sanctions Limitation Clause',
  text:
    'No (re)insurer shall be deemed to provide cover and no (re)insurer shall be liable to pay any claim or ' +
    'provide any benefit hereunder to the extent that the provision of such cover, payment of such claim or ' +
    'provision of such benefit would expose that (re)insurer to any sanction, prohibition or restriction under ' +
    'United Nations resolutions or the trade or economic sanctions, laws or regulations of the European Union, ' +
    'United Kingdom or United States of America.',
} as const;

/** `CV1020. Economic and Trade Sanctions Exclusions: Sanctions Limitation Clause` */
export const CV1020_HEADING_LINE = `${CV1020_SANCTIONS_CLAUSE.code}. ${CV1020_SANCTIONS_CLAUSE.title}`;

/**
 * Legacy sanctions endorsement template codes that CV1020 replaces on issued
 * schedules. The Motor MBE catalog still carries the historical `CV 1028`
 * template (retained for BDX / prior-policy lookups), so any applied instance
 * must be dropped from the schedule projection to avoid printing two competing
 * sanctions clauses. Match is done case-insensitively with spaces removed.
 */
export const SUPERSEDED_SANCTIONS_CODES: readonly string[] = ['CV1028'];

/** Normalise an endorsement code for supersede comparison (drop spaces/case). */
export function isSupersededSanctionsCode(code: unknown): boolean {
  const normalised = String(code ?? '')
    .replace(/\s+/g, '')
    .toUpperCase();
  return SUPERSEDED_SANCTIONS_CODES.some(
    (c) => c.replace(/\s+/g, '').toUpperCase() === normalised,
  );
}
