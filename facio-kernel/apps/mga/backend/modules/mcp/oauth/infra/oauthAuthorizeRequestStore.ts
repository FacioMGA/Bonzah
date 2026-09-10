/**
 * Authorize-request store (ADR-0040 §2 — Phase B).
 *
 * `GET /oauth/authorize` validates PKCE/scope/resource and stashes the
 * request in Redis with a 10-minute TTL, then redirects the BO user to
 * the consent screen with an opaque `req=<id>` handle. After the user
 * clicks Allow/Deny, the consent decision endpoint retrieves the stashed
 * request, applies role-based scope filtering, and issues an
 * authorization code.
 *
 * 10-minute TTL is generous (the user might have to log into the BO
 * first) but bounded — a stale request can't be replayed after the
 * window closes.
 */
import crypto from 'node:crypto';
import { getRedisClient } from '../../../../platform/redis/client.js';
import { logger } from '../../../../platform/utils/logger.js';

const KEY_PREFIX = 'mcp:oauth:authreq:';
const DEFAULT_TTL_SECONDS = 10 * 60;

export interface AuthorizeRequestPayload {
    clientId: string;
    operatingTenantId: string;
    redirectUri: string;
    requestedScopes: string[];
    resource: string;
    codeChallenge: string;
    codeChallengeMethod: 'S256';
    state: string;
    issuedAt: string;
}

export interface IssueAuthorizeRequestResult {
    requestId: string;
    expiresAt: string;
}

const inMemory = new Map<string, { payload: AuthorizeRequestPayload; expiresAtMs: number }>();

function cleanup(nowMs: number): void {
    for (const [k, v] of inMemory.entries()) {
        if (v.expiresAtMs <= nowMs) inMemory.delete(k);
    }
}

function newRequestId(): string {
    return `authreq_${crypto.randomBytes(20).toString('hex')}`;
}

export async function stashAuthorizeRequest(
    payload: AuthorizeRequestPayload,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<IssueAuthorizeRequestResult> {
    const ttl = Math.max(60, Math.floor(ttlSeconds));
    const requestId = newRequestId();
    const key = KEY_PREFIX + requestId;
    const nowMs = Date.now();
    const expiresAtMs = nowMs + ttl * 1000;
    const serialised = JSON.stringify(payload);
    const redis = getRedisClient();
    if (redis?.set) {
        try {
            await redis.set(key, serialised, 'EX', ttl, 'NX');
            cleanup(nowMs);
            inMemory.set(key, { payload, expiresAtMs });
            return { requestId, expiresAt: new Date(expiresAtMs).toISOString() };
        } catch (err) {
            logger.warn({ err, key }, 'mcp.oauth.authreq.redis_failed_fallback_memory');
        }
    }
    cleanup(nowMs);
    inMemory.set(key, { payload, expiresAtMs });
    return { requestId, expiresAt: new Date(expiresAtMs).toISOString() };
}

export async function loadAuthorizeRequest(requestId: string): Promise<AuthorizeRequestPayload | null> {
    if (!requestId.startsWith('authreq_')) return null;
    const key = KEY_PREFIX + requestId;
    const nowMs = Date.now();
    const redis = getRedisClient();
    if (redis?.get) {
        try {
            const raw = await redis.get(key);
            if (typeof raw === 'string' && raw.length > 0) {
                try {
                    return JSON.parse(raw) as AuthorizeRequestPayload;
                } catch (err) {
                    logger.warn({ err, key }, 'mcp.oauth.authreq.parse_failed');
                }
            }
        } catch (err) {
            logger.warn({ err, key }, 'mcp.oauth.authreq.redis_get_failed_fallback_memory');
        }
    }
    const mem = inMemory.get(key);
    if (mem && mem.expiresAtMs > nowMs) return mem.payload;
    return null;
}

export async function deleteAuthorizeRequest(requestId: string): Promise<void> {
    if (!requestId.startsWith('authreq_')) return;
    const key = KEY_PREFIX + requestId;
    const redis = getRedisClient();
    if (redis?.del) {
        try { await redis.del(key); } catch { /* best-effort */ }
    }
    inMemory.delete(key);
}

export function __resetAuthorizeRequestStoreForTests(): void {
    inMemory.clear();
}
