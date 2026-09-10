import { Cluster, Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBullMqConnection,
  getBullMqRedisClusterOptions,
  getBullMqRedisOptions,
  getRedisClientClusterOptions,
  getRedisClientOptions,
  readRedisConnectionEnv,
} from '../connectionOptions.js';

const TRACKED_ENV = [
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'REDIS_TLS',
  'REDIS_KEEPALIVE_MS',
  'REDIS_ENABLE_CLUSTER',
  'REDIS_CLUSTERED',
];

describe('connectionOptions', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of TRACKED_ENV) original[k] = process.env[k];
    for (const k of TRACKED_ENV) delete process.env[k];
    process.env.REDIS_HOST = 'redis.prod.example.com';
    process.env.REDIS_TLS = 'true';
    process.env.REDIS_PASSWORD = 'secret-pw';
  });

  afterEach(() => {
    for (const k of TRACKED_ENV) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  describe('readRedisConnectionEnv', () => {
    it('reads host, port, password, tls, keepAliveMs with defaults', () => {
      const env = readRedisConnectionEnv();
      expect(env.host).toBe('redis.prod.example.com');
      expect(env.port).toBe(6379);
      expect(env.tls).toBe(true);
      expect(env.password).toBe('secret-pw');
      expect(env.keepAliveMs).toBe(30_000);
    });

    it('throws when REDIS_HOST is missing', () => {
      delete process.env.REDIS_HOST;
      expect(() => readRedisConnectionEnv()).toThrow(/REDIS_HOST is required/);
    });

    it('honours REDIS_KEEPALIVE_MS when set', () => {
      process.env.REDIS_KEEPALIVE_MS = '5000';
      expect(readRedisConnectionEnv().keepAliveMs).toBe(5_000);
    });

    it('rejects an invalid REDIS_KEEPALIVE_MS', () => {
      process.env.REDIS_KEEPALIVE_MS = 'not-a-number';
      expect(() => readRedisConnectionEnv()).toThrow(/REDIS_KEEPALIVE_MS/);
    });

    it('treats truthy REDIS_TLS variants as enabled', () => {
      for (const v of ['true', '1', 'yes', 'on']) {
        process.env.REDIS_TLS = v;
        expect(readRedisConnectionEnv().tls).toBe(true);
      }
    });

    it('treats falsy REDIS_TLS variants as disabled', () => {
      for (const v of ['false', '0', 'no', 'off', '', ' ']) {
        process.env.REDIS_TLS = v;
        expect(readRedisConnectionEnv().tls).toBe(false);
      }
    });
  });

  describe('getBullMqRedisOptions', () => {
    it('forces BullMQ-required settings and adds keepAlive', () => {
      const opts = getBullMqRedisOptions();
      expect(opts.maxRetriesPerRequest).toBeNull();
      expect(opts.enableReadyCheck).toBe(false);
      expect(opts.keepAlive).toBe(30_000);
      expect(opts.lazyConnect).toBe(true);
      expect(opts.tls).toEqual({ servername: 'redis.prod.example.com' });
    });

    it('omits TLS when REDIS_TLS is false', () => {
      process.env.REDIS_TLS = 'false';
      expect(getBullMqRedisOptions().tls).toBeUndefined();
    });

    it('honours REDIS_KEEPALIVE_MS override (including 0 for disabling)', () => {
      process.env.REDIS_KEEPALIVE_MS = '0';
      expect(getBullMqRedisOptions().keepAlive).toBe(0);
    });
  });

  describe('getBullMqRedisClusterOptions', () => {
    it('forces BullMQ-required settings on the nested redisOptions', () => {
      const opts = getBullMqRedisClusterOptions();
      expect(opts.redisOptions?.maxRetriesPerRequest).toBeNull();
      expect(opts.redisOptions?.keepAlive).toBe(30_000);
      expect(opts.redisOptions?.tls).toEqual({ servername: 'redis.prod.example.com' });
      expect(opts.scaleReads).toBe('slave');
    });
  });

  describe('getRedisClientOptions', () => {
    it('uses maxRetriesPerRequest:1 (not null) for non-BullMQ callers', () => {
      const opts = getRedisClientOptions();
      expect(opts.maxRetriesPerRequest).toBe(1);
      expect(opts.enableOfflineQueue).toBe(false);
      expect(opts.keepAlive).toBe(30_000);
    });

    // ABY-397 / ABBEYGATE-1R: cold TLS connect to Azure Cache timed out
    // under a 2s budget. Keep parity with BullMQ's 5s connectTimeout.
    it('aligns connectTimeout with BullMQ (5s)', () => {
      const clientOpts = getRedisClientOptions();
      const bullOpts = getBullMqRedisOptions();
      expect(clientOpts.connectTimeout).toBe(5_000);
      expect(clientOpts.connectTimeout).toBe(bullOpts.connectTimeout);
    });
  });

  describe('getRedisClientClusterOptions', () => {
    it('uses maxRetriesPerRequest:1 on the nested redisOptions', () => {
      const opts = getRedisClientClusterOptions();
      expect(opts.redisOptions?.maxRetriesPerRequest).toBe(1);
      expect(opts.redisOptions?.keepAlive).toBe(30_000);
      expect(opts.redisOptions?.connectTimeout).toBe(5_000);
    });
  });

  describe('createBullMqConnection (factory)', () => {
    // Regression guard for 2026-05-17 incident: pdfWorker created its
    // own standalone IORedis from options against an Azure Redis
    // Cluster endpoint and got hammered with `MOVED` redirects the
    // standalone client cannot follow. The factory must dispatch on
    // `REDIS_ENABLE_CLUSTER` (or legacy `REDIS_CLUSTERED`) so every
    // BullMQ caller automatically gets the right transport.
    it('returns a Cluster when REDIS_ENABLE_CLUSTER=true', () => {
      process.env.REDIS_ENABLE_CLUSTER = 'true';
      const conn = createBullMqConnection();
      try {
        expect(conn).toBeInstanceOf(Cluster);
      } finally {
        // Disconnect lazy connections so the test doesn't leak.
        conn.disconnect();
      }
    });

    it('returns a Cluster when legacy REDIS_CLUSTERED=true', () => {
      process.env.REDIS_CLUSTERED = 'true';
      const conn = createBullMqConnection();
      try {
        expect(conn).toBeInstanceOf(Cluster);
      } finally {
        conn.disconnect();
      }
    });

    it('returns a standalone Redis when cluster flags are not set', () => {
      const conn = createBullMqConnection();
      try {
        expect(conn).toBeInstanceOf(Redis);
        expect(conn).not.toBeInstanceOf(Cluster);
      } finally {
        conn.disconnect();
      }
    });
  });
});
