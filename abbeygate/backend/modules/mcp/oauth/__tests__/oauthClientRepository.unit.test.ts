/**
 * Unit-level pins for the OAuth client repository (ADR-0040 §7).
 *
 * These exercise the helpers that DON'T touch Prisma — token shape,
 * hash determinism, refresh-token generation contract. Full DB-level
 * tests live in the integration suite.
 */
import { describe, it, expect } from 'vitest';
import {
    hashRefreshToken,
    newRefreshToken,
} from '../infra/oauthClientRepository.js';

describe('oauthClientRepository — token helpers', () => {
    it('newRefreshToken returns a properly-prefixed 64-hex token', () => {
        const a = newRefreshToken();
        expect(a).toMatch(/^rt_[a-f0-9]{64}$/);
    });

    it('newRefreshToken returns distinct values on each call', () => {
        const tokens = Array.from({ length: 32 }, () => newRefreshToken());
        const unique = new Set(tokens);
        expect(unique.size).toBe(tokens.length);
    });

    it('hashRefreshToken is deterministic for the same input', () => {
        const t = 'rt_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
        expect(hashRefreshToken(t)).toBe(hashRefreshToken(t));
    });

    it('hashRefreshToken returns 64-char hex (SHA-256)', () => {
        const t = newRefreshToken();
        expect(hashRefreshToken(t)).toMatch(/^[a-f0-9]{64}$/);
    });

    it('hashRefreshToken produces different hashes for different inputs', () => {
        const a = hashRefreshToken('rt_a');
        const b = hashRefreshToken('rt_b');
        expect(a).not.toBe(b);
    });
});
