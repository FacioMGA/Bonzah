/**
 * Opaque OAuth access-token store (ADR-0040 §7).
 *
 * Access tokens are hot-path — every MCP request validates one. Same
 * Redis SET+TTL pattern as `confirmationTokenStore.ts`, with an
 * in-process memory fallback for single-pod dev. Tokens are SHA-256
 * hashed; the raw `at_<32hex>` value lives only in the OAuth client's
 * local storage.
 */
import crypto from 'node:crypto';
import { getRedisClient } from '../../../../platform/redis/client.js';
import { logger } from '../../../../platform/utils/logger.js';

const KEY_PREFIX = 'mcp:oauth:at:';
const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour — matches ADR-0040 §7

export interface AccessTokenPayload {
    /** `oauth_client:<clientId>` — drives audit + cross-actor checks. */
    clientId: string;
    /** BO user id that originally granted consent. */
    userId: string;
    /** RFC 8707 resource URL — token is bound to ONE MCP mount. */
    resource: string;
    /** Tenant the token was issued for. Cross-tenant use → reject. */
    operatingTenantId: string;
    scopes: string[];
    issuedAt: string;
}

export interface IssueAccessTokenResult {
    rawToken: string;
    expiresAt: string;
    backend: 'redis' | 'memory';
}

const inMemory = new Map<string, { payload: AccessTokenPayload; expiresAtMs: number }>();

function cleanup(nowMs: number): void {
    for (const [k, v] of inMemory.entries()) {
        if (v.expiresAtMs <= nowMs) inMemory.delete(k);
    }
}

function hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

function newAccessToken(): string {
    return `at_${crypto.randomBytes(32).toString('hex')}`;
}

export async function issueAccessToken(
    payload: AccessTokenPayload,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<IssueAccessTokenResult> {
    const ttl = Math.max(60, Math.floor(ttlSeconds));
    const rawToken = newAccessToken();
    const key = KEY_PREFIX + hashToken(rawToken);
    const nowMs = Date.now();
    const expiresAtMs = nowMs + ttl * 1000;
    const serialised = JSON.stringify(payload);

    const redis = getRedisClient();
    if (redis?.set) {
        try {
            await redis.set(key, serialised, 'EX', ttl, 'NX');
            cleanup(nowMs);
            inMemory.set(key, { payload, expiresAtMs });
            return { rawToken, expiresAt: new Date(expiresAtMs).toISOString(), backend: 'redis' };
        } catch (err) {
            logger.warn({ err, key }, 'mcp.oauth.accessToken.redis_failed_fallback_memory');
        }
    }
    cleanup(nowMs);
    inMemory.set(key, { payload, expiresAtMs });
    return { rawToken, expiresAt: new Date(expiresAtMs).toISOString(), backend: 'memory' };
}

/**
 * Validate a presented access token. Returns the stored payload or null.
 * On null, the caller MUST reject with 401 + WWW-Authenticate per spec.
 *
 * NOT single-use — access tokens are presented on every MCP request
 * until they expire. Refresh tokens (handled separately) ARE rotated.
 */
export async function validateAccessToken(rawToken: string): Promise<AccessTokenPayload | null> {
    if (!rawToken || !rawToken.startsWith('at_')) return null;
    const key = KEY_PREFIX + hashToken(rawToken);
    const nowMs = Date.now();

    const redis = getRedisClient();
    if (redis?.get) {
        try {
            const raw = await redis.get(key);
            if (typeof raw === 'string' && raw.length > 0) {
                try {
                    return JSON.parse(raw) as AccessTokenPayload;
                } catch (err) {
                    logger.warn({ err, key }, 'mcp.oauth.accessToken.parse_failed');
                    return null;
                }
            }
            // Redis miss; fall through to memory.
        } catch (err) {
            logger.warn({ err, key }, 'mcp.oauth.accessToken.redis_get_failed_fallback_memory');
        }
    }
    const mem = inMemory.get(key);
    if (mem && mem.expiresAtMs > nowMs) return mem.payload;
    if (mem) inMemory.delete(key);
    return null;
}

/**
 * Revoke an access token immediately (RFC 7009). Idempotent.
 */
export async function revokeAccessToken(rawToken: string): Promise<void> {
    if (!rawToken || !rawToken.startsWith('at_')) return;
    const key = KEY_PREFIX + hashToken(rawToken);
    const redis = getRedisClient();
    if (redis?.del) {
        try {
            await redis.del(key);
        } catch (err) {
            logger.warn({ err, key }, 'mcp.oauth.accessToken.redis_del_failed');
        }
    }
    inMemory.delete(key);
}

export function __resetAccessTokenStoreForTests(): void {
    inMemory.clear();
}
