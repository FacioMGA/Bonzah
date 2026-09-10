import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    issueConfirmationToken,
    consumeConfirmationToken,
    hashPreviewInput,
    __resetConfirmationTokenStoreForTests,
} from '../confirmationTokenStore.js';

// Force the memory-fallback path: getRedisClient() returns null when
// REDIS_URL is unset in tests, which is the case in the unit suite.

describe('confirmationTokenStore (operator MCP V2 / ADR-0039)', () => {
    beforeEach(() => {
        __resetConfirmationTokenStoreForTests();
    });

    it('round-trips a token for the same actor/tool/entity', async () => {
        const payload = {
            actorId: 'apikey:k1',
            toolName: 'operator.preview_quote_send',
            entityId: 'pol-1',
            inputHash: hashPreviewInput({ patch: { excess: 750 } }),
            issuedAt: new Date().toISOString(),
            preview: { diff: [{ field: 'excess', from: 400, to: 750 }] },
        };
        const issued = await issueConfirmationToken(payload, 60);
        expect(issued.token).toMatch(/^tok_[a-f0-9]{32}$/);
        expect(issued.expiresAt).toBeTruthy();

        const consumed = await consumeConfirmationToken(issued.token, {
            actorId: 'apikey:k1',
            toolName: 'operator.preview_quote_send',
            entityId: 'pol-1',
        });
        expect(consumed).not.toBeNull();
        expect(consumed?.actorId).toBe('apikey:k1');
        expect(consumed?.preview).toEqual({
            diff: [{ field: 'excess', from: 400, to: 750 }],
        });
    });

    it('is single-use — second consume returns null', async () => {
        const payload = {
            actorId: 'apikey:k1',
            toolName: 'operator.preview_quote_send',
            entityId: 'pol-1',
            inputHash: 'h',
            issuedAt: new Date().toISOString(),
            preview: {},
        };
        const { token } = await issueConfirmationToken(payload, 60);
        const first = await consumeConfirmationToken(token, {
            actorId: 'apikey:k1',
            toolName: 'operator.preview_quote_send',
            entityId: 'pol-1',
        });
        const second = await consumeConfirmationToken(token, {
            actorId: 'apikey:k1',
            toolName: 'operator.preview_quote_send',
            entityId: 'pol-1',
        });
        expect(first).not.toBeNull();
        expect(second).toBeNull();
    });

    it('rejects cross-actor redemption', async () => {
        const payload = {
            actorId: 'apikey:owner',
            toolName: 'operator.preview_quote_send',
            entityId: 'pol-1',
            inputHash: 'h',
            issuedAt: new Date().toISOString(),
            preview: {},
        };
        const { token } = await issueConfirmationToken(payload, 60);
        const consumed = await consumeConfirmationToken(token, {
            actorId: 'apikey:thief',
            toolName: 'operator.preview_quote_send',
            entityId: 'pol-1',
        });
        expect(consumed).toBeNull();
    });

    it('rejects cross-tool redemption (preview vs commit confusion)', async () => {
        const payload = {
            actorId: 'apikey:k1',
            toolName: 'operator.preview_quote_send',
            entityId: 'pol-1',
            inputHash: 'h',
            issuedAt: new Date().toISOString(),
            preview: {},
        };
        const { token } = await issueConfirmationToken(payload, 60);
        const consumed = await consumeConfirmationToken(token, {
            actorId: 'apikey:k1',
            toolName: 'operator.preview_endorsement_draft', // wrong tool
            entityId: 'pol-1',
        });
        expect(consumed).toBeNull();
    });

    it('rejects cross-entity redemption (replay against a different policy)', async () => {
        const payload = {
            actorId: 'apikey:k1',
            toolName: 'operator.preview_quote_send',
            entityId: 'pol-1',
            inputHash: 'h',
            issuedAt: new Date().toISOString(),
            preview: {},
        };
        const { token } = await issueConfirmationToken(payload, 60);
        const consumed = await consumeConfirmationToken(token, {
            actorId: 'apikey:k1',
            toolName: 'operator.preview_quote_send',
            entityId: 'pol-OTHER',
        });
        expect(consumed).toBeNull();
    });

    it('expires after TTL elapses (memory fallback)', async () => {
        vi.useFakeTimers();
        try {
            const payload = {
                actorId: 'apikey:k1',
                toolName: 'operator.preview_quote_send',
                entityId: 'pol-1',
                inputHash: 'h',
                issuedAt: new Date().toISOString(),
                preview: {},
            };
            const { token } = await issueConfirmationToken(payload, 30);
            vi.advanceTimersByTime(60_000);
            const consumed = await consumeConfirmationToken(token, {
                actorId: 'apikey:k1',
                toolName: 'operator.preview_quote_send',
                entityId: 'pol-1',
            });
            expect(consumed).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects malformed tokens without DB lookup', async () => {
        const consumed = await consumeConfirmationToken('not-a-token', {
            actorId: 'apikey:k1',
            toolName: 'operator.preview_quote_send',
            entityId: 'pol-1',
        });
        expect(consumed).toBeNull();
    });

    it('hashPreviewInput is stable for equivalent JSON', () => {
        expect(hashPreviewInput({ a: 1, b: [2, 3] })).toBe(
            hashPreviewInput({ a: 1, b: [2, 3] }),
        );
    });
});
