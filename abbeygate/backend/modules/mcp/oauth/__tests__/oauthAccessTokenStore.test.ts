/**
 * Pins the opaque OAuth access-token store (ADR-0040 §7).
 *
 * Same shape contract as confirmationTokenStore: round-trip, expiry,
 * revoke (single-shot, idempotent).
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    issueAccessToken,
    validateAccessToken,
    revokeAccessToken,
    __resetAccessTokenStoreForTests,
} from '../infra/oauthAccessTokenStore.js';

describe('oauthAccessTokenStore', () => {
    beforeEach(() => {
        __resetAccessTokenStoreForTests();
    });

    const payload = () => ({
        clientId: 'oauthc_abc',
        userId: 'user-1',
        operatingTenantId: 'tenant-cy',
        resource: 'https://abbeygate-cy.facio.io/api/v1/mcp/operator',
        scopes: ['operator.read', 'operator.comm'],
        issuedAt: new Date().toISOString(),
    });

    it('round-trips a freshly minted token', async () => {
        const { rawToken } = await issueAccessToken(payload(), 60);
        expect(rawToken).toMatch(/^at_[a-f0-9]{64}$/);
        const got = await validateAccessToken(rawToken);
        expect(got?.clientId).toBe('oauthc_abc');
        expect(got?.scopes).toEqual(['operator.read', 'operator.comm']);
    });

    it('rejects malformed token strings without DB lookup', async () => {
        expect(await validateAccessToken('not-a-token')).toBeNull();
        expect(await validateAccessToken('')).toBeNull();
    });

    it('is repeatedly redeemable until expiry (not single-use, unlike auth codes)', async () => {
        const { rawToken } = await issueAccessToken(payload(), 60);
        expect(await validateAccessToken(rawToken)).not.toBeNull();
        expect(await validateAccessToken(rawToken)).not.toBeNull();
        expect(await validateAccessToken(rawToken)).not.toBeNull();
    });

    it('expires after TTL elapses (memory fallback)', async () => {
        vi.useFakeTimers();
        try {
            const { rawToken } = await issueAccessToken(payload(), 60);
            vi.advanceTimersByTime(120_000);
            expect(await validateAccessToken(rawToken)).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('revokes immediately and idempotently', async () => {
        const { rawToken } = await issueAccessToken(payload(), 60);
        await revokeAccessToken(rawToken);
        expect(await validateAccessToken(rawToken)).toBeNull();
        // Idempotent — second call does nothing destructive.
        await revokeAccessToken(rawToken);
        expect(await validateAccessToken(rawToken)).toBeNull();
    });
});
