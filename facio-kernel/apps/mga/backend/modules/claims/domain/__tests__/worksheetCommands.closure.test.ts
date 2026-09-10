import { beforeEach, describe, expect, it } from 'vitest';
import { baseProjection, mockBuildClaimWorksheetProjection, mockTx, resetCommandTestState, runCommand } from './worksheetCommands.testkit.js';

describe('worksheetCommands closure invariants', () => {
  beforeEach(() => {
    resetCommandTestState();
    mockBuildClaimWorksheetProjection.mockReturnValue({
      ...baseProjection(),
      reserveIndemnity: 0,
      totalOutstanding: 0,
      totalIncurred: 0,
      buckets: {
        ...baseProjection().buckets,
        INDEMNITY: { ...baseProjection().buckets.INDEMNITY, outstanding: 0 },
      },
    });
  });

  it('rejects close while outstanding reserve exists', async () => {
    mockBuildClaimWorksheetProjection.mockReturnValueOnce({
      ...baseProjection(),
      reserveIndemnity: 250,
      totalOutstanding: 250,
      totalIncurred: 250,
      buckets: {
        ...baseProjection().buckets,
        INDEMNITY: { ...baseProjection().buckets.INDEMNITY, outstanding: 250 },
      },
    });
    await expect(
      runCommand({
        claimId: 'claim-1',
        type: 'CLOSE',
        payload: {
          closureReason: 'SETTLED',
          summary: 'Attempt closure while reserve remains.',
        },
        input: { actorType: 'UNDERWRITER', actorId: 'u2', actorName: 'UW' },
      }),
    ).rejects.toThrow('outstanding reserve or expected recovery remains');
  });

  it('rejects close with expected recoveries outstanding', async () => {
    mockBuildClaimWorksheetProjection.mockReturnValueOnce({
      ...baseProjection(),
      reserveIndemnity: 0,
      totalOutstanding: 0,
      recoveriesExpected: 100,
      salvageExpected: 0,
      totalIncurred: 0,
      buckets: {
        ...baseProjection().buckets,
        INDEMNITY: { ...baseProjection().buckets.INDEMNITY, outstanding: 0, recoveryExpected: 100 },
      },
    });
    await expect(
      runCommand({
        claimId: 'claim-1',
        type: 'CLOSE',
        payload: {
          closureReason: 'SETTLED',
          summary: 'Attempt closure with expected recovery.',
        },
        input: { actorType: 'UNDERWRITER', actorId: 'u2', actorName: 'UW' },
      }),
    ).rejects.toThrow('outstanding reserve or expected recovery remains');
  });

  it('rejects reopen unless claim is in closed operational state', async () => {
    await expect(
      runCommand({
        claimId: 'claim-1',
        type: 'REOPEN',
        payload: {
          reopenReason: 'NEW_INFORMATION_RECEIVED',
          summary: 'Not allowed on active claims.',
        },
        input: { actorType: 'UNDERWRITER', actorId: 'u2', actorName: 'UW' },
      }),
    ).rejects.toThrow('Action REOPEN is only allowed when claim is CLOSED');
  });

  it('emits close event when invariants are satisfied', async () => {
    await runCommand({
      claimId: 'claim-1',
      type: 'CLOSE',
      payload: {
        closureReason: 'SETTLED',
        summary: 'Claim settled and exposure exhausted.',
        note: 'Ready to close.',
      },
      input: { actorType: 'UNDERWRITER', actorId: 'u2', actorName: 'UW' },
    });

    expect(mockTx.claimEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'CLAIM_CLOSED',
        payload: expect.objectContaining({
          closureReason: 'SETTLED',
          summary: 'Claim settled and exposure exhausted.',
          note: 'Ready to close.',
        }),
      }),
    }));
  });
});

