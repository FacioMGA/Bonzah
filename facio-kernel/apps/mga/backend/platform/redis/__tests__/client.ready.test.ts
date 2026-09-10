import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn();
const pingMock = vi.fn();
const onMock = vi.fn();
const disconnectMock = vi.fn();

vi.mock('ioredis', () => {
  class FakeRedis {
    status = 'wait';
    connect = connectMock;
    ping = pingMock;
    on = onMock;
    disconnect = disconnectMock;
  }
  class FakeCluster extends FakeRedis {}
  return {
    Redis: FakeRedis,
    Cluster: FakeCluster,
  };
});

vi.mock('../../observability/sentry.js', () => ({
  captureBackgroundException: vi.fn(),
}));

describe('ensureRedisClientReady', () => {
  const originalEnv: Record<string, string | undefined> = {};
  const tracked = [
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_PASSWORD',
    'REDIS_TLS',
    'REDIS_ENABLE_CLUSTER',
    'REDIS_CLUSTERED',
    'NODE_ENV',
  ];

  beforeEach(async () => {
    vi.resetModules();
    connectMock.mockReset();
    pingMock.mockReset();
    onMock.mockReset();
    disconnectMock.mockReset();
    for (const key of tracked) originalEnv[key] = process.env[key];
    process.env.REDIS_HOST = 'redis.staging.example.com';
    process.env.REDIS_PORT = '6380';
    process.env.REDIS_TLS = 'true';
    process.env.REDIS_PASSWORD = 'secret';
    delete process.env.REDIS_ENABLE_CLUSTER;
    delete process.env.REDIS_CLUSTERED;
    // Bypass the test-mode short-circuit so we exercise connect+ping.
    process.env.NODE_ENV = 'production';
    connectMock.mockResolvedValue(undefined);
    pingMock.mockResolvedValue('PONG');
  });

  afterEach(() => {
    for (const key of tracked) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it('connects and pings the general-purpose client (ABY-397 warm path)', async () => {
    const { ensureRedisClientReady, getRedisClient, __resetRedisClientForTests } =
      await import('../client.js');
    try {
      await ensureRedisClientReady();
      expect(getRedisClient()).not.toBeNull();
      expect(connectMock).toHaveBeenCalled();
      expect(pingMock).toHaveBeenCalled();
    } finally {
      __resetRedisClientForTests();
    }
  });

  it('retries transient ETIMEDOUT then succeeds', async () => {
    const timeoutErr = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    connectMock
      .mockRejectedValueOnce(timeoutErr)
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValue(undefined);

    const { ensureRedisClientReady, __resetRedisClientForTests } = await import('../client.js');
    try {
      await ensureRedisClientReady();
      expect(connectMock).toHaveBeenCalledTimes(3);
      expect(pingMock).toHaveBeenCalled();
    } finally {
      __resetRedisClientForTests();
    }
  });

  it('is a no-op when REDIS_HOST is unset', async () => {
    delete process.env.REDIS_HOST;
    const { ensureRedisClientReady, getRedisClient, __resetRedisClientForTests } =
      await import('../client.js');
    try {
      await ensureRedisClientReady();
      expect(getRedisClient()).toBeNull();
      expect(connectMock).not.toHaveBeenCalled();
    } finally {
      __resetRedisClientForTests();
    }
  });
});
