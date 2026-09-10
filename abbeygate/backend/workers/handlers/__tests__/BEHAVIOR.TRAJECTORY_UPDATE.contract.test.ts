import { UnrecoverableError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updatePolicyTrajectoryMock = vi.fn(async () => ({
  status: 'updated' as const,
  policyId: 'pol_123',
  eventCount: 1,
  direction: 'STABLE',
  driftScore: 0,
}));
const loggerMock = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../../platform/behavior/trajectory/updatePolicyTrajectory.js', () => ({
  updatePolicyTrajectory: (...args: unknown[]) => updatePolicyTrajectoryMock(...args),
}));

vi.mock('../../../platform/utils/logger.js', () => ({
  logger: loggerMock,
}));

const { runWithPolicyOperatingTenantMock, PolicyTenantContextMissingError } = vi.hoisted(() => {
  class PolicyTenantContextMissingError extends Error {
    constructor(policyId: string) {
      super(`Policy tenant context not found: ${policyId}`);
      this.name = 'PolicyTenantContextMissingError';
    }
  }
  return {
    runWithPolicyOperatingTenantMock: vi.fn(
      async (_policyId: string, fn: () => Promise<unknown>) => fn(),
    ),
    PolicyTenantContextMissingError,
  };
});
vi.mock('../../../platform/tenant/tenantJobContext.js', () => ({
  runWithPolicyOperatingTenant: (policyId: string, fn: () => Promise<unknown>) =>
    runWithPolicyOperatingTenantMock(policyId, fn),
  PolicyTenantContextMissingError,
}));

const { runBehaviorTrajectoryUpdate } = await import('../BEHAVIOR.TRAJECTORY_UPDATE.js');

describe('BEHAVIOR.TRAJECTORY_UPDATE tenant context', () => {
  beforeEach(() => {
    updatePolicyTrajectoryMock.mockClear();
    runWithPolicyOperatingTenantMock.mockClear();
    loggerMock.warn.mockClear();
  });

  it('restores the policy operating tenant before running the canonical trajectory projector', async () => {
    await runBehaviorTrajectoryUpdate({ policyId: 'pol_123' });

    expect(runWithPolicyOperatingTenantMock).toHaveBeenCalledWith('pol_123', expect.any(Function));
    expect(updatePolicyTrajectoryMock).toHaveBeenCalledWith({ policyId: 'pol_123' });
  });

  it('dead-letters a permanently tenantless policy instead of consuming retry attempts', async () => {
    runWithPolicyOperatingTenantMock.mockRejectedValueOnce(
      new PolicyTenantContextMissingError('pol_orphan'),
    );

    const error = await runBehaviorTrajectoryUpdate(
      { policyId: 'pol_orphan' },
      { cid: 'cid-1', queue: 'data-sync', jobId: 'job-1', attemptsMade: 1 },
    ).catch((err) => err);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(error).toMatchObject({ message: 'Policy tenant context not found: pol_orphan' });
    expect(updatePolicyTrajectoryMock).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'behavior.trajectory_update.dead_lettered',
        cid: 'cid-1',
        queue: 'data-sync',
        jobId: 'job-1',
        attemptsMade: 1,
        status: 'dead_lettered',
        policyId: 'pol_orphan',
      }),
      expect.any(String),
    );
  });

  it('fails at the payload boundary before trying to restore tenant context', async () => {
    await expect(runBehaviorTrajectoryUpdate({ policyId: '' })).rejects.toThrow(/missing policyId/i);
    expect(runWithPolicyOperatingTenantMock).not.toHaveBeenCalled();
  });
});
