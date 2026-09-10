import { describe, expect, it } from 'vitest';
import { deriveAccountHealth } from '../health.js';

describe('deriveAccountHealth', () => {
  it('returns HEALTHY for low-signal accounts', () => {
    const result = deriveAccountHealth({
      overdueBalance: 0,
      failedPayments: 0,
      openClaimsCount: 0,
      renewalIn30DaysCount: 0,
      billingIssueCount: 0,
      cancellationSignals: 0,
    });
    expect(result.status).toBe('HEALTHY');
    expect(result.score).toBe(0);
  });

  it('returns ATTENTION for moderate risk accounts', () => {
    const result = deriveAccountHealth({
      overdueBalance: 0,
      failedPayments: 1,
      openClaimsCount: 1,
      renewalIn30DaysCount: 0,
      billingIssueCount: 1,
      cancellationSignals: 0,
    });
    expect(result.status).toBe('ATTENTION');
    expect(result.reasons).toContain('FAILED_PAYMENT');
    expect(result.reasons).toContain('OPEN_CLAIMS');
  });

  it('returns AT_RISK for high-signal accounts', () => {
    const result = deriveAccountHealth({
      overdueBalance: 2500,
      failedPayments: 2,
      openClaimsCount: 3,
      renewalIn30DaysCount: 1,
      billingIssueCount: 3,
      cancellationSignals: 1,
    });
    expect(result.status).toBe('AT_RISK');
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.reasons).toContain('OVERDUE_BALANCE');
  });
});
