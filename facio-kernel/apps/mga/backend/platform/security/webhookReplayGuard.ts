import { createHash } from 'crypto';
import { getRedisClient } from '../redis/client.js';
import { logger } from '../utils/logger.js';

const inMemoryReplayCache = new Map<string, number>();

function cleanupExpired(nowMs: number) {
  for (const [key, expiresAt] of inMemoryReplayCache.entries()) {
    if (expiresAt <= nowMs) inMemoryReplayCache.delete(key);
  }
}

function toStableKey(args: {
  namespace: string;
  payload: string;
  signature?: string;
  timestamp?: string;
}): string {
  const payloadHash = createHash('sha256').update(args.payload, 'utf8').digest('hex');
  return [
    'replay',
    args.namespace,
    String(args.timestamp || ''),
    String(args.signature || ''),
    payloadHash,
  ].join(':');
}

export async function registerWebhookReplayAttempt(args: {
  namespace: string;
  payload: string;
  signature?: string;
  timestamp?: string;
  ttlSeconds: number;
}): Promise<{ duplicate: boolean; key: string; backend: 'redis' | 'memory' }> {
  const ttlSeconds = Math.max(1, Math.floor(args.ttlSeconds));
  const key = toStableKey(args);
  const nowMs = Date.now();
  cleanupExpired(nowMs);
  const memoryExpiry = inMemoryReplayCache.get(key);
  if (typeof memoryExpiry === 'number' && memoryExpiry > nowMs) {
    return { duplicate: true, key, backend: 'memory' };
  }

  const redis = getRedisClient();
  if (redis?.set) {
    try {
      const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
      if (!result) {
        inMemoryReplayCache.set(key, nowMs + ttlSeconds * 1000);
        return { duplicate: true, key, backend: 'redis' };
      }
      inMemoryReplayCache.set(key, nowMs + ttlSeconds * 1000);
      return { duplicate: false, key, backend: 'redis' };
    } catch (error) {
      logger.warn({ err: error, key }, 'webhook.replay.redis_failed_fallback_memory');
    }
  }

  inMemoryReplayCache.set(key, nowMs + ttlSeconds * 1000);
  return { duplicate: false, key, backend: 'memory' };
}

export function __resetWebhookReplayGuardForTests() {
  inMemoryReplayCache.clear();
}
