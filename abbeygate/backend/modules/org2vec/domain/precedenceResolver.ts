/**
 * precedenceResolver — deterministic conflict resolution between sources
 * of truth (ADR-0044).
 *
 * When a formal policy document conflicts with a current operational
 * endorsement / email instruction, this resolver decides which source
 * GOVERNS — BEFORE the LLM ever drafts an answer.  The LLM may explain
 * the result; it never decides it.
 *
 * This is the engine behind the "Endorsement 141 (GESY)" demo: a rule
 * that lives only in email must be able to override (or be overridden by)
 * the formal wording, based on effective date, jurisdiction, product,
 * authority level, and version status.
 *
 * Pure domain module — deterministic, no IO.
 */

export type SourceClass =
  | 'FORMAL_POLICY'
  | 'ENDORSEMENT'
  | 'OPERATIONAL_EMAIL'
  | 'PROCEDURE'
  | 'MANUAL';

export type VersionStatus = 'CURRENT' | 'SUPERSEDED' | 'DRAFT' | 'EXPIRED';

export interface PrecedenceCandidate {
  id: string;
  sourceClass: SourceClass;
  /** ISO date the source takes effect. */
  effectiveDate?: string | null;
  /** ISO2 jurisdiction the source is scoped to (null = any). */
  jurisdiction?: string | null;
  /** Product code the source is scoped to (null = any). */
  product?: string | null;
  /** Higher = more authoritative author (e.g. carrier > DCA > handler). */
  authorityLevel?: number | null;
  versionStatus?: VersionStatus;
  label?: string;
}

export interface PrecedenceContext {
  jurisdiction?: string | null;
  product?: string | null;
  /** Decision "as of" date; defaults to now. */
  asOf?: string;
}

export interface RankedCandidate {
  candidate: PrecedenceCandidate;
  eligible: boolean;
  score: number;
  reasons: string[];
}

export interface PrecedenceResult {
  winner: PrecedenceCandidate | null;
  ranked: RankedCandidate[];
  rationale: string;
}

/** Base weight per source class — endorsements amend formal wording. */
const CLASS_WEIGHT: Record<SourceClass, number> = {
  ENDORSEMENT: 5000,
  OPERATIONAL_EMAIL: 4000,
  FORMAL_POLICY: 3000,
  PROCEDURE: 2000,
  MANUAL: 1000,
};

function toMillis(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function recencyBonus(effectiveMs: number | null): number {
  if (effectiveMs === null) return 0;
  const years = effectiveMs / (365 * 24 * 60 * 60 * 1000);
  // Cap so recency never jumps a candidate across a class boundary.
  return Math.min(500, Math.max(0, years));
}

function evaluate(candidate: PrecedenceCandidate, ctx: PrecedenceContext): RankedCandidate {
  const reasons: string[] = [];
  const asOfMs = toMillis(ctx.asOf) ?? Date.now();
  let eligible = true;

  const status = candidate.versionStatus ?? 'CURRENT';
  if (status === 'DRAFT' || status === 'EXPIRED' || status === 'SUPERSEDED') {
    eligible = false;
    reasons.push(`version_status:${status.toLowerCase()}`);
  }

  const effectiveMs = toMillis(candidate.effectiveDate);
  if (effectiveMs !== null && effectiveMs > asOfMs) {
    eligible = false;
    reasons.push('not_yet_effective');
  }

  if (candidate.jurisdiction && ctx.jurisdiction && candidate.jurisdiction !== ctx.jurisdiction) {
    eligible = false;
    reasons.push(`jurisdiction_mismatch:${candidate.jurisdiction}`);
  }

  if (candidate.product && ctx.product && candidate.product !== ctx.product) {
    eligible = false;
    reasons.push(`product_mismatch:${candidate.product}`);
  }

  const base = CLASS_WEIGHT[candidate.sourceClass];
  const recency = recencyBonus(effectiveMs);
  const authority = Math.max(0, candidate.authorityLevel ?? 0);
  const score = eligible ? base + recency + authority : -1;

  if (eligible) {
    reasons.push(`class:${candidate.sourceClass.toLowerCase()}`);
    if (effectiveMs !== null) reasons.push('effective');
    if (authority > 0) reasons.push(`authority:${authority}`);
  }

  return { candidate, eligible, score, reasons };
}

/**
 * Resolve which candidate governs.  Deterministic ordering:
 *   1. eligibility (current, effective, jurisdiction/product match)
 *   2. source class (endorsement > operational email > policy > ...)
 *   3. recency of effective date
 *   4. authority level
 *   5. stable id tie-break
 */
export function resolvePrecedence(
  candidates: PrecedenceCandidate[],
  ctx: PrecedenceContext = {},
): PrecedenceResult {
  const ranked = candidates
    .map((candidate) => evaluate(candidate, ctx))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.candidate.id.localeCompare(b.candidate.id);
    });

  const winner = ranked.find((row) => row.eligible)?.candidate ?? null;

  let rationale: string;
  if (!winner) {
    rationale = candidates.length
      ? 'No eligible source governs (all candidates draft/expired/out-of-scope or not yet effective).'
      : 'No candidate sources supplied.';
  } else {
    const runnerUp = ranked.filter((r) => r.eligible && r.candidate.id !== winner.id)[0];
    rationale = runnerUp
      ? `${winner.label ?? winner.id} (${winner.sourceClass}) governs over ${runnerUp.candidate.label ?? runnerUp.candidate.id} (${runnerUp.candidate.sourceClass}).`
      : `${winner.label ?? winner.id} (${winner.sourceClass}) governs (sole eligible source).`;
  }

  return { winner, ranked, rationale };
}
