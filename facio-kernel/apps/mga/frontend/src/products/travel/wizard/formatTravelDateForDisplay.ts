// Canonical UK-format / timezone-safe date display for the travel
// wizard (ABY-239). Single owner — Step4, Step5 and Step6 all
// import this. Three previously-duplicated copies caused Step6 to
// silently regress because the bare `new Date(iso) +
// toLocaleDateString('en-GB')` path drops a day in any timezone
// west of UTC, while Step4 and Step5 had already been hardened
// for it.
//
// The contract: for a `YYYY-MM-DD` ISO date the output MUST be
// `DD/MM/YYYY` exactly, with NO timezone arithmetic — date-only
// inputs are not Instants. For a full ISO timestamp we fall back
// to `toLocaleDateString('en-GB', { timeZone: 'UTC' })` so a
// timestamp at `1975-04-20T00:00:00Z` is rendered as
// `20/04/1975` regardless of the user's local timezone.

/**
 * Render a date for the travel wizard's read-only echoes (plan
 * picker, options, your-details). Accepts the three shapes the
 * wizard actually produces:
 *
 *   - already-formatted `DD/MM/YYYY` strings (passes through)
 *   - `YYYY-MM-DD` ISO date-only strings (timezone-safe split,
 *     no `new Date()` ambiguity)
 *   - any other `Date`-parseable string (formatted with
 *     `en-GB`, forced UTC, to avoid off-by-one display)
 *
 * Empty / whitespace input returns `''`. Unparseable input
 * returns the original `raw` so the operator sees what was
 * stored rather than `Invalid Date`.
 */
export function formatTravelDateForDisplay(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  // Already in display format — pass through. Avoids the
  // unnecessary `new Date()` round-trip on data that's
  // already been formatted upstream.
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;

  // ISO date-only — split the literal string. `new Date('1975-04-20')`
  // is interpreted as midnight UTC and then localised by
  // `toLocaleDateString`, which can drop a day for users west of UTC.
  // String split sidesteps that entirely (this is the ABY-239 fix).
  const isoDateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) return `${isoDateOnly[3]}/${isoDateOnly[2]}/${isoDateOnly[1]}`;

  // Full timestamp (`YYYY-MM-DDTHH:mm:ssZ` etc.) — let Date parse
  // it, then force UTC in the formatter so date-only intent
  // survives across timezones.
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString('en-GB', { timeZone: 'UTC' });
}
