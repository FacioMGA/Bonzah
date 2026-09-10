import { beforeEach, describe, expect, it } from 'vitest';
import { baseProjection, mockAppendDomainEvent, mockBuildClaimWorksheetProjection, mockTx, resetCommandTestState, runCommand } from './worksheetCommands.testkit.js';

describe('worksheetCommands large loss trigger', () => {
  beforeEach(() => {
    resetCommandTestState();
    process.env.CLAIM_LARGE_LOSS_THRESHOLD = '700';
  });

  it('emits LARGE_LOSS_FLAGGED and corresponding outbox domain event once threshold crossed', async () => {
    mockBuildClaimWorksheetProjection.mockImplementation(() => ({
      ...baseProjection(),
      totalIncurred: 800,
      reserveIndemnity: 800,
      totalOutstanding: 800,
    }));

    await expect(
      runCommand({
        claimId: 'claim-1',
        type: 'SET_RESERVE',
        payload: { bucket: 'INDEMNITY', amount: 800, reasonCode: 'EXPERT_REPORT', explanation: 'Severe damages' },
        input: { actorType: 'UNDERWRITER', actorId: 'u2', actorName: 'UW' },
      }),
    ).resolves.toBeUndefined();

    expect(mockTx.claimEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'LARGE_LOSS_FLAGGED',
        }),
      }),
    );
    expect(
      mockAppendDomainEvent.mock.calls.some(
        (call) =>
          Boolean(call[1]) &&
          typeof call[1] === 'object' &&
          (call[1] as { eventType?: string }).eventType === 'CLAIM.LARGE_LOSS_FLAGGED',
      ),
    ).toBe(true);
  });

  it('does not re-emit large loss when already flagged', async () => {
    mockTx.claim.findUnique
      .mockResolvedValueOnce({
        id: 'claim-1',
        policyId: 'policy-1',
        claimNumber: 'CLM-1',
        data: { cr0029_certificate_reference: 'CERT-1' },
        events: [],
      })
      .mockResolvedValueOnce({
        id: 'claim-1',
        claimNumber: 'CLM-1',
        data: { cr0029_certificate_reference: 'CERT-1' },
        events: [{ id: 'flag-1', eventType: 'LARGE_LOSS_FLAGGED', occurredAt: new Date(), payload: {}, actorName: 'system' }],
      });
    mockBuildClaimWorksheetProjection.mockReturnValue({
      ...baseProjection(),
      totalIncurred: 900,
      reserveIndemnity: 900,
      totalOutstanding: 900,
    });

    await runCommand({
      claimId: 'claim-1',
      type: 'SET_RESERVE',
      payload: { bucket: 'INDEMNITY', amount: 900, reasonCode: 'COURT_UPDATE', explanation: 'Court order update' },
      input: { actorType: 'UNDERWRITER', actorId: 'u2', actorName: 'UW' },
    });

    const flaggedEventCreates = mockTx.claimEvent.create.mock.calls.filter(
      (call) =>
        Boolean(call[0]) &&
        typeof call[0] === 'object' &&
        ((call[0] as { data?: { eventType?: string } }).data?.eventType === 'LARGE_LOSS_FLAGGED'),
    );
    expect(flaggedEventCreates).toHaveLength(0);
  });
});

