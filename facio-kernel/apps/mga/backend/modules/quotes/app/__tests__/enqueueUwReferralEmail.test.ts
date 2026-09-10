import { beforeEach, describe, expect, it, vi } from 'vitest';

const outboxCreate = vi.fn(async () => ({}));
const loggerInfo = vi.fn();
const loggerWarn = vi.fn();

vi.mock('../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    outbox: { create: (...args: unknown[]) => outboxCreate(...args) },
  },
}));

vi.mock('../../../../platform/tenant/tenantConfig.js', () => ({
  getTenantConfig: () => ({ id: 'tenant-cy' }),
}));

vi.mock('../../../../platform/utils/logger.js', () => ({
  logger: {
    info: (...args: unknown[]) => loggerInfo(...args),
    warn: (...args: unknown[]) => loggerWarn(...args),
  },
}));

const { enqueueUwReferralEmail, extractUwReferralReasons } = await import('../enqueueUwReferralEmail.js');

describe('extractUwReferralReasons', () => {
  it('reads trigger messages from underwritingAnalysis', () => {
    expect(
      extractUwReferralReasons({
        triggers: [
          { code: 'DOOR_SECURITY', message: 'External doors with key operated locks: No' },
          { code: 'WINDOW_SECURITY', message: 'Easily accessible windows and patio doors with interior locks: No' },
        ],
      }),
    ).toEqual([
      'External doors with key operated locks: No',
      'Easily accessible windows and patio doors with interior locks: No',
    ]);
  });

  it('reads string and object reasons used by travel/health/manual runtimes', () => {
    expect(
      extractUwReferralReasons({
        reasons: [
          'Manual review required',
          { code: 'RATE_REFERRAL', message: 'No automated premium available' },
        ],
      }),
    ).toEqual([
      'Manual review required',
      'No automated premium available',
    ]);
  });

  it('reads nested quoteResponse.uwDecision.reasons without inventing text', () => {
    expect(
      extractUwReferralReasons({
        uwDecision: { lane: 'referral', reasons: [{ code: 'MANUAL_MARKET', message: 'Operator-managed product' }] },
      }),
    ).toEqual(['Operator-managed product']);
  });
});

describe('enqueueUwReferralEmail', () => {
  beforeEach(() => {
    outboxCreate.mockClear();
    loggerInfo.mockClear();
    loggerWarn.mockClear();
  });

  it('writes the flat EMAIL.UW_REFERRAL outbox payload (ABBEYGATE-N)', async () => {
    await enqueueUwReferralEmail({
      policyId: 'pol_home_1',
      policyNumber: 'ABQ/CY1000512',
      quoteReference: 'HOME-1',
      reasons: ['External doors with key operated locks: No'],
    });

    expect(outboxCreate).toHaveBeenCalledTimes(1);
    const arg = outboxCreate.mock.calls[0]![0] as {
      data: {
        eventType: string;
        aggregateId: string;
        operatingTenantId: string;
        payload: {
          policyId: string;
          policyNumber?: string;
          quoteReference?: string;
          reasons: string[];
          data?: unknown;
          eventType?: unknown;
        };
      };
    };
    expect(arg.data.eventType).toBe('EMAIL.UW_REFERRAL');
    expect(arg.data.aggregateId).toBe('pol_home_1');
    expect(arg.data.operatingTenantId).toBe('tenant-cy');
    expect(arg.data.payload).toEqual({
      policyId: 'pol_home_1',
      policyNumber: 'ABQ/CY1000512',
      quoteReference: 'HOME-1',
      reasons: ['External doors with key operated locks: No'],
    });
    // Must stay flat — no domain-event envelope nesting.
    expect(arg.data.payload.data).toBeUndefined();
    expect(arg.data.payload.eventType).toBeUndefined();
  });

  it('does not throw when the outbox write fails (rating must continue)', async () => {
    outboxCreate.mockRejectedValueOnce(new Error('outbox unavailable'));
    await expect(
      enqueueUwReferralEmail({ policyId: 'pol_2', reasons: ['Referral required'] }),
    ).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalled();
  });

  it('no-ops when policyId is missing', async () => {
    await enqueueUwReferralEmail({ policyId: '  ', reasons: ['x'] });
    expect(outboxCreate).not.toHaveBeenCalled();
  });
});
