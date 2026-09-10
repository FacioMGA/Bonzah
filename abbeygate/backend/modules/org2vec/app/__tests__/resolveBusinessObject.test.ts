import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  claimFindFirst: vi.fn(),
  policyFindFirst: vi.fn(),
}));

vi.mock('../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    claim: { findFirst: prismaMocks.claimFindFirst },
    policy: { findFirst: prismaMocks.policyFindFirst },
  },
}));

import { resolveBusinessObject } from '../resolveBusinessObject.js';

describe('resolveBusinessObject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.claimFindFirst.mockResolvedValue(null);
    prismaMocks.policyFindFirst.mockResolvedValue(null);
  });

  it('resolves a claim first by claim number', async () => {
    prismaMocks.claimFindFirst.mockResolvedValue({ id: 'claim-1', claimNumber: 'CY-MTR-017', policyId: 'pol-1' });
    const scope = await resolveBusinessObject({ claimReference: 'CY-MTR-017' });
    expect(scope).toMatchObject({ scopeType: 'CLAIM', scopeId: 'claim-1', claimNumber: 'CY-MTR-017', matchedBy: 'claim_number' });
    expect(prismaMocks.policyFindFirst).not.toHaveBeenCalled();
  });

  it('falls back to a submission (policy) when no claim matches', async () => {
    prismaMocks.policyFindFirst.mockResolvedValue({ id: 'pol-9', policyNumber: 'ABFLEET-2210' });
    const scope = await resolveBusinessObject({ policyReference: 'ABFLEET-2210' });
    expect(scope).toMatchObject({ scopeType: 'SUBMISSION', scopeId: 'pol-9', policyNumber: 'ABFLEET-2210', matchedBy: 'policy_reference' });
  });

  it('returns UNRESOLVED-but-visible with a reason when nothing matches', async () => {
    const scope = await resolveBusinessObject({ vehicleRegistration: 'PCM-6604' });
    expect(scope.scopeType).toBe('UNRESOLVED');
    if (scope.scopeType === 'UNRESOLVED') {
      expect(scope.reason).toContain('vehicle=PCM-6604');
    }
  });

  it('returns no_identifiers when the email carried no hints', async () => {
    const scope = await resolveBusinessObject({});
    expect(scope).toEqual({ scopeType: 'UNRESOLVED', reason: 'no_identifiers' });
  });
});
