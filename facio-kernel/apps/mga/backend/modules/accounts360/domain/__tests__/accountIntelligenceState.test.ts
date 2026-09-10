import { describe, expect, it } from 'vitest';
import { deriveAccountIntelligenceState } from '../accountIntelligenceState.js';

describe('deriveAccountIntelligenceState', () => {
  const now = new Date('2026-04-03T00:00:00.000Z');

  it('prioritizes payment issues', () => {
    const result = deriveAccountIntelligenceState({
      overdueAmount: 250,
      failedPaymentsCount: 1,
      openClaimsCount: 3,
      nextRenewalAt: new Date('2026-04-10T00:00:00.000Z'),
      now,
    });
    expect(result.state).toBe('PAYMENT_ISSUE');
    expect(result.priority).toBe(1);
    expect(result.reasons).toContain('OVERDUE_PAYMENT');
    expect(result.reasons).toContain('FAILED_PAYMENT');
  });

  it('returns claim when no payment issues exist', () => {
    const result = deriveAccountIntelligenceState({
      overdueAmount: 0,
      failedPaymentsCount: 0,
      openClaimsCount: 2,
      nextRenewalAt: new Date('2026-04-10T00:00:00.000Z'),
      now,
    });
    expect(result.state).toBe('CLAIM');
    expect(result.priority).toBe(2);
    expect(result.reasons).toContain('OPEN_CLAIM');
  });

  it('returns renewal when renewal is inside 30 days', () => {
    const result = deriveAccountIntelligenceState({
      overdueAmount: 0,
      failedPaymentsCount: 0,
      openClaimsCount: 0,
      nextRenewalAt: new Date('2026-04-20T00:00:00.000Z'),
      now,
    });
    expect(result.state).toBe('RENEWAL');
    expect(result.priority).toBe(3);
    expect(result.reasons).toContain('RENEWAL_LT_30D');
  });

  it('returns healthy when no risk signals exist', () => {
    const result = deriveAccountIntelligenceState({
      overdueAmount: 0,
      failedPaymentsCount: 0,
      openClaimsCount: 0,
      nextRenewalAt: null,
      now,
    });
    expect(result.state).toBe('HEALTHY');
    expect(result.priority).toBe(4);
  });
});
