/**
 * Canonical issue-readiness HTTP client (frontend).
 *
 * Per `docs/architecture/contracts/canonical-ownership.md` "Issue-readiness
 * HTTP" row, every public-session readiness fetch goes through ONE client.
 * Pre-PR-5b motor had its own `getPublicIssueReadiness` in
 * `products/motor/wizard/quoteWizard.api.ts` and `PaymentStep.tsx` had a
 * private `fetchIssueReadinessOnce`; this module is the single source of
 * truth — both consumers now route through it.
 *
 * Two public entry points:
 *
 *   - `fetchIssueReadinessRaw(productCode, token)` returns the full
 *     `{ ok, status, json }` envelope. Used by the motor wizard
 *     controller's pre-pay gate, which extracts missing fields /
 *     conditional requirements out of `json.data`.
 *
 *   - `fetchIssueReadinessForProduct(productCode, token)` returns the
 *     normalised `IssueReadinessPayload` shape (or `null`) and dedupes
 *     in-flight calls + caches the most recent value for
 *     `ISSUE_READINESS_RECENT_TTL_MS`. Used by `PaymentStep.tsx`'s
 *     in-pay polling loop where high-frequency calls would otherwise
 *     hammer the backend during the brief gateway-redirect → readiness
 *     window.
 *
 * Both helpers parameterise `productCode` so shared wizard code never
 * hardcodes `motor`/`home`/`travel` — see canonical-ownership.md.
 */

import { operatingRequestHeaders } from '@/src/shared/lib/tenant/requestHeaders';
import { buildPublicSessionUrl } from './buildPublicSessionUrl.js';

export type IssueReadinessBlocker = { code?: string; message?: string };

export type IssueReadinessDerived = {
  hasPaymentConfirmed?: boolean;
  hasBoundInceptionTransaction?: boolean;
  hasIssuedPackDocuments?: boolean;
  hasWelcomeEmailSent?: boolean;
};

export type IssueReadinessPayload = {
  /**
   * Per ADR-0017 (the doc-pack failure-outcome ADR, separate from
   * ADR-0019 which governs tenancy + binder authority): `failed` is a
   * terminal customer-facing outcome from the backend. The wizard reads
   * this and stops polling.
   */
  customerOutcome?: 'issued' | 'pending' | 'failed';
  blockers?: unknown;
  derived?: IssueReadinessDerived;
};

export type IssueReadinessRawResponse = {
  ok: boolean;
  status: number;
  /**
   * The success/error envelope returned by the public-session router.
   * `json.data` carries the readiness payload on success and missing-
   * field / conditional-requirement information that the motor wizard
   * controller surfaces in the pre-pay "fill in missing data" lane.
   */
  json: { success?: boolean; data?: unknown; error?: { code?: string; message?: string } | null } | null;
};

/** TTL for the in-pay polling loop's "I just fetched this 1.2s ago" cache. */
export const ISSUE_READINESS_RECENT_TTL_MS = 1200;

const issueReadinessInFlight = new Map<string, Promise<IssueReadinessPayload | null>>();
const issueReadinessRecent = new Map<string, { at: number; value: IssueReadinessPayload | null }>();

function cacheKey(productCode: string, token: string): string {
  return `${String(productCode || '').toLowerCase()}|${String(token || '')}`;
}

/**
 * Raw fetch against the canonical public-session readiness route.
 * Used by the motor wizard controller's pre-pay gate; it needs the full
 * envelope to extract missing fields / conditional requirements out of
 * `json.data`. Does **not** dedupe or cache — callers invoke this on
 * explicit user transitions (Next button, save-and-continue), not in a
 * polling loop.
 */
export async function fetchIssueReadinessRaw(
  productCode: string,
  token: string,
): Promise<IssueReadinessRawResponse> {
  const url = buildPublicSessionUrl(productCode, token, 'issue-readiness');
  const response = await fetch(url, {headers:operatingRequestHeaders()});
  const json = (await response.json().catch(() => null)) as IssueReadinessRawResponse['json'];
  return { ok: response.ok, status: response.status, json };
}

function normaliseReadinessPayload(raw: IssueReadinessRawResponse['json']): IssueReadinessPayload | null {
  if (!raw || raw.success !== true) return null;
  const payload = raw.data as (Partial<IssueReadinessPayload> & { ready?: boolean }) | undefined;
  if (!payload || typeof payload !== 'object') return null;
  // The generic public-session router (used by home + travel) returns
  // `{ ready: boolean, blockers: [] }`; the BO-side issue-readiness
  // route returns the richer ADR-0017 customerOutcome shape. Normalise
  // both into the same `IssueReadinessPayload` so downstream UI doesn't
  // care which surface produced the response.
  const declaredOutcome =
    payload.customerOutcome === 'issued' ||
    payload.customerOutcome === 'pending' ||
    payload.customerOutcome === 'failed'
      ? payload.customerOutcome
      : undefined;
  const customerOutcome: IssueReadinessPayload['customerOutcome'] =
    declaredOutcome ?? (typeof payload.ready === 'boolean'
      ? (payload.ready ? 'issued' : 'pending')
      : undefined);
  return {
    customerOutcome,
    blockers: Array.isArray((payload as { blockers?: unknown[] }).blockers)
      ? (payload as { blockers?: unknown[] }).blockers
      : [],
    derived: (payload.derived as IssueReadinessDerived) || undefined,
  };
}

/**
 * Normalised + deduped + TTL-cached fetch. Used by `PaymentStep.tsx`'s
 * polling loop. Two concurrent calls within the same dedup window share
 * one network round trip; calls within `ISSUE_READINESS_RECENT_TTL_MS`
 * of a returned value short-circuit to the cached value.
 */
export async function fetchIssueReadinessForProduct(
  productCode: string,
  token: string,
): Promise<IssueReadinessPayload | null> {
  if (!token) return null;
  const key = cacheKey(productCode, token);
  const now = Date.now();
  const recent = issueReadinessRecent.get(key);
  if (recent && now - recent.at < ISSUE_READINESS_RECENT_TTL_MS) {
    return recent.value;
  }
  const inFlight = issueReadinessInFlight.get(key);
  if (inFlight) return inFlight;
  const promise = (async () => {
    try {
      const raw = await fetchIssueReadinessRaw(productCode, token);
      const value = normaliseReadinessPayload(raw.ok ? raw.json : null);
      issueReadinessRecent.set(key, { at: Date.now(), value });
      return value;
    } finally {
      issueReadinessInFlight.delete(key);
    }
  })();
  issueReadinessInFlight.set(key, promise);
  return promise;
}

/**
 * Drop the cached value for a (productCode, token) pair so the next
 * `fetchIssueReadinessForProduct` triggers a fresh fetch. Called after
 * server-side state-changing operations (status verify, manual rerate)
 * where the prior cached readiness is known to be stale.
 */
export function invalidateIssueReadinessCache(productCode: string, token: string): void {
  issueReadinessRecent.delete(cacheKey(productCode, token));
}
