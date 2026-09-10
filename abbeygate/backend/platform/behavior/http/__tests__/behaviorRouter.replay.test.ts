/**
 * Regression test for `POST /behavior/replay` body validation.
 *
 * Before this fix, the route did:
 *
 *   const limitRaw = Number((req.body && (req.body as Record<string, unknown>).limit) || 100);
 *   const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : 100;
 *
 * This silently coerced any garbage (e.g. `{ limit: 'banana' }`, `null`,
 * unknown extra keys, or a non-object body) into the default 100, which
 * fails CHAMPS' `guard:http-input-validation` and lets malicious or buggy
 * callers pass through the boundary unchecked.
 *
 * The fix introduces `ReplayBodySchema` (Zod, `.strict()`) and rejects
 * malformed bodies with a `400 INVALID_BODY` before any DB / tenant work.
 *
 * These tests pin the schema's behaviour at unit speed (no DB, no tenant
 * context). Wire-format (status 400 + `code: 'INVALID_BODY'`) is asserted
 * via the explicit `safeParse` contract used by the route handler.
 */

import { describe, expect, it } from 'vitest';
import { ReplayBodySchema } from '../behaviorRouter.js';

describe('POST /behavior/replay — body validation (regression)', () => {
  it('accepts an empty body (limit is optional, defaults applied by handler)', () => {
    const r = ReplayBodySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBeUndefined();
  });

  it('accepts a valid integer limit in range', () => {
    const r = ReplayBodySchema.safeParse({ limit: 50 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it('coerces a numeric string ("42") to a number', () => {
    const r = ReplayBodySchema.safeParse({ limit: '42' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(42);
  });

  it('rejects a non-numeric string (would have been silently coerced to 100 before)', () => {
    const r = ReplayBodySchema.safeParse({ limit: 'banana' });
    expect(r.success).toBe(false);
  });

  it('rejects negative limits', () => {
    const r = ReplayBodySchema.safeParse({ limit: -5 });
    expect(r.success).toBe(false);
  });

  it('rejects zero (must be positive)', () => {
    const r = ReplayBodySchema.safeParse({ limit: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects non-integer limits (must be int)', () => {
    const r = ReplayBodySchema.safeParse({ limit: 3.14 });
    expect(r.success).toBe(false);
  });

  it('rejects limits over the documented max (1000)', () => {
    const r = ReplayBodySchema.safeParse({ limit: 1001 });
    expect(r.success).toBe(false);
  });

  it('rejects unknown extra fields (.strict() — closes the surface)', () => {
    const r = ReplayBodySchema.safeParse({ limit: 50, evil: 'payload' });
    expect(r.success).toBe(false);
  });

  it('rejects a null body', () => {
    const r = ReplayBodySchema.safeParse(null);
    expect(r.success).toBe(false);
  });

  it('rejects an array body', () => {
    const r = ReplayBodySchema.safeParse([1, 2, 3]);
    expect(r.success).toBe(false);
  });
});
