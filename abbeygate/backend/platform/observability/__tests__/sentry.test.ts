import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type CapturedScope = {
  tags: Record<string, string>;
  extras: Record<string, unknown>;
};

const captureExceptionMock = vi.fn(() => 'evt-id');
const scopes: CapturedScope[] = [];

vi.mock('@sentry/node', () => {
  return {
    captureException: (...args: unknown[]) => captureExceptionMock(...args),
    withScope: (
      callback: (scope: {
        setTag: (k: string, v: string) => void;
        setExtra: (k: string, v: unknown) => void;
      }) => unknown,
    ) => {
      const current: CapturedScope = { tags: {}, extras: {} };
      const scope = {
        setTag(k: string, v: string) {
          current.tags[k] = v;
        },
        setExtra(k: string, v: unknown) {
          current.extras[k] = v;
        },
      };
      const out = callback(scope);
      scopes.push(current);
      return out;
    },
    setupExpressErrorHandler: vi.fn(),
    close: vi.fn(async () => true),
  };
});

const {
  __resetBackgroundCaptureWindowsForTests,
  captureBackgroundException,
  recordSentryInit,
} = await import('../sentry.js');

const { runWithOperatingTenant, withoutOperatingTenantForTest } = await import(
  '../../tenant/tenantAls.js'
);
const { TENANT_IDS } = await import('../../tenant/tenantConfig.js');

const PT_CONFIG = {
  id: TENANT_IDS.PT,
  tenantSlug: 'abbeygate-pt',
  countryCode: 'PT' as const,
  country: 'Portugal',
  currency: 'EUR',
  ipt: { rate: 0.09 },
  adminFee: 18,
  legalPack: 'pt' as const,
  publicBaseUrl: 'https://abbeygate-pt.facio.io',
  fromEmail: 'no-reply@abbeygate.pt',
  brandLogo: { white: '', blue: '' },
};

describe('captureBackgroundException', () => {
  beforeEach(() => {
    __resetBackgroundCaptureWindowsForTests();
    scopes.length = 0;
    captureExceptionMock.mockClear();
    recordSentryInit({
      initialized: true,
      environment: 'test',
      release: 'test',
      serviceRole: 'abbeygate-api',
      dsnHost: 'o0.ingest.us.sentry.io',
    });
  });

  afterEach(() => {
    __resetBackgroundCaptureWindowsForTests();
    recordSentryInit({
      initialized: false,
      reason: 'no_dsn',
      environment: 'test',
      serviceRole: 'abbeygate-api',
      dsnHost: null,
    });
    vi.useRealTimers();
  });

  it('captures the first occurrence of a fingerprint immediately', () => {
    captureBackgroundException(new Error('redis epipe'), { tag: 'redis.error' });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(scopes[0]?.tags['background.tag']).toBe('redis.error');
    expect(scopes[0]?.extras.droppedSinceLastSend).toBeUndefined();
  });

  it('rate-limits repeated occurrences within the window', () => {
    const opts = { tag: 'redis.error', windowMs: 60_000 };
    captureBackgroundException(new Error('redis epipe'), opts);
    captureBackgroundException(new Error('redis epipe'), opts);
    captureBackgroundException(new Error('redis epipe'), opts);
    captureBackgroundException(new Error('redis epipe'), opts);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('reports dropped count on the next send after the window elapses', () => {
    const opts = { tag: 'redis.error', windowMs: 1_000 };
    const start = 1_700_000_000_000;
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(start);

    captureBackgroundException(new Error('redis epipe'), opts);
    captureBackgroundException(new Error('redis epipe'), opts);
    captureBackgroundException(new Error('redis epipe'), opts);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);

    dateNow.mockReturnValue(start + 2_000);
    captureBackgroundException(new Error('redis epipe'), opts);

    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
    expect(scopes[1]?.extras.droppedSinceLastSend).toBe(2);
    expect(scopes[1]?.extras.rateLimitWindowMs).toBe(1_000);
    expect(scopes[1]?.tags['background.tag']).toBe('redis.error');
  });

  it('treats different fingerprints (different message OR different tag) independently', () => {
    const opts = { tag: 'tagA', windowMs: 60_000 };
    captureBackgroundException(new Error('m1'), opts);
    captureBackgroundException(new Error('m2'), opts);
    captureBackgroundException(new Error('m1'), { tag: 'tagB', windowMs: 60_000 });

    expect(captureExceptionMock).toHaveBeenCalledTimes(3);
  });

  it('forwards extra context to the Sentry scope', () => {
    captureBackgroundException(new Error('boom'), {
      tag: 'pdf_worker.error',
      extra: { jobId: 'job-42', policyId: 'pol-1' },
    });
    expect(scopes[0]?.extras.jobId).toBe('job-42');
    expect(scopes[0]?.extras.policyId).toBe('pol-1');
  });

  it('tags the operating tenant from the ALS context when present', () => {
    runWithOperatingTenant(PT_CONFIG, () => {
      captureBackgroundException(new Error('als boom'), { tag: 'queue.documents.exhausted' });
    });
    expect(scopes[0]?.tags.tenant).toBe('abbeygate-pt');
    expect(scopes[0]?.tags['tenant.country']).toBe('PT');
  });

  it('falls back to the tenant stamped on the error when ALS is gone (worker on-failed path)', async () => {
    const err = new Error('exhausted boom');
    await runWithOperatingTenant(PT_CONFIG, async () => {
      throw err;
    }).catch(() => undefined);

    withoutOperatingTenantForTest(() => {
      captureBackgroundException(err, { tag: 'queue.documents.exhausted' });
    });

    expect(scopes[0]?.tags.tenant).toBe('abbeygate-pt');
    expect(scopes[0]?.tags['tenant.country']).toBe('PT');
  });

  it('no-ops when Sentry has not been initialized', () => {
    recordSentryInit({
      initialized: false,
      reason: 'no_dsn',
      environment: 'test',
      serviceRole: 'abbeygate-api',
      dsnHost: null,
    });
    captureBackgroundException(new Error('boom'), { tag: 'x' });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
