import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerWebhookReplayAttempt,
  __resetWebhookReplayGuardForTests,
} from '../webhookReplayGuard.js';

vi.mock('../../redis/client.js', () => ({
  getRedisClient: vi.fn(),
}));
import { getRedisClient } from '../../redis/client.js';
import type { RedisClient } from '../../redis/client.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BASE_ARGS = {
  namespace: 'payments:cardcorp_webhook_encrypted',
  payload: 'deadbeefdeadbeef',
  signature: 'iv1hex:tag1hex',
  ttlSeconds: 3600,
} as const;

// ─── In-memory path (Redis unavailable) ──────────────────────────────────────

describe('webhookReplayGuard — in-memory path (no Redis)', () => {
  beforeEach(() => {
    vi.mocked(getRedisClient).mockReturnValue(null);
    __resetWebhookReplayGuardForTests();
  });

  it('returns duplicate:false on first call', async () => {
    const result = await registerWebhookReplayAttempt(BASE_ARGS);
    expect(result.duplicate).toBe(false);
    expect(result.backend).toBe('memory');
  });

  it('returns duplicate:true on second call with identical args', async () => {
    await registerWebhookReplayAttempt(BASE_ARGS);
    const second = await registerWebhookReplayAttempt(BASE_ARGS);
    expect(second.duplicate).toBe(true);
    expect(second.backend).toBe('memory');
  });

  it('returns duplicate:false for same payload but different signature (different IV = different event)', async () => {
    await registerWebhookReplayAttempt({ ...BASE_ARGS, signature: 'iv1hex:tag1hex' });
    const result = await registerWebhookReplayAttempt({ ...BASE_ARGS, signature: 'iv2hex:tag2hex' });
    expect(result.duplicate).toBe(false);
  });

  it('returns duplicate:false for different payload regardless of same signature', async () => {
    await registerWebhookReplayAttempt({ ...BASE_ARGS, payload: 'aabbcc' });
    const result = await registerWebhookReplayAttempt({ ...BASE_ARGS, payload: 'ddeeff' });
    expect(result.duplicate).toBe(false);
  });

  it('returns duplicate:false after TTL expires (key evicted from in-memory cache)', async () => {
    vi.useFakeTimers();
    await registerWebhookReplayAttempt({ ...BASE_ARGS, ttlSeconds: 1 });
    // Advance past TTL
    vi.advanceTimersByTime(2000);
    // Manually clear (simulates eviction that happens on cleanupExpired during next call)
    __resetWebhookReplayGuardForTests();
    const result = await registerWebhookReplayAttempt({ ...BASE_ARGS, ttlSeconds: 1 });
    expect(result.duplicate).toBe(false);
    vi.useRealTimers();
  });
});

// ─── Redis path ───────────────────────────────────────────────────────────────

describe('webhookReplayGuard — Redis path', () => {
  function makeRedisSetMock(result: 'OK' | null | Error): Pick<RedisClient, 'set'> {
    if (result instanceof Error) {
      const client: Pick<RedisClient, 'set'> = { set: vi.fn().mockRejectedValue(result) };
      return client;
    }
    const client: Pick<RedisClient, 'set'> = { set: vi.fn().mockResolvedValue(result) };
    return client;
  }

  beforeEach(() => {
    __resetWebhookReplayGuardForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns duplicate:false when Redis SET NX succeeds (key not yet present)', async () => {
    const mockRedis = makeRedisSetMock('OK');
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as RedisClient);

    const result = await registerWebhookReplayAttempt(BASE_ARGS);
    expect(result.duplicate).toBe(false);
    expect(result.backend).toBe('redis');
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^replay:/),
      '1',
      'EX',
      3600,
      'NX',
    );
  });

  it('returns duplicate:true when Redis SET NX returns null (key already exists)', async () => {
    const mockRedis = makeRedisSetMock(null);
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as RedisClient);

    const result = await registerWebhookReplayAttempt(BASE_ARGS);
    expect(result.duplicate).toBe(true);
    expect(result.backend).toBe('redis');
  });

  it('falls back to in-memory and returns duplicate:false when Redis throws', async () => {
    const mockRedis = makeRedisSetMock(new Error('ECONNREFUSED'));
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as RedisClient);

    const result = await registerWebhookReplayAttempt(BASE_ARGS);
    // First call: fell back to memory, not a duplicate
    expect(result.duplicate).toBe(false);
    expect(result.backend).toBe('memory');
  });

  // ABY-397 / ABBEYGATE-1R: inbound email webhook hit connect ETIMEDOUT on
  // the general-purpose Redis client. Replay guard must degrade to memory
  // (HTTP 200) rather than fail the webhook.
  it('falls back to in-memory when Redis throws connect ETIMEDOUT', async () => {
    const timeoutErr = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const mockRedis = makeRedisSetMock(timeoutErr);
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as RedisClient);

    const first = await registerWebhookReplayAttempt(BASE_ARGS);
    expect(first.duplicate).toBe(false);
    expect(first.backend).toBe('memory');

    const second = await registerWebhookReplayAttempt(BASE_ARGS);
    expect(second.duplicate).toBe(true);
    expect(second.backend).toBe('memory');
  });
});
