import crypto from 'crypto';
import type { PerfTimings } from './perfTimings.js';
import { getRedisClient } from '../../../platform/redis/client.js';

type CacheRecord<T> = { value: T; expiresAtMs: number };

const mem = new Map<string, CacheRecord<unknown>>();

function nowMs() {
  return Date.now();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isProdLike() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

export function isPublicSessionLightCacheEnabled() {
  const flag = String(process.env.PUBLIC_SESSION_LIGHT_CACHE || '').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no') return false;
  // Default: enabled only in prod-like envs.
  return flag === '1' || flag === 'true' || isProdLike();
}

export function publicSessionLightCacheTtlSeconds() {
  const v = Number(process.env.PUBLIC_SESSION_LIGHT_CACHE_TTL_SECONDS || 30);
  if (!Number.isFinite(v) || v <= 0) return 30;
  return Math.min(Math.max(5, Math.floor(v)), 300);
}

function keyForToken(token: string) {
  return `publicAutoSession:token:${token}`;
}

function lockKeyForToken(token: string) {
  return `publicAutoSession:lock:${token}`;
}

function hasRedisCacheCommands(
  client: ReturnType<typeof getRedisClient>
): client is NonNullable<ReturnType<typeof getRedisClient>> {
  return Boolean(
    client &&
      typeof client.get === 'function' &&
      typeof client.setex === 'function' &&
      typeof client.del === 'function' &&
      typeof client.set === 'function' &&
      typeof client.eval === 'function'
  );
}

export async function getCachedLightByToken<T>(token: string, perf?: PerfTimings): Promise<T | null> {
  if (!isPublicSessionLightCacheEnabled()) return null;
  const k = keyForToken(token);

  const redis = getRedisClient();
  if (hasRedisCacheCommands(redis)) {
    const end = perf?.start('cache', 'redis_get');
    try {
      const raw = await redis.get(k);
      if (!raw) return null;
      const parsed = JSON.parse(String(raw));
      return parsed as T;
    } catch {
      return null;
    } finally {
      end?.();
    }
  }

  // Dev fallback: in-memory TTL cache
  const end = perf?.start('cache', 'mem_get');
  try {
    const rec = mem.get(k);
    if (!rec) return null;
    if (rec.expiresAtMs <= nowMs()) {
      mem.delete(k);
      return null;
    }
    return rec.value as T;
  } finally {
    end?.();
  }
}

export async function setCachedLightByToken<T>(token: string, value: T, perf?: PerfTimings): Promise<void> {
  if (!isPublicSessionLightCacheEnabled()) return;
  const k = keyForToken(token);
  const ttl = publicSessionLightCacheTtlSeconds();

  const redis = getRedisClient();
  if (hasRedisCacheCommands(redis)) {
    const end = perf?.start('cache', 'redis_setex');
    try {
      await redis.setex(k, ttl, JSON.stringify(value));
    } catch {
      // ignore
    } finally {
      end?.();
    }
    return;
  }

  const end = perf?.start('cache', 'mem_set');
  try {
    mem.set(k, { value, expiresAtMs: nowMs() + ttl * 1000 });
  } finally {
    end?.();
  }
}

export async function invalidateCachedLightByToken(token: string, perf?: PerfTimings): Promise<void> {
  if (!isPublicSessionLightCacheEnabled()) return;
  const k = keyForToken(token);
  const redis = getRedisClient();
  if (hasRedisCacheCommands(redis)) {
    const end = perf?.start('cache', 'redis_del');
    try {
      await redis.del(k);
    } catch {
      // ignore
    } finally {
      end?.();
    }
    return;
  }

  const end = perf?.start('cache', 'mem_del');
  try {
    mem.delete(k);
  } finally {
    end?.();
  }
}

export async function singleflightTokenLock(token: string, perf?: PerfTimings): Promise<{ acquired: boolean; token: string }> {
  if (!isPublicSessionLightCacheEnabled()) return { acquired: false, token: '' };
  const redis = getRedisClient();
  if (!hasRedisCacheCommands(redis)) return { acquired: false, token: '' };

  const lockKey = lockKeyForToken(token);
  const lockVal = crypto.randomUUID();
  const end = perf?.start('cache', 'redis_lock');
  try {
    // PX 5000ms lock; NX to acquire.
    const res = await redis.set(lockKey, lockVal, 'PX', 5000, 'NX');
    return { acquired: res === 'OK', token: lockVal };
  } catch {
    return { acquired: false, token: '' };
  } finally {
    end?.();
  }
}

export async function releaseSingleflightTokenLock(token: string, lockToken: string, perf?: PerfTimings): Promise<void> {
  const redis = getRedisClient();
  if (!hasRedisCacheCommands(redis)) return;
  const lockKey = lockKeyForToken(token);

  // Compare-and-del via Lua to avoid deleting another holder's lock.
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  const end = perf?.start('cache', 'redis_unlock');
  try {
    await redis.eval(script, 1, lockKey, lockToken);
  } catch {
    // ignore
  } finally {
    end?.();
  }
}

export async function waitForCacheFill<T>(token: string, attempts: number, perf?: PerfTimings): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    await sleep(35 + i * 25);
    const v = await getCachedLightByToken<T>(token, perf);
    if (v) return v;
  }
  return null;
}

