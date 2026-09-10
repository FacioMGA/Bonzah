import { UnrecoverableError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rebuildAccountIntelligenceProjectionMock = vi.fn(async () => undefined);
vi.mock('../../../modules/accounts360/infra/projections/accountIntelligenceProjection.js', () => ({
  rebuildAccountIntelligenceProjection: (...args: unknown[]) =>
    rebuildAccountIntelligenceProjectionMock(...args),
}));

const { loggerWarnMock } = vi.hoisted(() => ({ loggerWarnMock: vi.fn() }));
vi.mock('../../../platform/utils/logger.js', () => ({
  logger: { warn: loggerWarnMock, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { runWithAccountOperatingTenantMock, AccountTenantContextMissingError } = vi.hoisted(() => {
  class AccountTenantContextMissingError extends Error {
    readonly accountId: string;
    constructor(accountId: string) {
      super(`Account tenant context not found: ${accountId}`);
      this.name = 'AccountTenantContextMissingError';
      this.accountId = accountId;
    }
  }
  return {
    runWithAccountOperatingTenantMock: vi.fn(
      async (_accountId: string, fn: () => Promise<void>) => fn(),
    ),
    AccountTenantContextMissingError,
  };
});
vi.mock('../../../platform/tenant/tenantJobContext.js', () => ({
  runWithAccountOperatingTenant: (accountId: string, fn: () => Promise<void>) =>
    runWithAccountOperatingTenantMock(accountId, fn),
  AccountTenantContextMissingError,
}));

const {
  runAccountIntelligenceProjectionUpdate,
  handleAccountIntelligenceProjectionUpdate,
  AccountIntelligenceProjectionUpdateDataSchema,
} = await import('../ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE.js');

describe('ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE handler — typed envelope + tenant miss (ABY-408)', () => {
  beforeEach(() => {
    rebuildAccountIntelligenceProjectionMock.mockClear();
    runWithAccountOperatingTenantMock.mockClear();
    loggerWarnMock.mockClear();
    runWithAccountOperatingTenantMock.mockImplementation(
      async (_accountId: string, fn: () => Promise<void>) => fn(),
    );
  });

  it('exposes the canonical JobHandler shim + pure body', () => {
    expect(typeof handleAccountIntelligenceProjectionUpdate).toBe('function');
    expect(typeof runAccountIntelligenceProjectionUpdate).toBe('function');
  });

  it('dispatches rebuild inside the account-tenant ALS frame', async () => {
    await runAccountIntelligenceProjectionUpdate({
      eventType: 'ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE',
      aggregateType: 'ACCOUNT',
      aggregateId: 'ph_42',
      data: { accountId: 'ph_42' },
    });

    expect(runWithAccountOperatingTenantMock).toHaveBeenCalledWith('ph_42', expect.any(Function));
    expect(rebuildAccountIntelligenceProjectionMock).toHaveBeenCalledWith('ph_42');
  });

  it('dead-letters (UnrecoverableError) when account tenant context is permanently missing (ABY-408)', async () => {
    runWithAccountOperatingTenantMock.mockRejectedValueOnce(
      new AccountTenantContextMissingError('ph_orphan'),
    );

    const err = await runAccountIntelligenceProjectionUpdate(
      { data: { accountId: 'ph_orphan' } },
      { cid: 'cid-1', queue: 'data-sync', jobId: 'job-1', attemptsMade: 2 },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(err).toMatchObject({ message: 'Account tenant context not found: ph_orphan' });
    expect(rebuildAccountIntelligenceProjectionMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cid: 'cid-1',
        status: 'dead_lettered',
        queue: 'data-sync',
        jobId: 'job-1',
        attemptsMade: 2,
      }),
      expect.any(String),
    );
  });

  it('inner data schema strips extraneous keys', () => {
    const parsed = AccountIntelligenceProjectionUpdateDataSchema.parse({
      accountId: 'ph_1',
      extraneous: 'ignored',
    });
    expect(parsed).toEqual({ accountId: 'ph_1' });
  });
});
