import { describe, expect, it } from 'vitest';
import { evaluatePolicyCompliance } from '../policyCompliance.js';

function baseInput() {
  return {
    policyNumber: 'ABOLV9999999',
    status: 'ISSUED',
    binderId: 'binder-1',
    programId: 'program-1',
    paymentStatus: 'PAID',
    inceptionDate: new Date('2026-02-01T00:00:00.000Z'),
    expiryDate: new Date('2027-02-01T00:00:00.000Z'),
    isLocked: true,
    quoteData: {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane.doe@example.org',
    },
    stateCurrentSnapshot: {},
    riskTransactions: [{ status: 'BOUND', transactionType: 'INCEPTION' }],
    claims: [],
    outstandingBalance: 0,
    invoiceOverdue: false,
    totalPremium: 100,
  };
}

describe('policy compliance coverage document checks', () => {
  it('treats motor schedule/certificate PDFs as valid coverage docs', () => {
    const result = evaluatePolicyCompliance({
      ...baseInput(),
      documents: [
        { status: 'GENERATED', type: 'MOTOR_SCHEDULE_PDF' },
        { status: 'GENERATED', type: 'MOTOR_CERTIFICATE_PDF' },
      ],
    });

    expect(result.reasonCodes).not.toContain('MISSING_COVERAGE_DOCS');
  });

  it('still flags missing coverage docs for non-coverage document types', () => {
    const result = evaluatePolicyCompliance({
      ...baseInput(),
      documents: [{ status: 'GENERATED', type: 'INVOICE_PDF' }],
    });

    expect(result.reasonCodes).toContain('MISSING_COVERAGE_DOCS');
  });

  it('rejects loose schedule-like names that are not coverage PDFs (ADR-0011 strict match)', () => {
    const result = evaluatePolicyCompliance({
      ...baseInput(),
      documents: [
        { status: 'GENERATED', type: 'CERTIFICATE_OF_DAMAGE' },
        { status: 'GENERATED', type: 'SCHEDULE_OF_REPAIRS' },
      ],
    });

    // Neither has the `_PDF` suffix — they must not satisfy the coverage check.
    expect(result.reasonCodes).toContain('MISSING_COVERAGE_DOCS');
  });

  it('surfaces failed BDX migration compliance reasons from the policy snapshot', () => {
    const result = evaluatePolicyCompliance({
      ...baseInput(),
      documents: [
        { status: 'GENERATED', type: 'MOTOR_SCHEDULE_PDF' },
        { status: 'GENERATED', type: 'MOTOR_CERTIFICATE_PDF' },
      ],
      stateCurrentSnapshot: {
        bdxImport: {
          migrationCompliance: {
            state: 'FAIL',
            reasonCodes: ['BDX_RECONCILIATION_OVER_20_PCT'],
          },
        },
      },
    });

    expect(result.state).toBe('FAIL');
    expect(result.reasonCodes).toContain('BDX_RECONCILIATION_OVER_20_PCT');
  });

  it('uses the canonical version-history transaction-type set for hasBoundBaseline', () => {
    // ENDORSEMENT is a version-history transaction type per
    // domain/riskTransactionTypes.ts; both INCEPTION and ENDORSEMENT
    // satisfy the bound-baseline requirement.
    const result = evaluatePolicyCompliance({
      ...baseInput(),
      riskTransactions: [{ status: 'BOUND', transactionType: 'ENDORSEMENT' }],
      documents: [
        { status: 'GENERATED', type: 'MOTOR_SCHEDULE_PDF' },
        { status: 'GENERATED', type: 'MOTOR_CERTIFICATE_PDF' },
      ],
    });

    expect(result.reasonCodes).not.toContain('MISSING_BOUND_BASELINE');
  });
});
