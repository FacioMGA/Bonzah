import type {
  ComplianceDecisionType,
  ComplianceReasonCode,
  SanctionOutcome,
  ScreeningDecision,
} from './sanctionsTypes.js';

export function mapDecisionFromOutcome(outcome: SanctionOutcome): {
  decision: ComplianceDecisionType;
  reasonCode: ComplianceReasonCode;
  canBind: boolean;
  requiresManualReview: boolean;
} {
  if (outcome === 'clear') {
    return {
      decision: 'allow_bind',
      reasonCode: 'NO_HITS',
      canBind: true,
      requiresManualReview: false,
    };
  }

  if (outcome === 'non_blocking_hit') {
    return {
      decision: 'allow_bind',
      reasonCode: 'NON_BLOCKING_HITS',
      canBind: true,
      requiresManualReview: false,
    };
  }

  if (outcome === 'possible_match' || outcome === 'match') {
    return {
      decision: 'manual_review_required',
      reasonCode: 'HITS_FOUND',
      canBind: false,
      requiresManualReview: true,
    };
  }

  if (outcome === 'provider_unavailable') {
    return {
      decision: 'block_bind',
      reasonCode: 'PROVIDER_UNAVAILABLE',
      canBind: false,
      requiresManualReview: false,
    };
  }

  return {
    decision: 'block_bind',
    reasonCode: 'SCREENING_ERROR',
    canBind: false,
    requiresManualReview: false,
  };
}

export function isBlockingDecision(decision: ScreeningDecision): boolean {
  return !decision.canBind;
}
