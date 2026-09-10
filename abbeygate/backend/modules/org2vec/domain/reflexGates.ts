/**
 * reflexGates — deterministic decision gates (ADR-0044).
 *
 * These gates run BEFORE the LLM and never depend on it.  The LLM may
 * explain a gate result after the deterministic check; it can never set,
 * override, or skip a gate.  Gates only consider TRUSTED inputs (facts
 * backed by deterministic / human-validated edges — see `graphEdge.ts`).
 *
 * Four gates (per spec):
 *   1. Authority threshold gate.
 *   2. Missing required evidence gate.
 *   3. Endorsement condition gate.
 *   4. Insufficient-evidence fallback.
 *
 * Pure domain module — deterministic, no IO.
 */

import type { JsonObject } from '../../../platform/types/json.js';

export type GateCode =
  | 'AUTHORITY_THRESHOLD'
  | 'MISSING_REQUIRED_EVIDENCE'
  | 'ENDORSEMENT_CONDITION'
  | 'INSUFFICIENT_EVIDENCE';

export type GateStatus = 'PASS' | 'REFER' | 'BLOCK' | 'INSUFFICIENT_EVIDENCE';

export interface RequiredEvidenceItem {
  documentType: string;
  satisfied: boolean;
}

export interface EndorsementConditionItem {
  endorsementRef: string;
  condition: string;
  /** null = unknown / not yet evidenced. */
  satisfied: boolean | null;
  /** Whether the condition assessment rests on a trusted edge. */
  trusted: boolean;
}

export interface ReflexGateInput {
  /** Largest monetary exposure on the case (estimate/reserve/settlement). */
  largestExposureAmount?: number | null;
  /** Delegated authority limit that applies. */
  authorityLimit?: number | null;
  /** Is the exposure figure backed by a trusted (deterministic) edge? */
  exposureTrusted?: boolean;
  currency?: string;

  requiredEvidence?: RequiredEvidenceItem[];
  endorsementConditions?: EndorsementConditionItem[];

  /** Count of trusted facts extracted for the case. */
  trustedFactCount?: number;
  /** Minimum trusted facts required before any answer is trustworthy. */
  minTrustedFacts?: number;
}

export interface GateDecision {
  code: GateCode;
  status: GateStatus;
  summary: string;
  detail?: JsonObject;
}

function authorityGate(input: ReflexGateInput): GateDecision | null {
  const amount = input.largestExposureAmount;
  const limit = input.authorityLimit;
  if (amount == null || limit == null) return null;

  if (input.exposureTrusted === false) {
    return {
      code: 'AUTHORITY_THRESHOLD',
      status: 'INSUFFICIENT_EVIDENCE',
      summary: 'Exposure figure is not backed by a trusted source; cannot assert it is within authority.',
      detail: { amount, limit },
    };
  }

  if (amount > limit) {
    return {
      code: 'AUTHORITY_THRESHOLD',
      status: 'REFER',
      summary: `Exposure ${formatMoney(amount, input.currency)} exceeds delegated authority ${formatMoney(limit, input.currency)} — referral required.`,
      detail: { amount, limit },
    };
  }

  return {
    code: 'AUTHORITY_THRESHOLD',
    status: 'PASS',
    summary: `Exposure ${formatMoney(amount, input.currency)} is within delegated authority ${formatMoney(limit, input.currency)}.`,
    detail: { amount, limit },
  };
}

function missingEvidenceGate(input: ReflexGateInput): GateDecision | null {
  const items = input.requiredEvidence;
  if (!items || items.length === 0) return null;
  const missing = items.filter((item) => !item.satisfied).map((item) => item.documentType);
  if (missing.length === 0) {
    return {
      code: 'MISSING_REQUIRED_EVIDENCE',
      status: 'PASS',
      summary: 'All required evidence is present.',
      detail: { required: items.length },
    };
  }
  return {
    code: 'MISSING_REQUIRED_EVIDENCE',
    status: 'BLOCK',
    summary: `Required evidence outstanding: ${missing.map((m) => m.replace(/_/g, ' ')).join(', ')}.`,
    detail: { missing },
  };
}

function endorsementGate(input: ReflexGateInput): GateDecision | null {
  const items = input.endorsementConditions;
  if (!items || items.length === 0) return null;

  const untrustedOrUnknown = items.filter((item) => !item.trusted || item.satisfied === null);
  const breached = items.filter((item) => item.trusted && item.satisfied === false);

  if (breached.length > 0) {
    return {
      code: 'ENDORSEMENT_CONDITION',
      status: 'BLOCK',
      summary: `Endorsement condition not met: ${breached.map((b) => `${b.endorsementRef} (${b.condition})`).join('; ')}.`,
      detail: { breached: breached.map((b) => b.endorsementRef) },
    };
  }
  if (untrustedOrUnknown.length > 0) {
    return {
      code: 'ENDORSEMENT_CONDITION',
      status: 'INSUFFICIENT_EVIDENCE',
      summary: `Endorsement condition cannot be confirmed from trusted evidence: ${untrustedOrUnknown.map((u) => u.endorsementRef).join(', ')}.`,
      detail: { unconfirmed: untrustedOrUnknown.map((u) => u.endorsementRef) },
    };
  }
  return {
    code: 'ENDORSEMENT_CONDITION',
    status: 'PASS',
    summary: 'All endorsement conditions satisfied.',
    detail: { conditions: items.length },
  };
}

function insufficientEvidenceFallback(input: ReflexGateInput): GateDecision | null {
  const min = input.minTrustedFacts;
  if (min == null) return null;
  const count = input.trustedFactCount ?? 0;
  if (count < min) {
    return {
      code: 'INSUFFICIENT_EVIDENCE',
      status: 'INSUFFICIENT_EVIDENCE',
      summary: `Only ${count} trusted fact(s) extracted (minimum ${min}); answers should be treated as provisional.`,
      detail: { trustedFactCount: count, minTrustedFacts: min },
    };
  }
  return {
    code: 'INSUFFICIENT_EVIDENCE',
    status: 'PASS',
    summary: `${count} trusted fact(s) extracted.`,
    detail: { trustedFactCount: count, minTrustedFacts: min },
  };
}

function formatMoney(amount: number, currency?: string): string {
  const prefix = currency ? `${currency} ` : '';
  return `${prefix}${amount.toLocaleString()}`;
}

/** Run all applicable gates. Gates whose inputs are absent are skipped. */
export function runReflexGates(input: ReflexGateInput): GateDecision[] {
  return [
    authorityGate(input),
    missingEvidenceGate(input),
    endorsementGate(input),
    insufficientEvidenceFallback(input),
  ].filter((decision): decision is GateDecision => decision !== null);
}

/** True when any gate blocks or refers — the case needs a human decision. */
export function gatesRequireHuman(decisions: GateDecision[]): boolean {
  return decisions.some((d) => d.status === 'BLOCK' || d.status === 'REFER');
}
