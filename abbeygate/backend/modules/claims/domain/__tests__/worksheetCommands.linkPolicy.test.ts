import { beforeEach, describe, expect, it } from 'vitest';
import { mockTx, resetCommandTestState, runCommand } from './worksheetCommands.testkit.js';

describe('worksheetCommands link policy', () => {
  beforeEach(() => {
    resetCommandTestState();
  });

  it('links an unlinked case policy exactly once', async () => {
    mockTx.claim.findUnique.mockResolvedValueOnce({
      id: 'claim-1',
      policyId: null,
      claimNumber: 'CLM-1',
      data: { cr0029_certificate_reference: 'CERT-1' },
      events: [],
    });

    await expect(
      runCommand({
        claimId: 'claim-1',
        type: 'LINK_POLICY',
        payload: { policyId: 'policy-1', linkReason: 'identified via search' },
        input: { actorType: 'USER', actorId: 'u1', actorName: 'Tester' },
      }),
    ).resolves.toBeUndefined();

    expect(mockTx.claim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          policyId: 'policy-1',
        }),
      }),
    );
    expect(mockTx.claimEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'POLICY_LINKED',
        }),
      }),
    );
  });

  it('rejects relinking when policy already exists', async () => {
    await expect(
      runCommand({
        claimId: 'claim-1',
        type: 'LINK_POLICY',
        payload: { policyId: 'policy-2' },
        input: { actorType: 'USER', actorId: 'u1', actorName: 'Tester' },
      }),
    ).rejects.toThrow('Policy already linked');
  });
});

