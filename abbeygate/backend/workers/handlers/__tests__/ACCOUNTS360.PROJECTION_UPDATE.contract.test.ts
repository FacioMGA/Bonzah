import { UnrecoverableError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rebuildAccount360ProjectionMock = vi.fn(async () => undefined);
const rebuildAccountIntelligenceProjectionMock = vi.fn(async () => undefined);
vi.mock('../../../modules/accounts360/infra/projections/accounts360Projection.js', () => ({
  rebuildAccount360Projection: (...args: unknown[]) => rebuildAccount360ProjectionMock(...args),
}));
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
  runAccounts360ProjectionUpdate,
  handleAccounts360ProjectionUpdate,
  Accounts360ProjectionUpdateDataSchema,
} = await import('../ACCOUNTS360.PROJECTION_UPDATE.js');

describe('ACCOUNTS360.PROJECTION_UPDATE handler — typed envelope + tenant miss (ABY-281 / ABY-408)', () => {
  beforeEach(() => {
    rebuildAccount360ProjectionMock.mockClear();
    rebuildAccountIntelligenceProjectionMock.mockClear();
    runWithAccountOperatingTenantMock.mockClear();
    loggerWarnMock.mockClear();
    runWithAccountOperatingTenantMock.mockImplementation(
      async (_accountId: string, fn: () => Promise<void>) => fn(),
    );
  });

  it('exposes the canonical JobHandler shim + pure body', () => {
    expect(typeof handleAccounts360ProjectionUpdate).toBe('function');
    expect(typeof runAccounts360ProjectionUpdate).toBe('function');
  });

  it('dispatches rebuilds inside the account-tenant ALS frame', async () => {
    await runAccounts360ProjectionUpdate({
      eventType: 'ACCOUNTS360.PROJECTION_UPDATE',
      aggregateType: 'ACCOUNT',
      aggregateId: 'ph_42',
      data: { accountId: 'ph_42' },
    });

    expect(runWithAccountOperatingTenantMock).toHaveBeenCalledTimes(1);
    expect(runWithAccountOperatingTenantMock).toHaveBeenCalledWith('ph_42', expect.any(Function));
    expect(rebuildAccount360ProjectionMock).toHaveBeenCalledWith('ph_42');
    expect(rebuildAccountIntelligenceProjectionMock).toHaveBeenCalledWith('ph_42');
  });

  it('dead-letters (UnrecoverableError) when account tenant context is permanently missing (ABY-408)', async () => {
    runWithAccountOperatingTenantMock.mockRejectedValueOnce(
      new AccountTenantContextMissingError('ph_orphan'),
    );

    const err = await runAccounts360ProjectionUpdate(
      { data: { accountId: 'ph_orphan' } },
      { cid: 'cid-2', queue: 'data-sync', jobId: 'job-2', attemptsMade: 1 },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(err).toMatchObject({ message: 'Account tenant context not found: ph_orphan' });
    expect(rebuildAccount360ProjectionMock).not.toHaveBeenCalled();
    expect(rebuildAccountIntelligenceProjectionMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cid: 'cid-2',
        status: 'dead_lettered',
        queue: 'data-sync',
        jobId: 'job-2',
        attemptsMade: 1,
      }),
      expect.any(String),
    );
  });

  it('re-throws non-tenant errors unchanged so transient failures still retry', async () => {
    const transient = new Error('connection reset');
    runWithAccountOperatingTenantMock.mockRejectedValueOnce(transient);

    const err = await runAccounts360ProjectionUpdate({
      data: { accountId: 'ph_1' },
    }).catch((e) => e);

    expect(err).toBe(transient);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
  });

  it('rejects empty accountId at the parse boundary BEFORE tenant restore', async () => {
    await expect(
      runAccounts360ProjectionUpdate({ data: { accountId: '' } }),
    ).rejects.toThrow(/missing envelope\.data\.accountId/i);
    expect(runWithAccountOperatingTenantMock).not.toHaveBeenCalled();
  });

  it('inner data schema strips extraneous keys', () => {
    const parsed = Accounts360ProjectionUpdateDataSchema.parse({
      accountId: 'ph_1',
      extraneous: 'ignored',
    });
    expect(parsed).toEqual({ accountId: 'ph_1' });
  });
});
