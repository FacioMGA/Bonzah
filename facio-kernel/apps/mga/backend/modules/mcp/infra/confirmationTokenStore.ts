import crypto from 'node:crypto';
import { getRedisClient } from '../../../platform/redis/client.js';
import { logger } from '../../../platform/utils/logger.js';

/**
 * Confirmation token store for the operator MCP V2 preview-then-confirm
 * pattern (ADR-0039 / ADR-0036 amendment #3).
 *
 * Same Redis SET+TTL pattern as `backend/platform/security/webhookReplayGuard.ts`.
 * Single-use redemption (GET + DEL); cross-actor redemption rejected
 * because `actorId` is part of the consume check. Falls back to a
 * per-process in-memory Map when Redis is unavailable (local dev /
 * single-pod demo); ADR-0039 §risk notes the multi-pod follow-up.
 *
 * Token shape: `tok_<32 hex>`. Key shape: `mcp:operator:preview:<token>`.
 */

const KEY_PREFIX = 'mcp:operator:preview:';
const DEFAULT_TTL_SECONDS = 600; // 10 minutes — matches ADR-0039.

export interface PreviewTokenPayload {
    /** `apikey:<id>` — must match the redeeming caller. */
    actorId: string;
    /** Preview tool that issued the token (e.g. `operator.preview_quote_send`). */
    toolName: string;
    /** Canonical entity the preview was generated for. */
    entityId: string;
    /** SHA-256 of the canonical preview input (drives token uniqueness). */
    inputHash: string;
    /** ISO timestamp the preview was produced. */
    issuedAt: string;
    /**
     * Opaque preview body — the agent received this in its previous tool
     * call; the commit tool replays it verbatim into the underlying
     * service so the operator and the LLM agree on what is being sent.
     */
    preview: unknown;
}

export interface IssueConfirmationTokenResult {
    token: string;
    expiresAt: string;
    backend: 'redis' | 'memory';
}

const inMemoryTokenCache = new Map<string, { payload: PreviewTokenPayload; expiresAtMs: number }>();

function cleanupExpired(nowMs: number): void {
    for (const [key, entry] of inMemoryTokenCache.entries()) {
        if (entry.expiresAtMs <= nowMs) inMemoryTokenCache.delete(key);
    }
}

function newToken(): string {
    return `tok_${crypto.randomBytes(16).toString('hex')}`;
}

export function hashPreviewInput(value: unknown): string {
    try {
        return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
    } catch {
        return crypto.createHash('sha256').update('unserialisable').digest('hex');
    }
}

export async function issueConfirmationToken(
    payload: PreviewTokenPayload,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<IssueConfirmationTokenResult> {
    const ttl = Math.max(30, Math.floor(ttlSeconds));
    const token = newToken();
    const key = KEY_PREFIX + token;
    const nowMs = Date.now();
    const expiresAtMs = nowMs + ttl * 1000;
    const serialised = JSON.stringify(payload);

    const redis = getRedisClient();
    if (redis?.set) {
        try {
            // `NX` because we just minted the token and the key is unique
            // by construction; the NX guards against an astronomically
            // unlikely collision rather than against duplicates.
            await redis.set(key, serialised, 'EX', ttl, 'NX');
            // Mirror into the in-memory map so a local Redis hiccup
            // between issue and consume in the same pod still resolves.
            cleanupExpired(nowMs);
            inMemoryTokenCache.set(key, { payload, expiresAtMs });
            return { token, expiresAt: new Date(expiresAtMs).toISOString(), backend: 'redis' };
        } catch (err) {
            logger.warn({ err, key }, 'mcp.confirmationToken.redis_failed_fallback_memory');
        }
    }

    cleanupExpired(nowMs);
    inMemoryTokenCache.set(key, { payload, expiresAtMs });
    return { token, expiresAt: new Date(expiresAtMs).toISOString(), backend: 'memory' };
}

export interface ConsumeConfirmationTokenExpected {
    actorId: string;
    toolName: string;
    entityId: string;
}

/**
 * Redeem a token. Returns the stored preview payload if and only if:
 *   - the token exists,
 *   - has not expired,
 *   - and its `actorId` / `toolName` / `entityId` match the expected
 *     consumer (cross-actor + cross-tool redemption rejected).
 *
 * On success the token is deleted (single-use). On any failure returns
 * `null` — the caller must surface a generic CONFIRMATION_TOKEN_INVALID
 * error without leaking which specific check failed.
 */
export async function consumeConfirmationToken(
    token: string,
    expected: ConsumeConfirmationTokenExpected,
): Promise<PreviewTokenPayload | null> {
    if (!token || !token.startsWith('tok_')) return null;
    const key = KEY_PREFIX + token;
    let payload: PreviewTokenPayload | null = null;
    const nowMs = Date.now();

    const redis = getRedisClient();
    if (redis?.get && redis?.del) {
        try {
            const raw = await redis.get(key);
            if (typeof raw === 'string' && raw.length > 0) {
                try {
                    payload = JSON.parse(raw) as PreviewTokenPayload;
                } catch (parseErr) {
                    logger.warn({ err: parseErr, key }, 'mcp.confirmationToken.parse_failed');
                }
            }
            // Always attempt to delete (idempotent) so a subsequent
            // replay cannot succeed even if we abort below.
            await redis.del(key);
        } catch (err) {
            logger.warn({ err, key }, 'mcp.confirmationToken.redis_consume_failed_fallback_memory');
        }
    }

    if (!payload) {
        const memEntry = inMemoryTokenCache.get(key);
        if (memEntry && memEntry.expiresAtMs > nowMs) {
            payload = memEntry.payload;
        }
        inMemoryTokenCache.delete(key);
    } else {
        inMemoryTokenCache.delete(key);
    }

    if (!payload) return null;
    if (payload.actorId !== expected.actorId) return null;
    if (payload.toolName !== expected.toolName) return null;
    if (payload.entityId !== expected.entityId) return null;
    return payload;
}

/** Test-only: clear in-memory state between vitest runs. */
export function __resetConfirmationTokenStoreForTests(): void {
    inMemoryTokenCache.clear();
}
