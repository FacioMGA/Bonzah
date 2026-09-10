import { describe, expect, it } from 'vitest';
import { deriveRequiredActions } from '../index.js';

describe('deriveRequiredActions', () => {
  it('returns deterministic blocking actions for unconfirmed intake', () => {
    const actions = deriveRequiredActions({
      intakeStatus: 'FNOL_SUBMITTED',
      failingGateKeys: ['lossTypePresent'],
      referralRequired: true,
      referralApprovedAt: undefined,
      largeLossIndicator: false,
      largeLossNotifiedAt: undefined,
      lockedDeductible: undefined,
    });
    expect(actions.map((action) => action.id)).toEqual([
      'confirm-fnol',
      'complete-intake-gates',
      'approve-referral',
    ]);
  });

  it('includes large loss notify action when flagged but not notified', () => {
    const actions = deriveRequiredActions({
      intakeStatus: 'FNOL_CONFIRMED',
      failingGateKeys: [],
      referralRequired: false,
      referralApprovedAt: undefined,
      largeLossIndicator: true,
      largeLossNotifiedAt: undefined,
      lockedDeductible: 300,
    });
    expect(actions.map((action) => action.id)).toEqual(['notify-underwriter-large-loss']);
  });
});

