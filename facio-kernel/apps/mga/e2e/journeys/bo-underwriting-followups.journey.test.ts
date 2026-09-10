// Journey contract: BO underwriting follow-ups lifecycle.
//
// Bound to the canonical UW follow-up router registrar. Deeper proof
// (state machine, email triggers, audit) lives in
// uw-edit-mode.test.ts and the next-best-action tests.

import { describe, expect, it } from 'vitest';
import { registerUwFollowUpRoutes } from '../../backend/modules/policy/http/uwFollowUpRouter.js';

describe('journey: bo-underwriting-followups', () => {
  it('exposes the canonical UW follow-up route registrar', () => {
    expect(typeof registerUwFollowUpRoutes).toBe('function');
    expect(registerUwFollowUpRoutes.length).toBeGreaterThanOrEqual(1);
  });
});
