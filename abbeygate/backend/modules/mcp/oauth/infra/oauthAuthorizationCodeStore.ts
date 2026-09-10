/**
 * Authorization-code store for the PKCE flow (ADR-0040 §7).
 *
 * 60-second TTL, single-use. PKCE code_challenge stored alongside the
 * code; the /oauth/token handler verifies code_verifier → SHA-256 →
 * matches code_challenge before issuing tokens.
 *
 * Same Redis SET+TTL pattern as `confirmationTokenStore.ts`.
 */
import crypto from 'node:crypto';
import { getRedisClient } from '../../../../platform/redis/client.js';
import { logger } from '../../../../platform/utils/logger.js';

const KEY_PREFIX = 'mcp:oauth:code:';
const DEFAULT_TTL_SECONDS = 60; // 60s — per ADR-0040 §7

export interface AuthorizationCodePayload {
    clientId: string;
    userId: string;
    operatingTenantId: string;
    scopes: string[];
    resource: string;
    redirectUri: string;
    // PKCE — RFC 7636. Only S256 supported (per ADR-0040 §4).
    codeChallenge: string;
    codeChallengeMethod: 'S256';
    issuedAt: string;
}

export interface IssueAuthorizationCodeResult {
    code: string;
    expiresAt: string;
    backend: 'redis' | 'memory';
}

const inMemory = new Map<string, { payload: AuthorizationCodePayload; expiresAtMs: number }>();

function cleanup(nowMs: number): void {
    for (const [k, v] of inMemory.entries()) {
        if (v.expiresAtMs <= nowMs) inMemory.delete(k);
    }
}

function newCode(): string {
    return `code_${crypto.randomBytes(24).toString('hex')}`;
}

export async function issueAuthorizationCode(
    payload: AuthorizationCodePayload,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<IssueAuthorizationCodeResult> {
    if (payload.codeChallengeMethod !== 'S256') {
        throw new Error('Only PKCE code_challenge_method=S256 is supported (ADR-0040 §4).');
    }
    const ttl = Math.max(30, Math.floor(ttlSeconds));
    const code = newCode();
    const key = KEY_PREFIX + code;
    const nowMs = Date.now();
    const expiresAtMs = nowMs + ttl * 1000;
    const serialised = JSON.stringify(payload);

    const redis = getRedisClient();
    if (redis?.set) {
        try {
            await redis.set(key, serialised, 'EX', ttl, 'NX');
            cleanup(nowMs);
            inMemory.set(key, { payload, expiresAtMs });
            return { code, expiresAt: new Date(expiresAtMs).toISOString(), backend: 'redis' };
        } catch (err) {
            logger.warn({ err, key }, 'mcp.oauth.authCode.redis_failed_fallback_memory');
        }
    }
    cleanup(nowMs);
    inMemory.set(key, { payload, expiresAtMs });
    return { code, expiresAt: new Date(expiresAtMs).toISOString(), backend: 'memory' };
}

/**
 * Consume the code (single-use; GET + DEL). Returns the stored payload
 * if and only if the code exists, has not expired, and the supplied
 * `clientId` + `redirectUri` match the values bound at issue time.
 *
 * NOTE: PKCE verification (`code_verifier` against `codeChallenge`) is
 * the responsibility of the token endpoint, NOT this store — keeps the
 * store independent of the PKCE algorithm choice if we ever add others.
 */
export async function consumeAuthorizationCode(
    code: string,
    expected: { clientId: string; redirectUri: string },
): Promise<AuthorizationCodePayload | null> {
    if (!code || !code.startsWith('code_')) return null;
    const key = KEY_PREFIX + code;
    let payload: AuthorizationCodePayload | null = null;
    const nowMs = Date.now();

    const redis = getRedisClient();
    if (redis?.get && redis?.del) {
        try {
            const raw = await redis.get(key);
            if (typeof raw === 'string' && raw.length > 0) {
                try {
                    payload = JSON.parse(raw) as AuthorizationCodePayload;
                } catch (err) {
                    logger.warn({ err, key }, 'mcp.oauth.authCode.parse_failed');
                }
            }
            await redis.del(key); // single-use
        } catch (err) {
            logger.warn({ err, key }, 'mcp.oauth.authCode.redis_consume_failed_fallback_memory');
        }
    }
    if (!payload) {
        const mem = inMemory.get(key);
        if (mem && mem.expiresAtMs > nowMs) payload = mem.payload;
    }
    inMemory.delete(key);
    if (!payload) return null;
    if (payload.clientId !== expected.clientId) return null;
    if (payload.redirectUri !== expected.redirectUri) return null;
    return payload;
}

export function __resetAuthorizationCodeStoreForTests(): void {
    inMemory.clear();
}
