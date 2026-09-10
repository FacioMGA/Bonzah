/**
 * Canonical Redis connection options.
 *
 * Why this file exists (2026-05-17 retrospective):
 * Before this consolidation, four call sites built their own ioredis
 * options inline — `backend/platform/runtime/jobs/pdfWorker.ts`,
 * `backend/platform/events/queue.ts` (standalone + cluster),
 * `backend/platform/redis/client.ts` — and they had drifted apart:
 *   - PDF worker never honoured `REDIS_TLS` (connected plain even in
 *     prod where Azure Cache for Redis requires TLS).
 *   - None of them set `keepAlive`. Azure Load Balancer closes idle
 *     TCP connections after ~4 minutes; without a client-side
 *     keepalive, the next BullMQ heartbeat / BLPOP / EVAL gets
 *     `ECONNRESET` (this was ABBEYGATE-3: 435 events in 15h).
 *
 * Per `docs/architecture/contracts/canonical-ownership.md` and the
 * `contract-spine` skill, there must be ONE source of truth for
 * "how do we connect to Redis from background workers / queues".
 * This file is that source. New callers must consume it, not duplicate
 * its decisions.
 *
 * Scope: BullMQ workers/queues and the general-purpose client.
 * Anything Sentry-instrumented (the ioredis OTel hook is already
 * registered via `@sentry/node/preload`) automatically sees these
 * connections too.
 */

import { Redis as IORedis, Cluster as IORedisCluster, type Cluster, type ClusterOptions, type Redis, type RedisOptions } from 'ioredis';

function envFlag(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function isRedisClusterEnabled(): boolean {
  return envFlag(process.env.REDIS_ENABLE_CLUSTER) || envFlag(process.env.REDIS_CLUSTERED);
}

/**
 * Default TCP keepalive interval (milliseconds). Azure Load Balancer's
 * idle-connection timeout for Standard SKUs is 4 minutes; 30s keepalive
 * gives 8x safety margin and matches BullMQ's recommended setting.
 *
 * Override with `REDIS_KEEPALIVE_MS` for diagnosis. Setting `0`
 * disables keepalive (NOT recommended; restored ABBEYGATE-3).
 */
const DEFAULT_KEEPALIVE_MS = 30_000;

export type RedisConnectionEnv = {
  host: string;
  port: number;
  password: string | undefined;
  tls: boolean;
  keepAliveMs: number;
};

/**
 * Read the canonical Redis connection environment. Throws if
 * `REDIS_HOST` is missing — callers that want a no-op path must
 * branch BEFORE calling this (e.g. `if (process.env.REDIS_HOST) ...`).
 */
export function readRedisConnectionEnv(): RedisConnectionEnv {
  const host = String(process.env.REDIS_HOST || '').trim();
  if (!host) {
    throw new Error('readRedisConnectionEnv: REDIS_HOST is required.');
  }
  const port = parseInt(String(process.env.REDIS_PORT || '6379'), 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error('readRedisConnectionEnv: REDIS_PORT must be a positive integer.');
  }
  const keepAliveEnv = String(process.env.REDIS_KEEPALIVE_MS || '').trim();
  let keepAliveMs = DEFAULT_KEEPALIVE_MS;
  if (keepAliveEnv) {
    const parsed = Number(keepAliveEnv);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error('readRedisConnectionEnv: REDIS_KEEPALIVE_MS must be a non-negative number.');
    }
    keepAliveMs = parsed;
  }
  return {
    host,
    port,
    password: process.env.REDIS_PASSWORD,
    tls: envFlag(process.env.REDIS_TLS),
    keepAliveMs,
  };
}

/**
 * Standalone ioredis options for BullMQ workers and queues. The
 * `maxRetriesPerRequest: null` is required by BullMQ. `enableReadyCheck:
 * false` matches BullMQ's documented recommendation for Redis Cluster
 * proxies (Azure Premium SKU).
 */
export function getBullMqRedisOptions(env: RedisConnectionEnv = readRedisConnectionEnv()): RedisOptions {
  return {
    host: env.host,
    port: env.port,
    password: env.password,
    tls: env.tls ? { servername: env.host } : undefined,
    keepAlive: env.keepAliveMs,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 5_000,
    lazyConnect: true,
    retryStrategy: (times: number) => Math.min(200 + times * 200, 2_000),
  };
}

/**
 * Cluster ioredis options for BullMQ workers/queues against Azure
 * Premium SKU clustered Redis (set `REDIS_ENABLE_CLUSTER=true` or
 * `REDIS_CLUSTERED=true`).
 */
export function getBullMqRedisClusterOptions(env: RedisConnectionEnv = readRedisConnectionEnv()): ClusterOptions {
  return {
    redisOptions: {
      password: env.password,
      tls: env.tls ? { servername: env.host } : undefined,
      keepAlive: env.keepAliveMs,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 5_000,
      lazyConnect: true,
    },
    clusterRetryStrategy: (times: number) => Math.min(200 + times * 300, 5_000),
    scaleReads: 'slave',
    dnsLookup: (address: string, callback: (err: Error | null, result: string) => void) => callback(null, address),
    slotsRefreshTimeout: 10_000,
  };
}

/**
 * Options for the general-purpose Redis client used outside BullMQ
 * (caching, locks, webhook replay guard). Differs from
 * `getBullMqRedisOptions` in:
 *   - `maxRetriesPerRequest: 1` (BullMQ forbids retries; non-queue
 *     callers want a single retry on transient failures)
 *   - `enableOfflineQueue: false` (fail fast so callers like
 *     webhookReplayGuard can fall back to in-memory without waiting)
 * `connectTimeout` stays aligned with BullMQ (5s) — ABY-397 showed a
 * 2s budget was too tight for a cold TLS connect to Azure Cache.
 */
export function getRedisClientOptions(env: RedisConnectionEnv = readRedisConnectionEnv()): RedisOptions {
  return {
    host: env.host,
    port: env.port,
    password: env.password,
    tls: env.tls ? { servername: env.host } : undefined,
    keepAlive: env.keepAliveMs,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    connectTimeout: 5_000,
    lazyConnect: true,
    retryStrategy: (times: number) => Math.min(200 + times * 200, 2_000),
  };
}

/**
 * Cluster variant of `getRedisClientOptions` for the general-purpose
 * client when `REDIS_ENABLE_CLUSTER=true`.
 */
export function getRedisClientClusterOptions(env: RedisConnectionEnv = readRedisConnectionEnv()): ClusterOptions {
  return {
    // Note: ioredis ClusterOptions omits `enableOfflineQueue` from nested
    // redisOptions (Cluster manages its own offline queue). Standalone
    // getRedisClientOptions keeps enableOfflineQueue: false for fail-fast.
    redisOptions: {
      password: env.password,
      tls: env.tls ? { servername: env.host } : undefined,
      keepAlive: env.keepAliveMs,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      connectTimeout: 5_000,
      lazyConnect: true,
    },
    scaleReads: 'slave',
    dnsLookup: (address: string, callback: (err: Error | null, result: string) => void) => callback(null, address),
    slotsRefreshTimeout: 10_000,
  };
}

/**
 * Canonical BullMQ Redis connection factory.
 *
 * Returns an `IORedisCluster` when `REDIS_ENABLE_CLUSTER` (or the
 * legacy `REDIS_CLUSTERED`) is truthy, otherwise an `IORedis`
 * standalone instance. BullMQ's `connection` option accepts both.
 *
 * Why this exists (2026-05-17 retrospective):
 * Without this helper, every BullMQ caller has to remember to branch
 * on the cluster env flag. The PDF worker forgot the branch (commit
 * `ec118964`), so when `{pdf-generation}` hash-tag keys started
 * hashing to a non-local slot, Azure Redis returned `MOVED` to the
 * standalone client and the worker entered a tight error loop. The
 * shared queues in `events/queue.ts` had the branch and were fine.
 * This factory makes "cluster vs standalone" a SINGLE decision so
 * the bug cannot recur.
 *
 * Callers should NOT instantiate `new IORedis(...)` or
 * `new IORedisCluster(...)` directly for BullMQ wiring.
 */
export function createBullMqConnection(env: RedisConnectionEnv = readRedisConnectionEnv()): Redis | Cluster {
  if (isRedisClusterEnabled()) {
    return new IORedisCluster(
      [{ host: env.host, port: env.port }],
      getBullMqRedisClusterOptions(env),
    );
  }
  return new IORedis(getBullMqRedisOptions(env));
}
