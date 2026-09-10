import { createHash } from 'node:crypto';
import type { SanctionOutcome } from './sanctionsTypes.js';

/**
 * Idempotency + reuse policy for paid Creditsafe sanctions checks.
 *
 * Every screening gate (checkout, bind, issue) used to derive its Creditsafe
 * dedup key from the per-request `correlationId`. That value changes on every
 * click and every retry, so the dedup lookup never matched and each Proceed
 * click / heal retry / gate produced a fresh PAID Creditsafe search. The
 * business outcome we want is "approximately one paid check per purchasing
 * customer/policy" (Uriel P0), so this module makes the key STABLE and
 * subject-scoped and defines which prior results may be reused.
 *
 * This is the single source of truth for the dedup key and the reuse window;
 * `SanctionsService` imports it, no gate restates the shape.
 */

/** How long a terminal Creditsafe result may be reused before we re-screen. */
export const SCREENING_REUSE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Outcomes where Creditsafe actually returned a definitive result (and billed
 * for it). These are safe — and required — to reuse so retries and later gates
 * don't pay again:
 *   - `clear` / `non_blocking_hit` -> customer may proceed,
 *   - `possible_match` / `match`   -> customer stays in referral.
 *
 * The two failure outcomes (`provider_unavailable`, `error`) are deliberately
 * NOT reusable: Creditsafe never returned a decision (and typically did not
 * bill), so a retry after the provider recovers must re-screen — otherwise a
 * transient outage would be cached and wrongly block the customer forever.
 */
export const REUSABLE_SCREENING_OUTCOMES: readonly SanctionOutcome[] = [
  'clear',
  'non_blocking_hit',
  'possible_match',
  'match',
];

/** True when a prior run's outcome may be reused instead of paying again. */
export function isReusableScreeningOutcome(outcome: SanctionOutcome): boolean {
  return REUSABLE_SCREENING_OUTCOMES.includes(outcome);
}

function normalizeSubjectName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeDateOfBirth(dob: string | undefined | null): string {
  return String(dob ?? '').trim();
}

/**
 * Stable, subject-scoped dedup key for a Creditsafe search. Deterministic in
 * the insured identity (name + DOB) and INDEPENDENT of the action type, so the
 * same person on the same policy is screened once and every subsequent
 * gate/retry reuses that paid result. A different insured yields a different
 * key and is screened afresh (correctly). The key is stored in
 * `SanctionScreeningRun.idempotencyKey`.
 *
 * The key also carries a coarse time BUCKET (`floor(now / window)`) so that
 * once the reuse window rolls over the derived key changes. Without the bucket,
 * a re-screen of the same subject at the same gate after the window would write
 * the identical key and collide with the expired row on
 * `@@unique([provider, policyId, actionType, idempotencyKey])` — the request
 * would throw *after* paying. Bucketing lets a fresh result land cleanly while
 * still deduping every click/retry/gate inside one window.
 */
export function deriveSanctionsSubjectKey(input: {
  subjectName: string;
  dateOfBirth?: string;
  at?: Date;
}): string {
  const material = `${normalizeSubjectName(input.subjectName)}|${normalizeDateOfBirth(input.dateOfBirth)}`;
  const subjectHash = createHash('sha256').update(material).digest('hex');
  const bucket = Math.floor((input.at ?? new Date()).getTime() / SCREENING_REUSE_WINDOW_MS);
  return `sub_${subjectHash}_w${bucket}`;
}
