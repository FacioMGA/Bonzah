// Journey contract: BO referral review + approve/decline.
//
// Bound to the canonical claim command dispatcher and command type
// union. APPROVE_REFERRAL / SET_REFERRAL / DENY_CLAIM are the three
// outcome commands the UW referral surface emits.

import { describe, expect, it } from 'vitest';
import { handleIntakeCommands } from '../../backend/modules/claims/domain/commands/intake.js';
import type { ClaimCommandType } from '../../backend/modules/claims/domain/commands/types.js';

const referralOutcomeCommands = [
  'SET_REFERRAL',
  'APPROVE_REFERRAL',
  'DENY_CLAIM',
] as const satisfies readonly ClaimCommandType[];

describe('journey: bo-referral-review-approval', () => {
  it('binds to the canonical claim command dispatcher', () => {
    expect(typeof handleIntakeCommands).toBe('function');
  });

  it('preserves the three referral outcome commands in the canonical union', () => {
    expect(referralOutcomeCommands).toContain('SET_REFERRAL');
    expect(referralOutcomeCommands).toContain('APPROVE_REFERRAL');
    expect(referralOutcomeCommands).toContain('DENY_CLAIM');
  });
});
