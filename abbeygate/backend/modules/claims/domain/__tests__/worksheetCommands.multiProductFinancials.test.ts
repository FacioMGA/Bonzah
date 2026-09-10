import { beforeEach, describe, expect, it } from 'vitest';
import {
  baseProjection,
  mockBuildClaimWorksheetProjection,
  mockTx,
  resetCommandTestState,
  runCommand,
} from './worksheetCommands.testkit.js';

describe('worksheetCommands multi-product financial parity', () => {
  beforeEach(() => {
    resetCommandTestState();
    mockBuildClaimWorksheetProjection.mockReturnValue(baseProjection());
  });

  for (const scenario of [
    { productType: 'HOME', quoteData: { proposer: { firstName: 'Ada' }, property: { propertyType: 'Villa' } } },
    { productType: 'TRAVEL', quoteData: { proposer: { firstName: 'Ada' }, trip: { planType: 'single_trip' } } },
  ]) {
    it(`emits the same reserve and recovery events for ${scenario.productType}`, async () => {
      mockTx.policy.findUnique.mockResolvedValue({
        id: 'policy-1',
        productType: scenario.productType,
        quoteData: scenario.quoteData,
      });

      await runCommand({
        claimId: 'claim-1',
        type: 'SET_RESERVE',
        payload: {
          bucket: 'INDEMNITY',
          amount: 400,
          reasonCode: 'INITIAL_ASSESSMENT',
          explanation: 'Initial reserve',
        },
        input: { actorType: 'UNDERWRITER', actorId: 'uw-1', actorName: 'Underwriter' },
      });

      await runCommand({
        claimId: 'claim-1',
        type: 'SET_RECOVERY_EXPECTED',
        payload: {
          amount: 100,
          reasonCode: 'SUBROGATION_OPENED',
          explanation: 'Expected subrogation recovery',
        },
        input: { actorType: 'UNDERWRITER', actorId: 'uw-1', actorName: 'Underwriter' },
      });

      await runCommand({
        claimId: 'claim-1',
        type: 'ADD_RECOVERY_RECEIVED',
        payload: {
          amount: 50,
          reasonCode: 'SUBROGATION_RECEIVED',
          explanation: 'Partial recovery received',
        },
        input: { actorType: 'UNDERWRITER', actorId: 'uw-1', actorName: 'Underwriter' },
      });

      const eventTypes = mockTx.claimEvent.create.mock.calls.map((call) => String((call[0] as { data?: { eventType?: string } }).data?.eventType || ''));
      expect(eventTypes).toEqual(expect.arrayContaining(['RESERVE_SET', 'RECOVERY_EXPECTED', 'RECOVERY_RECEIVED']));
    });

    it(`enforces the same payment over-outstanding rule for ${scenario.productType}`, async () => {
      mockTx.policy.findUnique.mockResolvedValue({
        id: 'policy-1',
        productType: scenario.productType,
        quoteData: scenario.quoteData,
      });

      await expect(
        runCommand({
          claimId: 'claim-1',
          type: 'ADD_PAYMENT',
          payload: {
            bucket: 'INDEMNITY',
            amount: 600,
            reasonCode: 'SETTLEMENT',
            explanation: 'Attempted overpayment',
            paymentType: 'INTERIM',
            payeeName: 'Claimant',
            payeeType: 'claimant',
          },
          input: { actorType: 'UNDERWRITER', actorId: 'uw-1', actorName: 'Underwriter' },
        }),
      ).rejects.toThrow('Payment exceeds outstanding in strict mode');
    });
  }
});
