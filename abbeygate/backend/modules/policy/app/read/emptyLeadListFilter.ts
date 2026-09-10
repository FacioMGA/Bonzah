import type { Prisma } from '@prisma/client';

/**
 * Canonical definition of an "empty lead" for the BO Policies list.
 *
 * When a visitor clicks "Get a Quote" the public session handler creates a real
 * quote-start record (motor -> `status: DRAFT`, other products -> `status:
 * INTAKE`) with a placeholder holder name and no policyholder email/phone. That
 * capture is intentional — it is how we track the whole quote journey — so we
 * NEVER stop creating these rows. But a record that never gained any contactable
 * detail and has gone quiet is noise in the back office: nobody can act on it.
 *
 * An "empty lead" is therefore a projection row that is ALL of:
 *   - at the earliest lifecycle status ({@link EMPTY_LEAD_STATUSES}),
 *   - carrying no policyholder email AND no policyholder phone, and
 *   - untouched for at least {@link EMPTY_LEAD_STALE_DAYS} days.
 *
 * The default BO list hides these to stay tidy; a caller can pass
 * `includeEmptyLeads=true` to see them, and the rows remain in the database so
 * quote-journey tracking and reporting are fully preserved.
 *
 * This module is the single source of truth for the predicate. The list reader
 * (and any future scheduled sweep or report) must import it rather than
 * restating the shape — see ADR-0069.
 */
export const EMPTY_LEAD_STATUSES = ['DRAFT', 'INTAKE'] as const;

/** Days of inactivity after which a contactless quote-start drops off the list. */
export const EMPTY_LEAD_STALE_DAYS = 14;

/**
 * Reference "now" bucketed to the start of the current UTC day.
 *
 * The exclusion predicate is folded into the BO list query's semantic cache key
 * (`listPoliciesUseCase` hot-view cache). A raw `new Date()` cutoff changes every
 * millisecond, so every default request would produce a distinct key and the
 * 15-second cache could never hit — pushing every list load back to the database.
 * Flooring to the UTC day keeps the cutoff stable for the cache's lifetime while
 * shifting a 14-day staleness boundary by at most one day, which is immaterial to
 * "quiet for two weeks". The reader passes this into the builders below.
 */
export function stableEmptyLeadNow(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The `lastActivityAt` cut-off: rows quieter than this are eligible to hide. */
export function emptyLeadStaleCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - EMPTY_LEAD_STALE_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Where-fragment that MATCHES empty (stale, contactless) leads. Both `null` and
 * empty-string contact values count as "no contact" because the discoverability
 * writer may persist either for a session that never captured details.
 */
export function buildEmptyLeadWhere(now: Date = new Date()): Prisma.PolicyListIndexWhereInput {
  return {
    status: { in: [...EMPTY_LEAD_STATUSES] },
    lastActivityAt: { lt: emptyLeadStaleCutoff(now) },
    AND: [
      { OR: [{ policyholderEmail: null }, { policyholderEmail: '' }] },
      { OR: [{ policyholderPhone: null }, { policyholderPhone: '' }] },
    ],
  };
}

/**
 * Where-fragment that EXCLUDES empty leads — the default posture of the BO
 * Policies list. Negating the single {@link buildEmptyLeadWhere} predicate keeps
 * the "hide" and "match" definitions provably in lockstep.
 */
export function buildEmptyLeadExclusionWhere(now: Date = new Date()): Prisma.PolicyListIndexWhereInput {
  return { NOT: buildEmptyLeadWhere(now) };
}

/** Parse the opt-in flag that surfaces empty leads in the list again. */
export function shouldIncludeEmptyLeads(raw: unknown): boolean {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === '1' || value === 'true';
}
