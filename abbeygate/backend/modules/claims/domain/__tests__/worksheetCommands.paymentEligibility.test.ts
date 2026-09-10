import { beforeEach, describe, expect, it } from 'vitest';
import {
  baseProjection,
  mockBuildClaimWorksheetProjection,
  mockTx,
  resetCommandTestState,
  runCommand,
} from './worksheetCommands.testkit.js';

describe('worksheetCommands payment eligibility', () => {
  beforeEach(() => {
    resetCommandTestState();
  });

  it('records attorney coverage fee payments only for legal providers', async () => {
    mockBuildClaimWorksheetProjection.mockReturnValue({
      ...baseProjection(),
      buckets: {
        ...baseProjection().buckets,
        LEGAL_FEES: { paid: 0, outstanding: 600, recovered: 0, recoveryExpected: 0, salvageRealized: 0, salvageExpected: 0 },
      },
      reserveFees: 600,
      totalOutstanding: 1100,
      totalIncurred: 1100,
      totalIncurredFees: 600,
      totalIncurredOverall: 1100,
    });
    mockTx.claimCounterparty.findFirst.mockResolvedValueOnce({
      id: 'cp-legal',
      claimId: 'claim-1',
      name: 'LexPro Advocates LLC',
      entityType: 'organisation',
      roles: ['legal_provider'],
      status: 'ACTIVE',
      providerType: 'lawyer',
    });

    await runCommand({
      claimId: 'claim-1',
      type: 'ADD_PAYMENT',
      payload: {
        costCategory: 'fees',
        costSubType: 'attorney_coverage_fee',
        payeeCounterpartyId: 'cp-legal',
          invoiceReference: 'INV-LEGAL-1',
        amount: 250,
        paymentType: 'INTERIM',
        reasonCode: 'SETTLEMENT',
        explanation: 'Coverage counsel invoice',
      },
      input: { actorType: 'UNDERWRITER', actorId: 'u1', actorName: 'Tester' },
    });

    expect(mockTx.claimEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'PAYMENT_ADDED',
        payload: expect.objectContaining({
          bucket: 'LEGAL_FEES',
          costCategory: 'fees',
          costSubType: 'attorney_coverage_fee',
          reportingTreatment: 'fees',
          payeeCounterpartyId: 'cp-legal',
          payeeRoleUsed: 'legal_provider',
          payeeName: 'LexPro Advocates LLC',
        }),
      }),
    }));
  });

  it('rejects incompatible payee roles for the selected classification', async () => {
    mockBuildClaimWorksheetProjection.mockReturnValue({
      ...baseProjection(),
      buckets: {
        ...baseProjection().buckets,
        LEGAL_FEES: { paid: 0, outstanding: 600, recovered: 0, recoveryExpected: 0, salvageRealized: 0, salvageExpected: 0 },
      },
      reserveFees: 600,
      totalOutstanding: 1100,
      totalIncurred: 1100,
      totalIncurredFees: 600,
      totalIncurredOverall: 1100,
    });
    mockTx.claimCounterparty.findFirst.mockResolvedValueOnce({
      id: 'cp-repairer',
      claimId: 'claim-1',
      name: 'Papadopoulos Repairs Ltd',
      entityType: 'organisation',
      roles: ['repairer'],
      status: 'ACTIVE',
      providerType: 'garage',
    });

    await expect(
      runCommand({
        claimId: 'claim-1',
        type: 'ADD_PAYMENT',
        payload: {
          costCategory: 'fees',
          costSubType: 'attorney_coverage_fee',
          payeeCounterpartyId: 'cp-repairer',
          invoiceReference: 'INV-LEGAL-2',
          amount: 250,
          paymentType: 'INTERIM',
          reasonCode: 'SETTLEMENT',
          explanation: 'Invalid payee for legal fee',
        },
        input: { actorType: 'UNDERWRITER', actorId: 'u2', actorName: 'Tester' },
      }),
    ).rejects.toThrow('Invalid payee role for selected claim payment classification.');
  });

  it('rejects split indemnity/fees payment payloads', async () => {
    await expect(
      runCommand({
        claimId: 'claim-1',
        type: 'ADD_PAYMENT',
        payload: {
          costCategory: 'indemnity',
          costSubType: 'other',
          indemnityAmount: 250,
          paymentType: 'INTERIM',
          reasonCode: 'SETTLEMENT',
          explanation: 'Retired split payment payload',
        },
        input: { actorType: 'UNDERWRITER', actorId: 'u2', actorName: 'Tester' },
      }),
    ).rejects.toThrow('Use amount with costCategory and costSubType for claim payments');
    expect(mockTx.claimEvent.create).not.toHaveBeenCalled();
  });

  it('treats defence fee payments as indemnity for reporting', async () => {
    mockBuildClaimWorksheetProjection.mockReturnValue({
      ...baseProjection(),
      buckets: {
        ...baseProjection().buckets,
        DEFENCE_COSTS: { paid: 0, outstanding: 400, recovered: 0, recoveryExpected: 0, salvageRealized: 0, salvageExpected: 0 },
      },
      reserveIndemnity: 900,
      totalOutstanding: 900,
      totalIncurred: 900,
      totalIncurredIndemnity: 900,
      totalIncurredOverall: 900,
    });
    mockTx.claimCounterparty.findFirst.mockResolvedValueOnce({
      id: 'cp-defence',
      claimId: 'claim-1',
      name: 'Defence Counsel Ltd',
      entityType: 'organisation',
      roles: ['legal_provider'],
      status: 'ACTIVE',
      providerType: 'lawyer',
    });

    await runCommand({
      claimId: 'claim-1',
      type: 'ADD_PAYMENT',
      payload: {
        costCategory: 'indemnity',
        costSubType: 'defence_fee',
        payeeCounterpartyId: 'cp-defence',
        invoiceReference: 'INV-DEF-1',
        amount: 100,
        paymentType: 'INTERIM',
        reasonCode: 'SETTLEMENT',
        explanation: 'Defence counsel interim invoice',
      },
      input: { actorType: 'UNDERWRITER', actorId: 'u3', actorName: 'Tester' },
    });

    expect(mockTx.claimEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          bucket: 'DEFENCE_COSTS',
          costCategory: 'indemnity',
          costSubType: 'defence_fee',
          reportingTreatment: 'indemnity',
          payeeRoleUsed: 'legal_provider',
        }),
      }),
    }));
  });
});
