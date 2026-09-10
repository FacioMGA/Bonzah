/**
 * `quoteToken` — secret separation contract (ADR-0019 / PR 2).
 *
 * Pins the post-deletion behaviour: signing reads `QUOTE_TOKEN_SECRET`
 * only. The legacy fallback that swapped in `JWT_SECRET` when
 * `QUOTE_TOKEN_SECRET` was unset has been deleted; the
 * `check-no-deleted-identifiers` guard refuses re-introduction of the
 * literal quote-token-secret-to-session-secret OR chain.
 *
 * Production startup validation (`backend/platform/config/startupValidation.ts`)
 * additionally enforces that both secrets are set in production AND that
 * they are not equal.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signQuoteToken, verifyQuoteToken } from '../quoteToken.js';

describe('quoteToken — secret separation', () => {
  const ENV_BACKUP: Record<string, string | undefined> = {};
  const KEYS = ['QUOTE_TOKEN_SECRET', 'JWT_SECRET'] as const;

  beforeEach(() => {
    for (const k of KEYS) {
      ENV_BACKUP[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      const prev = ENV_BACKUP[k];
      if (prev === undefined) delete process.env[k];
      else process.env[k] = prev;
    }
  });

  it('signs successfully when QUOTE_TOKEN_SECRET is set', () => {
    process.env.QUOTE_TOKEN_SECRET = 'unit-test-quote-secret-only';
    const { token } = signQuoteToken({
      productType: 'MOTOR',
      quoteData: { proposer: { dob: '1990-01-01' } },
      premium: 200,
      currency: 'EUR',
    });
    const verified = verifyQuoteToken(token);
    expect(verified.pt).toBe('MOTOR');
    expect(verified.p).toBe(200);
  });

  it('throws when QUOTE_TOKEN_SECRET is missing — JWT_SECRET fallback is gone', () => {
    process.env.JWT_SECRET = 'unit-test-jwt-secret-should-not-substitute';
    expect(() =>
      signQuoteToken({
        productType: 'MOTOR',
        quoteData: {},
        premium: 0,
        currency: 'EUR',
      }),
    ).toThrow(/QUOTE_TOKEN_SECRET is not defined/);
  });

  it('does not accept tokens signed with JWT_SECRET when QUOTE_TOKEN_SECRET is set', () => {
    // Sign a token against JWT_SECRET-the-string.
    process.env.JWT_SECRET = 'jwt-secret-for-this-test';
    process.env.QUOTE_TOKEN_SECRET = 'jwt-secret-for-this-test'; // pretend pre-PR-2 behaviour
    const { token } = signQuoteToken({
      productType: 'MOTOR',
      quoteData: {},
      premium: 0,
      currency: 'EUR',
    });
    // Now rotate QUOTE_TOKEN_SECRET to a different value; the previously
    // signed token must NOT verify under the new secret. This is the
    // independence property: rotating one secret does not affect the other.
    process.env.QUOTE_TOKEN_SECRET = 'rotated-quote-token-secret';
    expect(() => verifyQuoteToken(token)).toThrow();
  });
});
