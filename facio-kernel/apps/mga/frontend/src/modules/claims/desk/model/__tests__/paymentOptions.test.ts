import { describe, expect, it } from 'vitest';
import type { DevFormState, Worksheet } from '../../../case/model/worksheetTypes';
import {
  getEligibleClaimPaymentPayees,
  getClaimPaymentOptionalSubtypeOptions,
  sanitizeClaimPaymentSelection,
} from '../paymentOptions';

function makeWorksheet(): Worksheet {
  return {
    claimId: 'claim-1',
    claimReference: 'CLM-1',
    policyId: 'policy-1',
    policyNumber: 'POL-1',
    topBar: { status: 'OPEN', phase: 'INVESTIGATION', referredToUw: 'N', denied: 'N' },
    summary: {
      financials: {
        totalPaid: 0,
        totalOutstanding: 0,
        totalIncurred: 0,
        totalRecovered: 0,
        netIncurred: 0,
        recoveriesExpected: 0,
        buckets: {},
      },
    },
    timeline: [],
    documents: [],
    complianceGaps: [],
    paymentModel: {
      classifications: [
        {
          costCategory: 'fees',
          costSubType: 'attorney_coverage_fee',
          allowedPayeeRoles: ['legal_provider'],
          reportingTreatment: 'fees',
          operationalBucket: 'LEGAL_FEES',
          requiresInvoiceReference: true,
          requiresNote: false,
          uiLabel: 'Attorney coverage fee',
          guidance: null,
        },
        {
          costCategory: 'indemnity',
          costSubType: 'other',
          allowedPayeeRoles: ['insured', 'claimant', 'third_party', 'repairer'],
          reportingTreatment: 'indemnity',
          operationalBucket: 'INDEMNITY',
          requiresInvoiceReference: false,
          requiresNote: false,
          uiLabel: 'Indemnity',
          guidance: null,
        },
        {
          costCategory: 'indemnity',
          costSubType: 'defence_fee',
          allowedPayeeRoles: ['legal_provider'],
          reportingTreatment: 'indemnity',
          operationalBucket: 'DEFENCE_COSTS',
          requiresInvoiceReference: true,
          requiresNote: false,
          uiLabel: 'Defence fee',
          guidance: 'Policy-liability defence fees are treated as indemnity for reporting.',
        },
      ],
      payees: [
        {
          id: 'cp-legal',
          claimId: 'claim-1',
          name: 'LexPro Advocates LLC',
          entityType: 'organisation',
          roles: ['legal_provider'],
          status: 'ACTIVE',
        },
        {
          id: 'cp-repairer',
          claimId: 'claim-1',
          name: 'Papadopoulos Repairs Ltd',
          entityType: 'organisation',
          roles: ['repairer'],
          status: 'ACTIVE',
        },
      ],
    },
    comms: { entityType: 'CLAIM', entityId: 'claim-1' },
  };
}

function makeForm(overrides: Partial<DevFormState> = {}): DevFormState {
  return {
    bucket: 'LEGAL_FEES',
    costCategory: 'fees',
    costSubType: 'attorney_coverage_fee',
    amount: '100',
    effectiveDate: '2026-04-07',
    reasonCode: '',
    reason: '',
    paymentType: 'INTERIM',
    payeeType: 'CLAIMANT',
    payeeCounterpartyId: 'cp-legal',
    showPaymentAdvanced: false,
    reference: '',
    invoiceReference: '',
    overrideOutstanding: '',
    recoveryType: 'THIRD_PARTY_INSURER',
    denialReason: 'NO_POLICY_COVER',
    closureReason: 'SETTLED',
    reopenReason: 'NEW_INFORMATION_RECEIVED',
    documentType: 'PHOTO',
    appointeeType: 'ADJUSTER',
    appointee: '',
    instruction: '',
    summary: '',
    deniedAt: '2026-04-07',
    closeDate: '2026-04-07',
    reopenDate: '2026-04-07',
    withdrawnAt: '2026-04-07',
    ...overrides,
  };
}

describe('paymentOptions', () => {
  it('filters payees by eligible role for the selected classification', () => {
    const eligible = getEligibleClaimPaymentPayees(makeWorksheet(), 'fees', 'attorney_coverage_fee');
    expect(eligible.map((item) => item.id)).toEqual(['cp-legal']);
  });

  it('hides the default indemnity subtype from optional subtype choices', () => {
    const optionalSubtypes = getClaimPaymentOptionalSubtypeOptions(makeWorksheet(), 'indemnity');
    expect(optionalSubtypes.map((item) => item.costSubType)).toEqual(['defence_fee']);
  });

  it('clears an incompatible payee when the subtype changes', () => {
    const worksheet = makeWorksheet();
    const next = sanitizeClaimPaymentSelection(
      worksheet,
      makeForm({
        costCategory: 'indemnity',
        costSubType: 'other',
        bucket: 'LEGAL_FEES',
        payeeCounterpartyId: 'cp-legal',
      }),
    );
    expect(next.bucket).toBe('INDEMNITY');
    expect(next.payeeCounterpartyId).toBe('');
  });
});
