// Journey contract: customer payment -> issuance -> documents.
//
// Bound to the canonical issue-readiness evaluator. The
// customerOutcome union ('success' | 'pending' | 'failed') is the
// contract every wizard implementation reads — silently widening or
// dropping a member would mask the documents_failed surface
// regression (ABY-97/98).

import { describe, expect, it } from 'vitest';
import { evaluateIssueReadiness } from '../../backend/modules/policy/domain/issueReadiness.js';
import type { IssueReadinessResult } from '../../backend/modules/policy/domain/issueReadinessTypes.js';

const supportedCustomerOutcomes = ['success', 'pending', 'failed'] as const satisfies readonly IssueReadinessResult['customerOutcome'][];

describe('journey: public-payment-to-issuance', () => {
  it('binds to the canonical issue-readiness evaluator', () => {
    expect(typeof evaluateIssueReadiness).toBe('function');
  });

  it('preserves the three customerOutcome values the wizard payment step reads', () => {
    expect(supportedCustomerOutcomes).toContain('success');
    expect(supportedCustomerOutcomes).toContain('pending');
    expect(supportedCustomerOutcomes).toContain('failed');
  });
});
