/**
 * Deterministic direction classifier.
 *
 * Reads only the last `DIRECTION_WINDOW_SIZE` `behaviorType`s of an entity and
 * returns a `direction` plus a normalized `driftScore in [0,1]`.
 *
 * Why a tiny rule table and not a model?
 *   - The manifesto is explicit: keep rules and learning separate. Rules are
 *     deterministic and auditable; embeddings are probabilistic.
 *   - This function is the explainable side of the trajectory layer. Every
 *     verdict it returns must be traceable to a literal rule and the indices
 *     of the matched events. That is what the `reasonCode`/`evidence` fields
 *     are for.
 *
 * Signal-vs-noise:
 *   - The classifier walks behaviors most-recent-first. The closer a matched
 *     pattern is to "now", the higher its contribution to `driftScore`.
 *   - Unknown / non-matching behaviorTypes are ignored, not penalized.
 *
 * Non-goals (deliberate):
 *   - We do NOT try to express every nuance. Four directions is enough for the
 *     current behavior vocabulary; new ones get added as new manifest entries surface.
 *   - We do NOT use timestamps here. `deltaMsFromPreviousEvent` is durable on
 *     each event for future cadence-aware scoring; this v1 stays time-agnostic
 *     so it is trivially testable.
 */

export const DIRECTION_WINDOW_SIZE = 20;

export type Direction =
  | 'HEALTHY'
  | 'DRIFT_TO_CANCELLATION'
  | 'DRIFT_TO_RENEWAL'
  | 'DRIFT_TO_FRAUD_FLAG';

export type DirectionResult = {
  direction: Direction;
  driftScore: number;
  reasonCode: string;
  evidence: { behaviorType: string; indexFromMostRecent: number }[];
};

// ── Behavior-type vocabulary used by the rules ──────────────────────────────
// Kept here (not in the manifest JSON) because these constants are the
// classifier's own contract with its rules.
const BT_PAYMENT_FAILED = 'policy.payment_failed';
const BT_INFO_REQUIRED = 'policy.comm_info_required';
const BT_CANCELLATION_REQUESTED = 'policy.comm_cancellation_requested';
const BT_CANCELLATION_CONFIRMED = 'policy.comm_cancellation_confirmed';
const BT_CANCELLED = 'policy.cancelled';

const BT_PAYMENT_CAPTURED = 'policy.payment_captured';
const BT_RENEWAL_INVITED = 'policy.renewal_invited';
const BT_RENEWAL_CHASED = 'policy.renewal_chased';
const BT_BOUND = 'policy.bound';
const BT_ISSUED = 'policy.issued';

// Future iteration (claims behaviors). Kept as constants so the rule body is
// already shaped for them when they land.
const BT_RESERVE_ADJ = 'claim.reserve_adj';
const BT_LARGE_LOSS_FLAGGED = 'claim.large_loss_flagged';
const BT_RECOVERY_EXPECTED = 'claim.recovery_expected';

/**
 * Classify the recent behavioral trajectory of one entity.
 *
 * `recentBehaviorTypes` MUST be ordered most-recent-first. The function reads
 * at most the first `DIRECTION_WINDOW_SIZE` entries.
 */
export function computeDirection(recentBehaviorTypes: string[]): DirectionResult {
  if (!Array.isArray(recentBehaviorTypes) || recentBehaviorTypes.length === 0) {
    return { direction: 'HEALTHY', driftScore: 0, reasonCode: 'NO_BEHAVIOR', evidence: [] };
  }
  const window = recentBehaviorTypes.slice(0, DIRECTION_WINDOW_SIZE);

  // ── Cancellation drift ────────────────────────────────────────────────────
  // Strongest cancellation signal, evaluated first so it short-circuits over
  // milder renewal signals.
  const cancellation = scoreCancellationDrift(window);
  if (cancellation) return cancellation;

  // ── Fraud-flag drift (claims) ─────────────────────────────────────────────
  const fraud = scoreFraudFlagDrift(window);
  if (fraud) return fraud;

  // ── Renewal drift ─────────────────────────────────────────────────────────
  const renewal = scoreRenewalDrift(window);
  if (renewal) return renewal;

  return { direction: 'HEALTHY', driftScore: 0, reasonCode: 'NO_PATTERN_MATCHED', evidence: [] };
}

// ── Rules ────────────────────────────────────────────────────────────────────
// Each rule returns either null (no match) or a fully-formed DirectionResult
// with `evidence` pointing at the literal indices that justify the verdict.

function scoreCancellationDrift(window: string[]): DirectionResult | null {
  // Hard signal: an explicit cancellation behavior in the recent window.
  const cancelIdx = findIndex(window, (t) => t === BT_CANCELLED || t === BT_CANCELLATION_CONFIRMED);
  if (cancelIdx >= 0) {
    return {
      direction: 'DRIFT_TO_CANCELLATION',
      driftScore: 1,
      reasonCode: 'CANCELLATION_OBSERVED',
      evidence: [{ behaviorType: window[cancelIdx], indexFromMostRecent: cancelIdx }],
    };
  }

  // Pre-cancellation pattern: ≥2 payment failures plus an info-required or
  // cancellation-requested follow-up. The sub-pattern's recency drives the
  // drift score (closer to "now" → higher score).
  const paymentFailures = collectIndices(window, BT_PAYMENT_FAILED);
  const followUps = collectIndices(
    window,
    (t) => t === BT_INFO_REQUIRED || t === BT_CANCELLATION_REQUESTED,
  );

  if (paymentFailures.length >= 2 && followUps.length >= 1) {
    const evidence = [
      ...paymentFailures.slice(0, 3).map((i) => ({ behaviorType: window[i], indexFromMostRecent: i })),
      ...followUps.slice(0, 2).map((i) => ({ behaviorType: window[i], indexFromMostRecent: i })),
    ];
    const driftScore = clamp01(
      0.55 +
        recencyBoost(paymentFailures[0]) * 0.2 +
        recencyBoost(followUps[0]) * 0.15 +
        Math.min(paymentFailures.length - 2, 3) * 0.05,
    );
    return {
      direction: 'DRIFT_TO_CANCELLATION',
      driftScore,
      reasonCode: 'PAYMENT_FAILURES_PLUS_FOLLOWUP',
      evidence,
    };
  }

  // Softer signal: 3+ payment failures alone (dunning trajectory).
  if (paymentFailures.length >= 3) {
    return {
      direction: 'DRIFT_TO_CANCELLATION',
      driftScore: clamp01(0.4 + recencyBoost(paymentFailures[0]) * 0.3),
      reasonCode: 'REPEATED_PAYMENT_FAILURES',
      evidence: paymentFailures.slice(0, 4).map((i) => ({
        behaviorType: window[i],
        indexFromMostRecent: i,
      })),
    };
  }

  return null;
}

function scoreFraudFlagDrift(window: string[]): DirectionResult | null {
  // Hard signal first.
  const llIdx = findIndex(window, (t) => t === BT_LARGE_LOSS_FLAGGED);
  if (llIdx >= 0) {
    return {
      direction: 'DRIFT_TO_FRAUD_FLAG',
      driftScore: clamp01(0.7 + recencyBoost(llIdx) * 0.3),
      reasonCode: 'LARGE_LOSS_FLAGGED',
      evidence: [{ behaviorType: window[llIdx], indexFromMostRecent: llIdx }],
    };
  }

  // Soft signal: reserve-creep (≥3 reserve adjustments) plus a recovery hint.
  const reserveAdjs = collectIndices(window, BT_RESERVE_ADJ);
  const recoveries = collectIndices(window, BT_RECOVERY_EXPECTED);
  if (reserveAdjs.length >= 3) {
    const evidence = reserveAdjs.slice(0, 4).map((i) => ({
      behaviorType: window[i],
      indexFromMostRecent: i,
    }));
    if (recoveries.length > 0) {
      evidence.push({ behaviorType: window[recoveries[0]], indexFromMostRecent: recoveries[0] });
    }
    return {
      direction: 'DRIFT_TO_FRAUD_FLAG',
      driftScore: clamp01(
        0.45 +
          Math.min(reserveAdjs.length - 3, 4) * 0.07 +
          recencyBoost(reserveAdjs[0]) * 0.2 +
          (recoveries.length > 0 ? 0.1 : 0),
      ),
      reasonCode: 'RESERVE_CREEP',
      evidence,
    };
  }

  return null;
}

function scoreRenewalDrift(window: string[]): DirectionResult | null {
  const renewalEvents = collectIndices(
    window,
    (t) => t === BT_RENEWAL_INVITED || t === BT_RENEWAL_CHASED,
  );
  if (renewalEvents.length === 0) return null;

  const recentCapture = collectIndices(window, BT_PAYMENT_CAPTURED);
  const recentLifecycle = collectIndices(window, (t) => t === BT_BOUND || t === BT_ISSUED);

  // Renewal is "drifting" only when there is also positive engagement nearby
  // (a successful capture, a binding, an issuance). Otherwise a lone renewal
  // invite isn't enough signal — stay HEALTHY.
  if (recentCapture.length === 0 && recentLifecycle.length === 0) return null;

  const evidence = [
    ...renewalEvents.slice(0, 2).map((i) => ({ behaviorType: window[i], indexFromMostRecent: i })),
    ...recentCapture.slice(0, 1).map((i) => ({ behaviorType: window[i], indexFromMostRecent: i })),
    ...recentLifecycle.slice(0, 1).map((i) => ({ behaviorType: window[i], indexFromMostRecent: i })),
  ];

  return {
    direction: 'DRIFT_TO_RENEWAL',
    driftScore: clamp01(0.5 + recencyBoost(renewalEvents[0]) * 0.25 + (recentCapture.length > 0 ? 0.15 : 0.05)),
    reasonCode: 'RENEWAL_WITH_POSITIVE_ENGAGEMENT',
    evidence,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findIndex(window: string[], pred: (t: string) => boolean): number {
  for (let i = 0; i < window.length; i++) {
    if (pred(window[i])) return i;
  }
  return -1;
}

function collectIndices(
  window: string[],
  predOrType: string | ((t: string) => boolean),
): number[] {
  const pred = typeof predOrType === 'string' ? (t: string) => t === predOrType : predOrType;
  const out: number[] = [];
  for (let i = 0; i < window.length; i++) {
    if (pred(window[i])) out.push(i);
  }
  return out;
}

/**
 * Recency boost ∈ [0,1]. Index 0 (most recent) returns 1; older entries decay
 * linearly across DIRECTION_WINDOW_SIZE. Linear is intentional: easy to test
 * and easy to explain to a human auditor.
 */
function recencyBoost(indexFromMostRecent: number): number {
  if (indexFromMostRecent <= 0) return 1;
  if (indexFromMostRecent >= DIRECTION_WINDOW_SIZE) return 0;
  return 1 - indexFromMostRecent / DIRECTION_WINDOW_SIZE;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
