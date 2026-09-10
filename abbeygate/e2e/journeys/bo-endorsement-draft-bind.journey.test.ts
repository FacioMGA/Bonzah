// Journey contract: BO endorsement draft -> bind.
//
// Bound to the canonical endorsement route registrar. Deeper proof
// (premium maths, issue-doc orchestration, version rows) lives in
// endorsements.issue-doc-orchestration.test.ts and
// endorsement.document-rules.test.ts.

import { describe, expect, it } from 'vitest';
import { registerPolicyEndorsementRoutes } from '../../backend/modules/policy/http/endorsementsRouter.js';

describe('journey: bo-endorsement-draft-bind', () => {
  it('exposes the canonical endorsement route registrar', () => {
    expect(typeof registerPolicyEndorsementRoutes).toBe('function');
    expect(registerPolicyEndorsementRoutes.length).toBeGreaterThanOrEqual(1);
  });
});
