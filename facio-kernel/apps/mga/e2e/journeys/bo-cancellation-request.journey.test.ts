// Journey contract: BO cancellation request -> draft.
//
// Bound to the canonical cancellation route registrar. Deeper proof
// (state transitions, refund maths, audit ledger) lives in
// policy_lifecycle.test.ts and cancellations.test.ts.

import { describe, expect, it } from 'vitest';
import { registerPolicyCancellationRoutes } from '../../backend/modules/policy/http/cancellationsRouter.js';

describe('journey: bo-cancellation-request', () => {
  it('exposes the canonical cancellation route registrar', () => {
    expect(typeof registerPolicyCancellationRoutes).toBe('function');
    expect(registerPolicyCancellationRoutes.length).toBeGreaterThanOrEqual(1);
  });
});
