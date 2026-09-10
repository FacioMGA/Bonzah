import { describe, expect, it } from 'vitest';
import { mergeIssueReadinessProjection } from '../issueReadinessUpdater.js';

describe('mergeIssueReadinessProjection', () => {
  it('marks issued when payment-bound documents are ready even if welcome email has not yet sent', () => {
    const merged = mergeIssueReadinessProjection({}, {
      hasBoundInceptionTransaction: true,
      hasIssuedPackDocuments: true,
      hasWelcomeEmailSent: false,
    });
    expect(merged.changed).toBe(true);
    expect(merged.next.customerOutcome).toBe('issued');
    expect(merged.next.version).toBe(1);
  });

  it('is monotonic for booleans and keeps unchanged payload stable', () => {
    const baseline = {
      version: 2,
      updatedAt: new Date().toISOString(),
      hasBoundInceptionTransaction: true,
      hasIssuedPackDocuments: false,
      hasWelcomeEmailSent: false,
      customerOutcome: 'pending',
    };
    const merged = mergeIssueReadinessProjection(baseline, {
      hasBoundInceptionTransaction: false,
    });
    expect(merged.changed).toBe(false);
    expect(merged.next.hasBoundInceptionTransaction).toBe(true);
    expect(merged.next.version).toBe(2);
  });
});
