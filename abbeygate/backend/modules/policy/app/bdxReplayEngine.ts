import type {
  BdxImportOutcomeStatus,
  BdxRowEvaluation,
} from '../../reporting/app/bdxImport/types.js';
import { isTermCreatingBdxEntry } from '../../reporting/app/bdxImport/types.js';
import type {
  ExistingBdxPolicyCollisionAssessment,
  ExistingBdxPolicyCollisionClassification,
} from './bdxImportRecovery.js';

export type BdxReplayDecisionAction =
  | 'create_base'
  | 'replay_endorsement'
  | 'replay_renewal'
  | 'already_applied'
  | 'defer_waiting_for_prior_row'
  | 'blocked_existing_history'
  | 'blocked_prior_row_failed'
  | 'blocked_transaction_row_without_base';

export type BdxReplayDecision = {
  action: BdxReplayDecisionAction;
  outcomeStatus: BdxImportOutcomeStatus;
  reason?: string;
  waitingForRowNumber?: number;
};

export type BdxReplaySessionState = {
  policyId: string | null;
  classification: ExistingBdxPolicyCollisionClassification;
  appliedRowNumbers: Set<number>;
  blockingReason: string | null;
};

function policyRowTimestamp(evaluation: BdxRowEvaluation): number {
  const booked = evaluation.dto.bookedDate ? new Date(evaluation.dto.bookedDate).getTime() : NaN;
  if (Number.isFinite(booked)) return booked;
  const inception = evaluation.dto.inceptionDate ? new Date(evaluation.dto.inceptionDate).getTime() : NaN;
  if (Number.isFinite(inception)) return inception;
  return evaluation.dto.sourceRowNumber;
}

function orderedPolicyHistory(evaluations: BdxRowEvaluation[]): BdxRowEvaluation[] {
  return evaluations.slice().sort((a, b) => {
    const delta = policyRowTimestamp(a) - policyRowTimestamp(b);
    if (delta !== 0) return delta;
    return a.dto.sourceRowNumber - b.dto.sourceRowNumber;
  });
}

export function createBdxReplaySessionState(
  assessment: ExistingBdxPolicyCollisionAssessment,
): BdxReplaySessionState {
  const appliedRowNumbers = new Set<number>();
  if (
    assessment.policyId &&
    assessment.expectedBaseSourceRowNumber !== null &&
    (assessment.classification === 'idempotent_match' || assessment.classification === 'missing_replay')
  ) {
    appliedRowNumbers.add(assessment.expectedBaseSourceRowNumber);
    for (const rowNumber of assessment.existingReplayRowNumbers) {
      appliedRowNumbers.add(rowNumber);
    }
  }
  const blockingReason = assessment.classification === 'base_row_mismatch'
    || assessment.classification === 'history_order_mismatch'
    || assessment.classification === 'unsafe_to_touch'
    ? assessment.reason
    : null;
  return {
    policyId: assessment.policyId,
    classification: assessment.classification,
    appliedRowNumbers,
    blockingReason,
  };
}

export function markReplayRowApplied(
  session: BdxReplaySessionState,
  evaluation: BdxRowEvaluation,
  policyId?: string,
): void {
  session.appliedRowNumbers.add(evaluation.dto.sourceRowNumber);
  if (policyId) session.policyId = policyId;
}

export function decideBdxReplayAction(args: {
  evaluation: BdxRowEvaluation;
  policyHistory: BdxRowEvaluation[];
  session: BdxReplaySessionState;
  importedPolicyRowAlreadyExists: boolean;
  importedEndorsementRowAlreadyExists: boolean;
}): BdxReplayDecision {
  const {
    evaluation,
    policyHistory,
    session,
    importedPolicyRowAlreadyExists,
    importedEndorsementRowAlreadyExists,
  } = args;

  if (importedPolicyRowAlreadyExists || importedEndorsementRowAlreadyExists) {
    return { action: 'already_applied', outcomeStatus: 'already_imported' };
  }

  if (session.appliedRowNumbers.has(evaluation.dto.sourceRowNumber)) {
    return { action: 'already_applied', outcomeStatus: 'already_imported' };
  }

  if (session.blockingReason) {
    return {
      action: 'blocked_existing_history',
      outcomeStatus: 'blocked_existing_history',
      reason: session.blockingReason,
    };
  }

  const ordered = orderedPolicyHistory(policyHistory);
  const nextPending = ordered.find((row) => !session.appliedRowNumbers.has(row.dto.sourceRowNumber));

  if (!nextPending) {
    return { action: 'already_applied', outcomeStatus: 'already_imported' };
  }

  if (nextPending.dto.sourceRowNumber !== evaluation.dto.sourceRowNumber) {
    if (nextPending.result === 'FAIL') {
      return {
        action: 'blocked_prior_row_failed',
        outcomeStatus: 'blocked_prior_row_failed',
        reason: `Earlier BDX row ${nextPending.dto.sourceRowNumber} must be resolved before applying this row.`,
        waitingForRowNumber: nextPending.dto.sourceRowNumber,
      };
    }
    return {
      action: 'defer_waiting_for_prior_row',
      outcomeStatus: 'deferred_waiting_for_prior_row',
      reason: `Waiting for earlier BDX row ${nextPending.dto.sourceRowNumber} to be applied first.`,
      waitingForRowNumber: nextPending.dto.sourceRowNumber,
    };
  }

  if (nextPending.result === 'FAIL') {
    return {
      action: 'blocked_prior_row_failed',
      outcomeStatus: 'blocked_prior_row_failed',
      reason: `Current BDX row ${nextPending.dto.sourceRowNumber} still fails validation and cannot be applied.`,
      waitingForRowNumber: nextPending.dto.sourceRowNumber,
    };
  }

  if (!session.policyId) {
    // ADR-0056: only a term-creating row (NB / NB-COC / RNL) may become a base
    // policy. A PAM/ADJ/CAN/NTU line with no imported base is dirty input —
    // fail the row loudly instead of materialising a phantom policy.
    if (!isTermCreatingBdxEntry(evaluation.dto.entry)) {
      return {
        action: 'blocked_transaction_row_without_base',
        outcomeStatus: 'blocked_transaction_row_without_base',
        reason: `BDX row is a '${String(evaluation.dto.entry || '').trim().toUpperCase()}' transaction line but no base policy exists for ${evaluation.dto.policyRef}. Transaction lines cannot create policies; import the NB/RNL term row first.`,
      };
    }
    return { action: 'create_base', outcomeStatus: 'imported' };
  }

  return {
    action: evaluation.policyImportDisposition === 'IMPORT_RENEWAL' ? 'replay_renewal' : 'replay_endorsement',
    outcomeStatus: 'imported',
  };
}
