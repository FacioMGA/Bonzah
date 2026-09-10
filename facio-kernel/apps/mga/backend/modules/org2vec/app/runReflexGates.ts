/**
 * runReflexGates (app seam) — stable application-facing entrypoint for
 * the deterministic reflex gates (ADR-0044).
 *
 * Re-exports the pure domain gate engine and adds helpers that translate
 * gate decisions into memory-object fields. Consumers (claims builder,
 * submission builder, ask endpoint) import from here so the gate contract
 * has one app-layer owner.
 */

import {
  runReflexGates as runReflexGatesDomain,
  gatesRequireHuman,
  type GateDecision,
  type ReflexGateInput,
} from '../domain/reflexGates.js';
import type { InsufficientEvidenceFlag } from '../domain/memoryObject.js';

export { gatesRequireHuman };
export type { GateDecision, ReflexGateInput };

export function runReflexGates(input: ReflexGateInput): GateDecision[] {
  return runReflexGatesDomain(input);
}

/** Gate decisions that could not be confirmed become insufficient-evidence flags. */
export function gatesToInsufficientEvidenceFlags(decisions: GateDecision[]): InsufficientEvidenceFlag[] {
  return decisions
    .filter((d) => d.status === 'INSUFFICIENT_EVIDENCE')
    .map((d) => ({ topic: d.code, reason: d.summary }));
}
