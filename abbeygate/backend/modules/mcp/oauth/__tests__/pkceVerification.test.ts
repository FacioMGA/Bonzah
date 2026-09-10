/**
 * Pins the PKCE S256 verification (RFC 7636 §4.2 — ADR-0040 §4).
 *
 * The OAuth token endpoint compares the SHA-256 of the supplied
 * `code_verifier` to the stashed `code_challenge`. If this comparison
 * regresses, ANY code can be exchanged with ANY verifier — defeats
 * the PKCE protection.
 *
 * Re-implements the verifier helper locally and asserts the same
 * algorithm. Static analysis (`guard:oauth-pkce-required`) confirms
 * the helper is wired into the live token endpoint.
 */
import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';

// Local re-implementation of the same algorithm used inside
// oauthFlowRouter.ts:verifyPkce. Kept here as a contract pin — if
// the live function diverges, the integration test fails.
function pkceChallenge(verifier: string): string {
    return crypto
        .createHash('sha256')
        .update(verifier)
        .digest()
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

describe('PKCE S256 verification (RFC 7636 §4.2)', () => {
    it('round-trip — matching verifier produces the stashed challenge', () => {
        const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
        const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
        expect(pkceChallenge(verifier)).toBe(expected);
    });

    it('rejects wrong verifier', () => {
        const verifier = 'this_is_not_the_right_verifier_at_all_42';
        const stashed = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
        expect(pkceChallenge(verifier)).not.toBe(stashed);
    });

    it('uses base64url (no padding, - and _ instead of + and /)', () => {
        const verifier = 'a'.repeat(48); // long enough to introduce + / = in raw base64
        const challenge = pkceChallenge(verifier);
        expect(challenge).not.toContain('=');
        expect(challenge).not.toContain('+');
        expect(challenge).not.toContain('/');
    });

    it('produces a 43-character output for a 32-byte SHA-256 (length sanity)', () => {
        const verifier = 'somethingrandomtoexerciselengthcheckabcdefgh';
        expect(pkceChallenge(verifier)).toHaveLength(43);
    });

    it('case-sensitive (a verifier with the same characters but different case produces a different challenge)', () => {
        const a = pkceChallenge('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789______');
        const b = pkceChallenge('abcdefghijklmnopqrstuvwxyz0123456789______');
        expect(a).not.toBe(b);
    });
});
