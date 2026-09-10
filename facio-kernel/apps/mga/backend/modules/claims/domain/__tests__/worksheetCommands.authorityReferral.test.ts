import { beforeEach, describe, expect, it } from 'vitest';
import { baseProjection, mockBuildClaimWorksheetProjection, mockTx, resetCommandTestState, runCommand } from './worksheetCommands.testkit.js';

describe('worksheetCommands authority and referral', () => {
  beforeEach(() => {
    resetCommandTestState();
    process.env.CLAIM_AUTH_LIMIT_USER = '100';
  });

  it('emits REFERRAL_REQUIRED and rejects reserve movement above authority', async () => {
    await expect(
      runCommand({
        claimId: 'claim-1',
        type: 'SET_RESERVE',
        payload: { bucket: 'INDEMNITY', amount: 800, reasonCode: 'EXPERT_REPORT', explanation: 'High severity estimate' },
        input: { actorType: 'USER', actorId: 'u1', actorName: 'Tester' },
      }),
    ).rejects.toThrow('referral approval required');

    expect(mockTx.claimEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'REFERRAL_REQUIRED',
          actorType: 'USER',
          actorId: 'u1',
        }),
      }),
    );
  });

  it('allows movement after APPROVE_REFERRAL', async () => {
    await runCommand({
      claimId: 'claim-1',
      type: 'APPROVE_REFERRAL',
      payload: { note: 'Approved by senior authority' },
      input: { actorType: 'UNDERWRITER', actorId: 'uw-1', actorName: 'Senior UW' },
    });

    mockBuildClaimWorksheetProjection.mockReturnValueOnce({
      ...baseProjection(),
      referralApprovedAt: '2026-03-02T00:00:00.000Z',
    });

    await expect(
      runCommand({
        claimId: 'claim-1',
        type: 'SET_RESERVE',
        payload: { bucket: 'INDEMNITY', amount: 800, reasonCode: 'EXPERT_REPORT', explanation: 'Approved reserve increase' },
        input: { actorType: 'USER', actorId: 'u1', actorName: 'Tester' },
      }),
    ).resolves.toBeUndefined();

    expect(mockTx.claimEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'RESERVE_SET',
        }),
      }),
    );
  });
});

