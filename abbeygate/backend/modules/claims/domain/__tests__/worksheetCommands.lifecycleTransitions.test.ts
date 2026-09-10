import { beforeEach, describe, expect, it } from 'vitest';
import { baseProjection, mockBuildClaimWorksheetProjection, mockTx, resetCommandTestState, runCommand } from './worksheetCommands.testkit.js';

describe('worksheetCommands lifecycle transitions', () => {
  beforeEach(() => {
    resetCommandTestState();
  });

  it('DENY_CLAIM emits denial events and writes denied snapshot fields', async () => {
    const openProjection = {
      ...baseProjection(),
      totalPaid: 0,
      totalOutstanding: 0,
      reserveIndemnity: 0,
      phase: 'DECISION',
      buckets: {
        ...baseProjection().buckets,
        INDEMNITY: { ...baseProjection().buckets.INDEMNITY, outstanding: 0 },
      },
    };
    mockBuildClaimWorksheetProjection
      .mockReturnValueOnce(openProjection)
      .mockReturnValueOnce({
        ...openProjection,
        status: 'DENIED',
        cr0107Denial: 'Y',
        denied: true,
        deniedAt: '2026-04-07T10:00:00.000Z',
        denialReason: 'Policy was not in force on loss date.',
      })
      .mockReturnValueOnce({
        ...openProjection,
        status: 'DENIED',
        cr0107Denial: 'Y',
        denied: true,
        deniedAt: '2026-04-07T10:00:00.000Z',
        denialReason: 'Policy was not in force on loss date.',
      });

    await runCommand({
      claimId: 'claim-1',
      type: 'DENY_CLAIM',
      payload: {
        denialReason: 'POLICY_NOT_IN_FORCE',
        summary: 'Policy was not in force on loss date.',
        note: 'Coverage validation confirmed inception date after incident date.',
      },
      input: { actorType: 'UNDERWRITER', actorId: 'uw-1', actorName: 'UW One' },
    });

    expect(mockTx.claimEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'CLAIM_DENIED',
        payload: expect.objectContaining({
          denialReason: 'POLICY_NOT_IN_FORCE',
          reasonCode: 'DEN_NOT_IN_FORCE',
          summary: 'Policy was not in force on loss date.',
          communicationRequired: 'DENIAL_LETTER',
        }),
      }),
    }));
    expect(mockTx.claimEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'DENIAL_COMMUNICATION_REQUIRED',
        payload: expect.objectContaining({
          communicationType: 'DENIAL_LETTER',
        }),
      }),
    }));
    expect(mockTx.claim.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'DENIED',
      }),
    }));
  });

  it('CLOSE emits CLAIM_CLOSED when closure invariants are satisfied', async () => {
    mockBuildClaimWorksheetProjection.mockReturnValue({
      ...baseProjection(),
      status: 'OPEN',
      phase: 'SETTLEMENT',
      totalOutstanding: 0,
      reserveIndemnity: 0,
      recoveriesExpected: 0,
      salvageExpected: 0,
      buckets: {
        ...baseProjection().buckets,
        INDEMNITY: { ...baseProjection().buckets.INDEMNITY, outstanding: 0, recoveryExpected: 0, salvageExpected: 0 },
      },
    });

    await runCommand({
      claimId: 'claim-1',
      type: 'CLOSE',
      payload: {
        closureReason: 'SETTLED',
        summary: 'Claim settled in full and operational handling is complete.',
        note: 'No expected recovery remains.',
      },
      input: { actorType: 'USER', actorId: 'u-1', actorName: 'Handler' },
    });

    expect(mockTx.claimEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'CLAIM_CLOSED',
        payload: expect.objectContaining({
          closureReason: 'SETTLED',
          summary: 'Claim settled in full and operational handling is complete.',
          note: 'No expected recovery remains.',
        }),
      }),
    }));
  });

  it('REOPEN emits CLAIM_REOPENED only from closed operational state', async () => {
    mockBuildClaimWorksheetProjection.mockReturnValue({
      ...baseProjection(),
      status: 'CLOSED',
      phase: 'CLOSED',
      totalOutstanding: 0,
      reserveIndemnity: 0,
      buckets: {
        ...baseProjection().buckets,
        INDEMNITY: { ...baseProjection().buckets.INDEMNITY, outstanding: 0 },
      },
    });

    await runCommand({
      claimId: 'claim-1',
      type: 'REOPEN',
      payload: {
        reopenReason: 'NEW_INFORMATION_RECEIVED',
        summary: 'New information received from the repairer.',
        note: 'Reopen for technical reassessment.',
      },
      input: { actorType: 'USER', actorId: 'u-1', actorName: 'Handler' },
    });

    expect(mockTx.claimEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'CLAIM_REOPENED',
        payload: expect.objectContaining({
          reopenReason: 'NEW_INFORMATION_RECEIVED',
          summary: 'New information received from the repairer.',
          note: 'Reopen for technical reassessment.',
        }),
      }),
    }));
  });
});
