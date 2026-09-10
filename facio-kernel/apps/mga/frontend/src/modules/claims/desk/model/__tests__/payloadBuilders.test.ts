import { describe, expect, it } from 'vitest';
import { buildDevelopmentPayload } from '../payloadBuilders';
import type { DevFormState } from '../../../case/model/worksheetTypes';

function makeForm(overrides: Partial<DevFormState> = {}): DevFormState {
  return {
    bucket: 'INDEMNITY',
    costCategory: 'indemnity',
    costSubType: 'other',
    amount: '1200',
    effectiveDate: '2026-03-02',
    reasonCode: '',
    reason: 'test reason',
    paymentType: 'INTERIM',
    payeeType: 'CLAIMANT',
    payeeCounterpartyId: 'cp-claimant',
    showPaymentAdvanced: false,
    reference: 'REF-123',
    invoiceReference: 'INV-123',
    overrideOutstanding: '',
    recoveryType: 'THIRD_PARTY_INSURER',
    denialReason: 'NO_POLICY_COVER',
    closureReason: 'SETTLED',
    reopenReason: 'NEW_INFORMATION_RECEIVED',
    documentType: 'PHOTO',
    appointeeType: 'ADJUSTER',
    appointee: 'Smith Loss Adjusters Ltd',
    instruction: 'Inspect vehicle and provide repair estimate',
    summary: 'summary',
    deniedAt: '2026-03-02',
    closeDate: '2026-03-02',
    reopenDate: '2026-03-02',
    withdrawnAt: '2026-03-02',
    ...overrides,
  };
}

describe('buildDevelopmentPayload', () => {
  it('maps reserve payload with numeric amount', () => {
    const payload = buildDevelopmentPayload('SET_RESERVE', makeForm());
    expect(payload).toMatchObject({
      bucket: 'INDEMNITY',
      newOutstandingAmount: 1200,
      reasonCode: 'RES_IND',
      explanation: 'test reason',
    });
  });

  it('maps payment payload with overrideOutstanding when provided', () => {
    const payload = buildDevelopmentPayload(
      'ADD_PAYMENT',
      makeForm({ overrideOutstanding: '850' }),
    );
    expect(payload).toMatchObject({
      bucket: 'INDEMNITY',
      costCategory: 'indemnity',
      costSubType: 'other',
      amount: 1200,
      overrideOutstanding: 850,
      paymentType: 'INTERIM',
      payeeCounterpartyId: 'cp-claimant',
      invoiceReference: 'INV-123',
      reasonCode: 'PAY_IND_INT',
    });
  });

  it('maps final payment to zero remaining reserve automatically', () => {
    const payload = buildDevelopmentPayload('ADD_PAYMENT', makeForm({ paymentType: 'FINAL' }));
    expect(payload).toMatchObject({
      bucket: 'INDEMNITY',
      paymentType: 'FINAL',
      reasonCode: 'PAY_IND_FIN',
      overrideOutstanding: 0,
      overrideReasonCode: 'PAYMENT_FINAL_ZERO_OUTSTANDING',
    });
  });

  it('maps reserve adjust payload with signed delta amount', () => {
    const payload = buildDevelopmentPayload('ADJUST_RESERVE', makeForm({ amount: '-250.5', bucket: 'LEGAL_FEES' }));
    expect(payload).toMatchObject({
      bucket: 'LEGAL_FEES',
      deltaAmount: -250.5,
      reasonCode: 'RES_LEG',
      explanation: 'test reason',
    });
  });

  it('maps expected recovery payload with derived reason code', () => {
    const payload = buildDevelopmentPayload(
      'SET_RECOVERY_EXPECTED',
      makeForm({ bucket: 'LEGAL_FEES', recoveryType: 'SALVAGE', amount: '780.25' }),
    );
    expect(payload).toMatchObject({
      bucket: 'LEGAL_FEES',
      amount: 780.25,
      recoveryType: 'SALVAGE',
      reasonCode: 'REC_EXP_LEG_SALV',
      explanation: 'test reason',
    });
    expect(payload).not.toHaveProperty('expectedDate');
  });

  it('maps recovery received payload with derived reason code', () => {
    const payload = buildDevelopmentPayload(
      'ADD_RECOVERY_RECEIVED',
      makeForm({ bucket: 'ADJUSTER_FEES', recoveryType: 'THIRD_PARTY_INSURER', amount: '910' }),
    );
    expect(payload).toMatchObject({
      bucket: 'ADJUSTER_FEES',
      amount: 910,
      recoveryType: 'THIRD_PARTY_INSURER',
      reasonCode: 'REC_ADJ',
      explanation: 'test reason',
    });
    expect(payload).not.toHaveProperty('recoveryDate');
  });

  it('maps appointment payload with operational fields', () => {
    const payload = buildDevelopmentPayload(
      'CREATE_APPOINTMENT',
      makeForm({ appointeeType: 'LAWYER', appointee: 'LexPro Advocates LLC', instruction: 'Review liability and advise' }),
    );
    expect(payload).toMatchObject({
      appointeeType: 'LAWYER',
      appointee: 'LexPro Advocates LLC',
      instruction: 'Review liability and advise',
    });
  });

  it('maps deny claim payload with derived denial reason code', () => {
    const payload = buildDevelopmentPayload(
      'DENY_CLAIM',
      makeForm({
        denialReason: 'POLICY_NOT_IN_FORCE',
        summary: 'Claim denied because policy was not in force on date of loss.',
        reason: 'Validated inception date against reported incident date.',
      }),
    );
    expect(payload).toMatchObject({
      denialReason: 'POLICY_NOT_IN_FORCE',
      reasonCode: 'DEN_NOT_IN_FORCE',
      summary: 'Claim denied because policy was not in force on date of loss.',
      note: 'Validated inception date against reported incident date.',
    });
  });

  it('maps close payload with closure reason and summary', () => {
    const payload = buildDevelopmentPayload(
      'CLOSE',
      makeForm({
        closureReason: 'SETTLED_WITHOUT_PAYMENT',
        summary: 'Claim closed without payment after validation.',
        reason: 'No compensable loss established.',
      }),
    );
    expect(payload).toMatchObject({
      closureReason: 'SETTLED_WITHOUT_PAYMENT',
      reasonCode: 'CLS_NO_PAYMENT',
      summary: 'Claim closed without payment after validation.',
      note: 'No compensable loss established.',
    });
  });

  it('maps reopen payload with reopen reason and summary', () => {
    const payload = buildDevelopmentPayload(
      'REOPEN',
      makeForm({
        reopenReason: 'ADDITIONAL_DAMAGE_DISCOVERED',
        summary: 'Additional damage discovered after closure.',
        reason: 'Garage reported structural damage on teardown.',
      }),
    );
    expect(payload).toMatchObject({
      reopenReason: 'ADDITIONAL_DAMAGE_DISCOVERED',
      reasonCode: 'ROP_ADD_DAMAGE',
      summary: 'Additional damage discovered after closure.',
      note: 'Garage reported structural damage on teardown.',
    });
  });

  it('maps add-note payload', () => {
    const payload = buildDevelopmentPayload('ADD_CLAIM_NOTE', makeForm({ reason: 'Customer confirmed vehicle is at garage.' }));
    expect(payload).toMatchObject({
      note: 'Customer confirmed vehicle is at garage.',
    });
  });

  it('maps add-evidence payload', () => {
    const payload = buildDevelopmentPayload(
      'ADD_CLAIM_EVIDENCE',
      makeForm({
        documentType: 'REPAIR_ESTIMATE',
        reason: 'Repair estimate received from garage.',
        reference: 'file-123',
        appointee: 'estimate.pdf',
        instruction: 'https://files.example/estimate.pdf',
      }),
    );
    expect(payload).toMatchObject({
      documentType: 'REPAIR_ESTIMATE',
      note: 'Repair estimate received from garage.',
      fileId: 'file-123',
      originalFilename: 'estimate.pdf',
      fileUrl: 'https://files.example/estimate.pdf',
    });
  });

});

