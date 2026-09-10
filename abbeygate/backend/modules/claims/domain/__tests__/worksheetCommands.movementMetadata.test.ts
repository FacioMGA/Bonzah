import { beforeEach, describe, expect, it } from 'vitest';
import { resetCommandTestState, runCommand } from './worksheetCommands.testkit.js';

describe('worksheetCommands movement metadata', () => {
  beforeEach(() => {
    resetCommandTestState();
  });

  it('rejects reserve movement without reasonCode', async () => {
    await expect(
      runCommand({
        claimId: 'claim-1',
        type: 'SET_RESERVE',
        payload: { bucket: 'INDEMNITY', amount: 600, explanation: 'Missing reason code' },
        input: { actorType: 'USER', actorId: 'u1', actorName: 'Tester' },
      }),
    ).rejects.toThrow('requires reasonCode');
  });

  it('rejects payment movement without explanation', async () => {
    await expect(
      runCommand({
        claimId: 'claim-1',
        type: 'ADD_PAYMENT',
        payload: { bucket: 'INDEMNITY', amount: 100, reasonCode: 'INVOICE_RECEIVED' },
        input: { actorType: 'UNDERWRITER', actorId: 'u2', actorName: 'UW' },
      }),
    ).rejects.toThrow('requires explanation');
  });
});

