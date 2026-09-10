import { describe, expect, it } from 'vitest';
import { boStatusSortRankFor, derivePolicyState } from '../policyStateService.js';

describe('policyStateService', () => {
  it('applies deterministic precedence (cancellation request > endorsement draft)', () => {
    const state = derivePolicyState({
      status: 'ACTIVE',
      stateCurrentSnapshot: {
        cancellationRequest: { status: 'RECEIVED' },
        endorsementWorkspace: { reasonCode: 'CHANGE_ADDRESS' },
      },
    });
    expect(state.boStatus).toBe('CANCELLATION_REQUESTED');
    expect(state.operationRunning).toBe('CANCELLATION');
  });

  it('maps issued states and bindability consistently', () => {
    const state = derivePolicyState({
      status: 'ISSUED',
      inceptionDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
    expect(state.isIssued).toBe(true);
    expect(state.boStatus).toBe('ISSUED');
  });

  it('returns stable BO sort ranking', () => {
    expect(boStatusSortRankFor('CANCELLATION_REQUESTED')).toBeLessThan(boStatusSortRankFor('ACTIVE'));
    expect(boStatusSortRankFor('ACTIVE')).toBeLessThan(boStatusSortRankFor('CANCELLED'));
  });
});
