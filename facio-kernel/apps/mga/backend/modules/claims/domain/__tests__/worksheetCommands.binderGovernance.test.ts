import { beforeEach, describe, expect, it } from 'vitest';
import { mockTx, resetCommandTestState, runCommand } from './worksheetCommands.testkit.js';

describe('worksheetCommands binder governance', () => {
  beforeEach(() => {
    process.env.CLAIM_AUTH_LIMIT_USER = '999999';
    process.env.CLAIM_LARGE_LOSS_THRESHOLD = '0';
    resetCommandTestState();
  });

  it('enforces settlement authority from binder claims config', async () => {
    mockTx.policy.findUnique.mockResolvedValue({
      id: 'policy-1',
      binder: {
        id: 'binder-1',
        config: {
          operations: {
            claims: {
              tpaAuthorityLimit: 20000,
            },
          },
        },
      },
    });

    await expect(
      runCommand({
        claimId: 'claim-1',
        type: 'SET_RESERVE',
        payload: {
          bucket: 'INDEMNITY',
          newOutstandingAmount: 25000,
          reasonCode: 'MANUAL_UPDATE',
          explanation: 'Reserve update',
        },
        input: { actorType: 'USER', actorId: 'u-1', actorName: 'Handler' },
      }),
    ).rejects.toThrow(/referral approval required/i);

    expect(mockTx.claimEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'REFERRAL_REQUIRED',
        payload: expect.objectContaining({
          settlementAuthorityLimit: 20000,
          governanceSource: 'binder',
        }),
      }),
    }));
  });
});

