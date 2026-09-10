import { beforeEach, describe, expect, it } from 'vitest';
import { baseProjection, mockBuildClaimWorksheetProjection, mockTx, resetCommandTestState, runCommand } from './worksheetCommands.testkit.js';

describe('worksheetCommands intake lifecycle', () => {
  beforeEach(() => {
    resetCommandTestState();
  });

  it('supports submit -> confirm -> amend with reconfirm required', async () => {
    await runCommand({
      claimId: 'claim-1',
      type: 'SUBMIT_FNOL',
      payload: { fnol: { incident: { type: 'collision', date: '2026-03-01', location: { address: 'Nicosia' }, description: 'Initial narrative' } } },
      input: { actorType: 'USER', actorId: 'u1', actorName: 'Tester' },
    });
    await runCommand({
      claimId: 'claim-1',
      type: 'CONFIRM_FNOL',
      payload: {},
      input: { actorType: 'UNDERWRITER', actorId: 'u2', actorName: 'UW' },
    });
    await runCommand({
      claimId: 'claim-1',
      type: 'AMEND_FNOL',
      payload: {
        fnol: { incident: { type: 'collision', date: '2026-03-02', location: { address: 'Nicosia' }, description: 'Amended narrative' } },
        changes: [{ path: 'incident.date', from: '2026-03-01', to: '2026-03-02' }],
      },
      input: { actorType: 'USER', actorId: 'u1', actorName: 'Tester' },
    });

    mockBuildClaimWorksheetProjection.mockReturnValueOnce({
      ...baseProjection(),
      intake: { ...baseProjection().intake, status: 'FNOL_SUBMITTED', confirmedVersion: undefined },
    });
    await expect(
      runCommand({
        claimId: 'claim-1',
        type: 'SET_RESERVE',
        payload: { bucket: 'INDEMNITY', amount: 700, reasonCode: 'INCREASE_SCOPE', explanation: 'Post-amend reserve' },
        input: { actorType: 'USER', actorId: 'u1', actorName: 'Tester' },
      }),
    ).rejects.toThrow('FNOL must be confirmed');

    expect(mockTx.claimEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'FNOL_SUBMITTED' }) }));
    expect(mockTx.claimEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'FNOL_CONFIRMED' }) }));
    expect(mockTx.claimEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'FNOL_AMENDED' }) }));
  });

  it('fails FNOL confirm when gating is not satisfied', async () => {
    mockBuildClaimWorksheetProjection.mockReturnValueOnce({
      ...baseProjection(),
      intake: {
        ...baseProjection().intake,
        gates: [...baseProjection().intake.gates.filter((gate) => gate.key !== 'lossTypePresent'), { key: 'lossTypePresent', label: 'Loss type present', status: 'FAIL' }],
      },
    });

    await expect(
      runCommand({
        claimId: 'claim-1',
        type: 'CONFIRM_FNOL',
        payload: {},
        input: { actorType: 'UNDERWRITER', actorId: 'u2', actorName: 'UW' },
      }),
    ).rejects.toThrow('Cannot confirm FNOL while gates are failing');
  });
});

