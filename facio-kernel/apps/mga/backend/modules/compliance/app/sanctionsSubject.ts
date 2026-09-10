function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * System-generated placeholder names used before a customer identifies
 * themselves (session bootstrap / draft policy rows). These are NOT real
 * people and MUST NEVER be sent to Creditsafe: screening "Quote in progress"
 * both burns a credit on a fake identity and pollutes the audit record. When
 * the only name we have is a placeholder we resolve NO subject — the caller
 * that requires screening (bind / payment / issue) then blocks with
 * `SANCTION_SCREENING_SUBJECT_MISSING` until real details are captured, which
 * is exactly the "screen the real person, not the placeholder" rule agreed
 * with the business (ABY sanctions incident, Aug 2026).
 */
const PLACEHOLDER_SUBJECT_NAMES = new Set([
  'quote in progress',
  'new submission',
  'auto quote (in progress)',
]);

function isPlaceholderSubjectName(name: string): boolean {
  return PLACEHOLDER_SUBJECT_NAMES.has(name.trim().replace(/\s+/g, ' ').toLowerCase());
}

/**
 * Normalise a date of birth into a Creditsafe-accepted string
 * (`YYYY-MM-DD` or `YYYY`). Returns undefined for anything the provider
 * would reject (empty, malformed, before 1900, or in the future) so the
 * search falls back to name-only rather than sending garbage. This is not
 * a "silent default" — DOB is genuinely optional for the AML search; we
 * only forward a value we know is valid.
 */
function normalizedDateOfBirth(value: unknown): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;

  const fullMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const yearOnlyMatch = /^(\d{4})$/.exec(raw);
  const match = fullMatch ?? yearOnlyMatch;
  if (!match) return undefined;

  const year = Number(match[1]);
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year <= 1900 || year > currentYear) return undefined;

  if (fullMatch) {
    // Reject impossible calendar dates and future dates.
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return undefined;
    if (parsed.getTime() > Date.now()) return undefined;
    // Guard against JS Date rollover (e.g. 2020-02-31 -> March).
    const iso = parsed.toISOString().slice(0, 10);
    if (iso !== raw) return undefined;
  }

  return raw;
}

/**
 * Resolve the individual subject for sanctions screening: the person's
 * name plus (when available) their date of birth. Screening is by name +
 * DOB only — country is intentionally excluded (ADR-0043) because the
 * Creditsafe `countryCodes` filter over-narrows the AML search.
 *
 * Personal details live under `proposer.*` on the canonical quote shape
 * (Motor/Home/Travel/Health). `policyHolderName` is the bind/issue-time
 * fallback for the name. Obsolete flat quote fields are read only when
 * neither canonical source exists; they must never override the person shown
 * on the policy or we can screen a stale draft identity (ABY-403).
 *
 * DOB follows the selected identity source: `proposer.dateOfBirth`
 * (Motor/Home/Health/Business collect it on the policyholder step), then the
 * Travel lead-traveller DOB. Travel deliberately
 * does not re-ask a proposer DOB — its policyholder IS the lead traveller
 * (confirmed with Peter, 2026-08-05; see ABY-65) and `travellers.leadTravellerDOB`
 * is a required field — so without this last source Travel screening would run
 * name-only and over-block on name collisions.
 *
 * A flat top-level DOB is considered only with a legacy flat name. We take the
 * first candidate that NORMALISES to a valid DOB rather than the
 * first non-null one: an optional field left as `''` (a blank
 * `proposer.dateOfBirth` from a BO policyholder edit) must not shadow a later
 * valid source, or Travel would stay name-only in the exact case this fixes.
 */
export function resolveIndividualScreeningSubject(args: {
  policyHolderName?: string | null;
  quoteData?: unknown;
}): { subjectName: string; dateOfBirth?: string } | null {
  const quote = asRecord(args.quoteData);
  const proposer = asRecord(quote.proposer);
  const travellers = asRecord(quote.travellers);

  const proposerName = [proposer.firstName, proposer.lastName]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  const policyHolderName = String(args.policyHolderName || '').trim();
  const legacyFlatName = [quote.firstName, quote.lastName]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  const eligibleProposerName = isPlaceholderSubjectName(proposerName) ? '' : proposerName;
  const eligiblePolicyHolderName = isPlaceholderSubjectName(policyHolderName) ? '' : policyHolderName;
  const eligibleLegacyFlatName = isPlaceholderSubjectName(legacyFlatName) ? '' : legacyFlatName;
  const subjectName = eligibleProposerName || eligiblePolicyHolderName || eligibleLegacyFlatName;
  if (!subjectName) return null;

  const dateOfBirthCandidates = eligibleProposerName
    ? [proposer.dateOfBirth, travellers.leadTravellerDOB]
    : eligiblePolicyHolderName
      ? [proposer.dateOfBirth, travellers.leadTravellerDOB]
      : [quote.dateOfBirth];
  let dateOfBirth: string | undefined;
  for (const candidate of dateOfBirthCandidates) {
    dateOfBirth = normalizedDateOfBirth(candidate);
    if (dateOfBirth) break;
  }
  return {
    subjectName,
    ...(dateOfBirth ? { dateOfBirth } : {}),
  };
}
