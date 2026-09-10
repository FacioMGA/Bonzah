import { describe, expect, it } from 'vitest';
import {
  getPaymentProviderLabel,
  getPaymentTransactionStatusLabel,
  getPaymentTransactionTypeLabel,
  getPolicyDocumentTypeLabel,
  getReconciliationStatusLabel,
  humanizePolicyStatus,
} from './policyDisplayLabels';

describe('policyDisplayLabels', () => {
  it('maps known policy lifecycle enums to user-friendly labels', () => {
    expect(humanizePolicyStatus('AWAITING_PAYMENT')).toBe('Awaiting payment');
    expect(humanizePolicyStatus('BOUND_DRAFT_ISSUED')).toBe('Bound');
    expect(humanizePolicyStatus('ENDORSEMENT_IN_PROGRESS')).toBe('Endorsement in progress');
  });

  it('falls back to title-casing unknown enum values', () => {
    expect(humanizePolicyStatus('SOMETHING_CUSTOM')).toBe('Something Custom');
  });

  it('maps policy document types to user-friendly labels', () => {
    expect(getPolicyDocumentTypeLabel('MOTOR_SCHEDULE_PDF')).toBe('Schedule');
    expect(getPolicyDocumentTypeLabel('MOTOR_GREEN_CARD_PDF')).toBe('Green Card');
    expect(getPolicyDocumentTypeLabel('HOME_POLICY_WORDING_PDF')).toBe('Policy Wording');
    expect(getPolicyDocumentTypeLabel('HOME_EUROP_ASSISTANCE_PDF')).toBe('Europ Assistance');
  });

  it('maps payment and reconciliation codes to user-friendly labels', () => {
    expect(getPaymentTransactionStatusLabel('CREDIT_CREATED')).toBe('Credit created');
    expect(getPaymentTransactionTypeLabel('charge')).toBe('Charge');
    expect(getPaymentProviderLabel('CARDCORP')).toBe('CardCorp');
    expect(getReconciliationStatusLabel('UNAPPLIED')).toBe('Unapplied');
  });
});
