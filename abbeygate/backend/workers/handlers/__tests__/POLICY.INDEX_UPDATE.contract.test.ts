import { UnrecoverableError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the projection adapter boundary so the handler body runs in
// isolation. Per docs/develop/test.md mock policy: mock at the infra
// adapter boundary, not at the module under test.
const rebuildPolicyListIndexRowMock = vi.fn(async () => undefined);
vi.mock('../../../modules/policy/infra/projections/policyListIndex.js', () => ({
  rebuildPolicyListIndexRow: (...args: unknown[]) => rebuildPolicyListIndexRowMock(...args),
}));

// Keep the handler's structured log quiet + side-effect-free in the unit.
vi.mock('../../../platform/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock the worker-tenant ALS wrapper at its module boundary so the
// handler body runs in isolation. ABY-281: the production handler
// wraps `rebuildPolicyListIndexRow` in `runWithPolicyOperatingTenant`
// to satisfy the fail-closed tenant extension (ADR-0019). We assert
// (a) that the wrapper IS called with the policyId from the envelope,
// and (b) that the wrapper actually invokes the supplied function so
// `rebuildPolicyListIndexRow` runs once per job.
//
// The typed `PolicyTenantContextMissingError` is defined via vi.hoisted so
// both the mocked module and the test share the SAME class identity — the
// handler's `instanceof` check must match instances the test throws.
const { runWithPolicyOperatingTenantMock, PolicyTenantContextMissingError } = vi.hoisted(() => {
  class PolicyTenantContextMissingError extends Error {
    readonly policyId: string;
    constructor(policyId: string) {
      super(`Policy tenant context not found: ${policyId}`);
      this.name = 'PolicyTenantContextMissingError';
      this.policyId = policyId;
    }
  }
  return {
    runWithPolicyOperatingTenantMock: vi.fn(
      async (_policyId: string, fn: () => Promise<void>) => fn(),
    ),
    PolicyTenantContextMissingError,
  };
});
vi.mock('../../../platform/tenant/tenantJobContext.js', () => ({
  runWithPolicyOperatingTenant: (policyId: string, fn: () => Promise<void>) =>
    runWithPolicyOperatingTenantMock(policyId, fn),
  PolicyTenantContextMissingError,
}));

const { runPolicyIndexUpdate, handlePolicyIndexUpdate, PolicyIndexUpdateDataSchema } = await import(
  '../POLICY.INDEX_UPDATE.js'
);

// `job.data` arrives from the outbox relay as a full `DomainEventEnvelope`
// (see ADR-0013 / `enqueueIssuedPolicyPack` docstring). These tests pin
// that contract: handler MUST read from `envelope.data.policyId` and
// MUST fail loudly when the envelope shape is missing or malformed.
//
// Regression: ABBEYGATE-B / ABY-277 — before fix, the schema parsed
// `job.data` as `{ policyId }` directly, which never matched the
// relay-wrapped shape and triggered `ZodError: policyId expected
// string, received undefined` on every job until `queue.data_sync.exhausted`.
describe('POLICY.INDEX_UPDATE handler — typed envelope contract (ADR-0013 / ADR-0029)', () => {
  beforeEach(() => {
    rebuildPolicyListIndexRowMock.mockClear();
    runWithPolicyOperatingTenantMock.mockClear();
  });

  it('exposes the canonical JobHandler shim + pure body', () => {
    expect(typeof handlePolicyIndexUpdate).toBe('function');
    expect(typeof runPolicyIndexUpdate).toBe('function');
  });

  it('accepts a relay-wrapped DomainEventEnvelope and dispatches to rebuildPolicyListIndexRow inside the policy-tenant ALS frame (ABY-281)', async () => {
    await runPolicyIndexUpdate({
      eventType: 'POLICY.INDEX_UPDATE',
      aggregateType: 'POLICY',
      aggregateId: 'pol_42',
      data: { policyId: 'pol_42' },
    });
    // Tenant context must be restored from the policyId BEFORE the
    // projection rebuild fires — otherwise the fail-closed tenant
    // extension (ADR-0019) rejects the downstream Prisma queries
    // (regression: ABBEYGATE-E TenantContextError).
    expect(runWithPolicyOperatingTenantMock).toHaveBeenCalledTimes(1);
    expect(runWithPolicyOperatingTenantMock).toHaveBeenCalledWith('pol_42', expect.any(Function));
    expect(rebuildPolicyListIndexRowMock).toHaveBeenCalledTimes(1);
    expect(rebuildPolicyListIndexRowMock).toHaveBeenCalledWith('pol_42');
  });

  it('dead-letters (UnrecoverableError) when the policy has no operating tenant context, instead of retrying a permanent data defect (ABBEYGATE-W)', async () => {
    // A policy whose durable row has a null operatingTenantId can never
    // resolve — the fail-closed extension (ADR-0019) rejects it identically
    // on every attempt. The handler must convert that typed miss into a
    // BullMQ UnrecoverableError so the job fails once and dead-letters,
    // rather than burning all retries and firing an exhaustion alert.
    runWithPolicyOperatingTenantMock.mockRejectedValueOnce(
      new PolicyTenantContextMissingError('pol_orphan'),
    );

    const err = await runPolicyIndexUpdate({ data: { policyId: 'pol_orphan' } }).catch((e) => e);

    expect(err).toBeInstanceOf(UnrecoverableError);
    // Message is preserved verbatim so log/Sentry grouping stays stable.
    expect(err).toMatchObject({ message: 'Policy tenant context not found: pol_orphan' });
    // Tenant restore was attempted exactly once (no retry loop here) …
    expect(runWithPolicyOperatingTenantMock).toHaveBeenCalledTimes(1);
    // … and we never invented a fallback tenant that would run the
    // projection anyway (no-defensive-fallbacks).
    expect(rebuildPolicyListIndexRowMock).not.toHaveBeenCalled();
  });

  it('re-throws non-tenant errors unchanged so genuinely transient failures still retry', async () => {
    const transient = new Error('connection reset');
    runWithPolicyOperatingTenantMock.mockRejectedValueOnce(transient);

    const err = await runPolicyIndexUpdate({ data: { policyId: 'pol_1' } }).catch((e) => e);

    expect(err).toBe(transient);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
  });

  it('rejects an envelope with empty policyId at the parse boundary BEFORE attempting tenant context (no Prisma round-trip on bad input)', async () => {
    await expect(
      runPolicyIndexUpdate({ data: { policyId: '' } }),
    ).rejects.toThrow(/missing envelope\.data\.policyId/i);
    expect(runWithPolicyOperatingTenantMock).not.toHaveBeenCalled();
    expect(rebuildPolicyListIndexRowMock).not.toHaveBeenCalled();
  });

  it('rejects an envelope with missing data at the parse boundary', async () => {
    await expect(runPolicyIndexUpdate({})).rejects.toThrow();
    expect(runWithPolicyOperatingTenantMock).not.toHaveBeenCalled();
    expect(rebuildPolicyListIndexRowMock).not.toHaveBeenCalled();
  });

  it('rejects a flat (non-enveloped) payload — regression guard for ABY-277', async () => {
    // Pre-fix, the schema accepted the flat shape and silently
    // mismatched in production (envelope vs flat). Pinning that the
    // flat shape now fails makes any future producer that bypasses
    // the envelope contract visible at the boundary instead of
    // silently passing here while failing in production.
    await expect(runPolicyIndexUpdate({ policyId: 'pol_42' })).rejects.toThrow();
    expect(runWithPolicyOperatingTenantMock).not.toHaveBeenCalled();
    expect(rebuildPolicyListIndexRowMock).not.toHaveBeenCalled();
  });

  it('inner data schema is the canonical contract — extra envelope.data keys are stripped, not honoured', () => {
    const parsed = PolicyIndexUpdateDataSchema.parse({ policyId: 'pol_1', extraneous: 'ignored' });
    expect(parsed).toEqual({ policyId: 'pol_1' });
  });
});
