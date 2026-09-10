import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processOutboxEvent } from '../relay.js';
import type { OutboxRelayDeps } from '../relay.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEvent(overrides?: Partial<{ id: string; eventType: string; payload: unknown }>) {
  return {
    id: 'evt-test-1',
    eventType: 'POLICY.BOUND',
    payload: { policyId: 'pol-1' },
    ...overrides,
  };
}

function makeRow(overrides?: Partial<{ processed: boolean; eventType: string; payload: unknown; createdAt: Date }>) {
  return {
    processed: false,
    eventType: 'POLICY.BOUND',
    payload: { policyId: 'pol-1' },
    createdAt: new Date('2025-01-01T10:00:00Z'),
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<OutboxRelayDeps>): OutboxRelayDeps {
  return {
    acquireLock: vi.fn().mockResolvedValue(true),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    wasRelayed: vi.fn().mockResolvedValue(false),
    markRelayed: vi.fn().mockResolvedValue(undefined),
    findOutboxRow: vi.fn().mockResolvedValue(makeRow()),
    markOutboxProcessed: vi.fn().mockResolvedValue(undefined),
    dispatch: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('processOutboxEvent — idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips dispatch when advisory lock is not acquired', async () => {
    const deps = makeDeps({ acquireLock: vi.fn().mockResolvedValue(false) });
    await processOutboxEvent(makeEvent(), deps);
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(deps.findOutboxRow).not.toHaveBeenCalled();
  });

  it('skips dispatch when outbox row is already processed', async () => {
    const deps = makeDeps({ findOutboxRow: vi.fn().mockResolvedValue(makeRow({ processed: true })) });
    await processOutboxEvent(makeEvent(), deps);
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(deps.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('skips dispatch when outbox row is not found', async () => {
    const deps = makeDeps({ findOutboxRow: vi.fn().mockResolvedValue(null) });
    await processOutboxEvent(makeEvent(), deps);
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('skips dispatch when wasRelayed returns true, and still marks outbox processed', async () => {
    const deps = makeDeps({ wasRelayed: vi.fn().mockResolvedValue(true) });
    await processOutboxEvent(makeEvent(), deps);
    expect(deps.dispatch).not.toHaveBeenCalled();
    // Cleanup: outbox row must still be marked processed
    expect(deps.markOutboxProcessed).toHaveBeenCalledWith('evt-test-1');
    expect(deps.releaseLock).toHaveBeenCalled();
  });

  it('dispatches exactly once when all guards pass', async () => {
    const deps = makeDeps();
    await processOutboxEvent(makeEvent(), deps);
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.dispatch).toHaveBeenCalledWith('POLICY.BOUND', { policyId: 'pol-1' });
  });

  it('uses payload from the outbox row, not from the event argument', async () => {
    // The event argument payload may be stale; the row payload is authoritative
    const freshPayload = { policyId: 'pol-1', enriched: true };
    const deps = makeDeps({
      findOutboxRow: vi.fn().mockResolvedValue(makeRow({ payload: freshPayload })),
    });
    await processOutboxEvent(makeEvent({ payload: { policyId: 'pol-1' } }), deps);
    expect(deps.dispatch).toHaveBeenCalledWith('POLICY.BOUND', freshPayload);
  });

  it('does NOT mark processed when dispatch throws — event must retry on next poll', async () => {
    const deps = makeDeps({
      dispatch: vi.fn().mockRejectedValue(new Error('Redis unavailable')),
    });
    await processOutboxEvent(makeEvent(), deps);
    expect(deps.markRelayed).not.toHaveBeenCalled();
    expect(deps.markOutboxProcessed).not.toHaveBeenCalled();
    // onError must be called for observability
    expect(deps.onError).toHaveBeenCalledWith('evt-test-1', expect.any(Error));
    // Lock must still be released even on failure
    expect(deps.releaseLock).toHaveBeenCalled();
  });

  it('enforces: markRelayed is called BEFORE markOutboxProcessed', async () => {
    // This test encodes the ordering invariant that closes the crash-window gap.
    const callOrder: string[] = [];
    const deps = makeDeps({
      markRelayed: vi.fn().mockImplementation(async () => { callOrder.push('markRelayed'); }),
      markOutboxProcessed: vi.fn().mockImplementation(async () => { callOrder.push('markOutboxProcessed'); }),
    });
    await processOutboxEvent(makeEvent(), deps);
    expect(callOrder).toEqual(['markRelayed', 'markOutboxProcessed']);
  });
});
