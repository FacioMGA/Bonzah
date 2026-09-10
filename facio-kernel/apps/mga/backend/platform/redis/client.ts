import { Redis as IORedis, Cluster as IORedisCluster, type Cluster, type Redis } from 'ioredis';
import { captureBackgroundException } from '../observability/sentry.js';
import { getRedisClientClusterOptions, getRedisClientOptions } from './connectionOptions.js';
import { logger } from '../utils/logger.js';

/**
 * Normalise a boolean-ish env var so that trailing whitespace pasted into a
 * Kubernetes Secret value (e.g. `"true\n"`) does not silently disable features.
 * Accepts `true`/`1`/`yes`/`on` (case-insensitive) as truthy; anything else
 * (including empty/undefined) is falsy.
 */
function envFlag(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

const redisHost = (process.env.REDIS_HOST || '').trim() || undefined;
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
const redisTls = envFlag(process.env.REDIS_TLS);

// IMPORTANT:
// Do NOT auto-enable cluster mode based on hostname.
// Many Azure Redis offerings are *standalone* (non-cluster) and ioredis Cluster mode will spam:
//   "ClusterAllFailedError: Failed to refresh slots cache."
// If you really run Redis Cluster, set REDIS_ENABLE_CLUSTER=true (or REDIS_CLUSTERED=true) explicitly.
const redisEnableCluster = envFlag(process.env.REDIS_ENABLE_CLUSTER) || envFlag(process.env.REDIS_CLUSTERED);

const TRANSIENT_CONNECT_CODES = new Set(['ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'ETIMEDOUT']);

export type RedisClient = Redis | Cluster;

let _client: RedisClient | null = null;
let _attempted = false;
let _readyPromise: Promise<void> | null = null;

export function getRedisClient(): RedisClient | null {
  if (_attempted) return _client;
  _attempted = true;

  if (!redisHost) {
    _client = null;
    return _client;
  }

  try {
    const attachHandlers = (client: RedisClient, meta: Record<string, unknown>) => {
      client.on('error', (err: Error) => {
        logger.error({
          ...meta,
          err: { name: err.name, message: err.message, code: (err as NodeJS.ErrnoException).code },
        }, 'redis.connection_error');
        captureBackgroundException(err, {
          tag: 'redis.client.connection_error',
          extra: meta,
        });
      });
      client.on('connect', () => logger.info(meta, 'redis.connected'));
      client.on('ready', () => logger.info(meta, 'redis.ready'));
      client.on('close', () => logger.warn(meta, 'redis.closed'));
      client.on('reconnecting', () => logger.warn(meta, 'redis.reconnecting'));
    };

    if (redisEnableCluster) {
      logger.info({ mode: 'cluster', host: redisHost, port: redisPort, tls: redisTls }, 'redis.connecting');
      const cluster = new IORedisCluster(
        [{ host: redisHost, port: redisPort }],
        getRedisClientClusterOptions(),
      );
      _client = cluster;
      attachHandlers(cluster, { mode: 'cluster', host: redisHost, port: redisPort, tls: redisTls });
      return _client;
    }

    logger.info({ mode: 'single', host: redisHost, port: redisPort, tls: redisTls }, 'redis.connecting');
    // Canonical client options live in connectionOptions.ts. The
    // helper adds `keepAlive: 30s` which fixes the idle-LB-tear-down
    // pattern that caused ABBEYGATE-3 in BullMQ's connection.
    const redis = new IORedis(getRedisClientOptions());
    _client = redis;
    attachHandlers(redis, { mode: 'single', host: redisHost, port: redisPort, tls: redisTls });
    return _client;
  } catch (e) {
    logger.error({ err: (e as Error)?.message || String(e) }, 'redis.connect_failed');
    _client = null;
    return _client;
  }
}

/**
 * Warm the general-purpose Redis client after the HTTP port is bound.
 *
 * Why this exists (ABY-397 / ABBEYGATE-1R):
 * BullMQ is warmed via `ensureQueueRedisReady()` at API boot and kept
 * alive with TCP keepalive. The general-purpose client (`getRedisClient`)
 * was previously first-touched on a request path (inbound email webhook
 * → webhookReplayGuard). A cold TLS connect during a brief Azure Cache
 * disruption then timed out on the request path while the already-warm
 * BullMQ connection stayed healthy. Warming here puts the client on the
 * same keepAlive'd lifecycle as the queue connection so replay-guard /
 * session-cache / MCP token stores do not pay a cold connect per request.
 *
 * Non-fatal: callers that need Redis already degrade (memory fallback).
 * Missing REDIS_HOST is a no-op (local/dev without Redis).
 */
export async function ensureRedisClientReady(): Promise<void> {
  if ((process.env.NODE_ENV || 'development') === 'test') return;
  if (!redisHost) return;
  if (_readyPromise) return _readyPromise;

  _readyPromise = (async () => {
    const client = getRedisClient();
    if (!client) {
      throw new Error('ensureRedisClientReady: Redis client was not created.');
    }

    const maxAttempts = 10;
    const baseDelayMs = 500;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const status = String((client as { status?: unknown }).status || '').toLowerCase();
        if (
          typeof client.connect === 'function' &&
          (status === '' || status === 'wait' || status === 'end' || status === 'close')
        ) {
          await client.connect();
        }
        if (typeof client.ping === 'function') {
          await client.ping();
        }
        return;
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code || '';
        const isTransient = TRANSIENT_CONNECT_CODES.has(code);
        if (!isTransient || attempt === maxAttempts) {
          throw err;
        }
        const delayMs = baseDelayMs * attempt;
        logger.warn({ attempt, maxAttempts, code, delayMs }, 'redis.client.startup_retry');
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  })();

  return _readyPromise;
}

/** Test-only: reset module singleton so unit tests stay isolated. */
export function __resetRedisClientForTests(): void {
  if (_client) {
    try {
      _client.disconnect();
    } catch {
      // ignore teardown races
    }
  }
  _client = null;
  _attempted = false;
  _readyPromise = null;
}
