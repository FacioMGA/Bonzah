/**
 * Pins the OAuth authorization-code store (ADR-0040 §7).
 *
 * Codes are PKCE-bound, single-use, 60-second TTL, scoped by
 * clientId + redirectUri.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    issueAuthorizationCode,
    consumeAuthorizationCode,
    __resetAuthorizationCodeStoreForTests,
} from '../infra/oauthAuthorizationCodeStore.js';

describe('oauthAuthorizationCodeStore', () => {
    beforeEach(() => {
        __resetAuthorizationCodeStoreForTests();
    });

    const payload = () => ({
        clientId: 'oauthc_abc',
        userId: 'user-1',
        operatingTenantId: 'tenant-cy',
        scopes: ['operator.read'],
        resource: 'https://abbeygate-cy.facio.io/api/v1/mcp/operator',
        redirectUri: 'https://chatgpt.com/connector/callback',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        codeChallengeMethod: 'S256' as const,
        issuedAt: new Date().toISOString(),
    });

    it('round-trips a freshly issued code with matching client + redirect', async () => {
        const { code } = await issueAuthorizationCode(payload(), 60);
        expect(code).toMatch(/^code_[a-f0-9]{48}$/);
        const got = await consumeAuthorizationCode(code, {
            clientId: 'oauthc_abc',
            redirectUri: 'https://chatgpt.com/connector/callback',
        });
        expect(got?.scopes).toEqual(['operator.read']);
        expect(got?.codeChallenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });

    it('is single-use — second consume returns null', async () => {
        const { code } = await issueAuthorizationCode(payload(), 60);
        const expect1 = await consumeAuthorizationCode(code, {
            clientId: 'oauthc_abc',
            redirectUri: 'https://chatgpt.com/connector/callback',
        });
        const expect2 = await consumeAuthorizationCode(code, {
            clientId: 'oauthc_abc',
            redirectUri: 'https://chatgpt.com/connector/callback',
        });
        expect(expect1).not.toBeNull();
        expect(expect2).toBeNull();
    });

    it('rejects mismatched client_id', async () => {
        const { code } = await issueAuthorizationCode(payload(), 60);
        const got = await consumeAuthorizationCode(code, {
            clientId: 'oauthc_DIFFERENT',
            redirectUri: 'https://chatgpt.com/connector/callback',
        });
        expect(got).toBeNull();
    });

    it('rejects mismatched redirect_uri (mix-up attack)', async () => {
        const { code } = await issueAuthorizationCode(payload(), 60);
        const got = await consumeAuthorizationCode(code, {
            clientId: 'oauthc_abc',
            redirectUri: 'https://attacker.example/callback',
        });
        expect(got).toBeNull();
    });

    it('expires after TTL elapses', async () => {
        vi.useFakeTimers();
        try {
            const { code } = await issueAuthorizationCode(payload(), 30);
            vi.advanceTimersByTime(60_000);
            const got = await consumeAuthorizationCode(code, {
                clientId: 'oauthc_abc',
                redirectUri: 'https://chatgpt.com/connector/callback',
            });
            expect(got).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('refuses to issue with non-S256 challenge method (ADR-0040 §4)', async () => {
        await expect(
            issueAuthorizationCode({ ...payload(), codeChallengeMethod: 'plain' as 'S256' }, 60),
        ).rejects.toThrow(/S256/);
    });

    it('rejects malformed code strings', async () => {
        const got = await consumeAuthorizationCode('not-a-code', {
            clientId: 'oauthc_abc',
            redirectUri: 'https://chatgpt.com/connector/callback',
        });
        expect(got).toBeNull();
    });
});
