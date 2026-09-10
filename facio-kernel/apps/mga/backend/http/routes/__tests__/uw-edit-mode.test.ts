import { describe, expect, it } from 'vitest';
import { resolveUwEditMode } from '../../../modules/policy/app/shared.js';

describe('resolveUwEditMode', () => {
  it('returns endorsementDraft when risk transaction is present', () => {
    expect(resolveUwEditMode({ policyStatus: 'ISSUED', riskTransactionId: 'rt-1' })).toBe('endorsementDraft');
  });

  it('returns readOnly for issued lifecycle without draft', () => {
    expect(resolveUwEditMode({ policyStatus: 'ACTIVE' })).toBe('readOnly');
    expect(resolveUwEditMode({ policyStatus: 'BOUND' })).toBe('readOnly');
  });

  it('returns preBind for non-issued statuses', () => {
    expect(resolveUwEditMode({ policyStatus: 'DRAFT' })).toBe('preBind');
    expect(resolveUwEditMode({ policyStatus: 'REFERRAL' })).toBe('preBind');
  });
});
