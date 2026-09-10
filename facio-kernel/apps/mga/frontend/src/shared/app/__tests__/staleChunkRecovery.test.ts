/* @vitest-environment happy-dom */
/**
 * Regression suite for ABY-240 — SPA stale-chunk recovery.
 *
 * Locks two contracts:
 *   1. The `isStaleChunkError` predicate must match every
 *      cross-browser variant of "dynamic import failed" we
 *      have observed in Sentry. New variants get added here as
 *      we see them.
 *   2. `attemptStaleChunkRecovery` is ONE-SHOT — within the
 *      dedupe window it must NOT trigger a second reload, so a
 *      permanently broken chunk (404 on the new build too)
 *      can't trap the user in an infinite reload loop.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  attemptStaleChunkRecovery,
  canAttemptStaleChunkRecovery,
  collectStaleChunkSentryCandidates,
  isLazyDefaultUndefined,
  isStaleChunkError,
  shouldSuppressAnyStaleChunkSentryReport,
  shouldSuppressStaleChunkSentryReport,
} from '../staleChunkRecovery';

/**
 * Build an `Error` with a synthetic stack that mimics what Sentry captured
 * for `ABBEYGATE-REACT-5`. React's lazy initializer lives in the
 * `react-vendor-*.js` chunk; the throw originates there and the inner stack
 * has no first-party application frames before bubbling to the
 * `SessionAwareErrorBoundary`. We reproduce that signature so the predicate
 * can detect it without depending on the host environment's stack format.
 */
function makeReactVendorLazyError(message: string): Error {
  const err = new TypeError(message);
  err.stack = [
    `TypeError: ${message}`,
    '    at j (https://abbeygate-cy.facio.io/assets/react-vendor-DkvYbNWg.js:17:3769)',
    '    at za (https://abbeygate-cy.facio.io/assets/react-vendor-DkvYbNWg.js:61:37338)',
    '    at MessagePort.le (https://abbeygate-cy.facio.io/assets/react-vendor-DkvYbNWg.js:46:1602)',
  ].join('\n');
  return err;
}

describe('isStaleChunkError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://example.com/assets/DashboardPage-qnrfdBee.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'ChunkLoadError: Loading chunk 42 failed.',
    'Loading chunk 7 failed.',
    'Loading CSS chunk 12 failed.',
    // ABBEYGATE-REACT-3 — iOS Safari 18.7 strict ESM MIME check
    // (the legacy SPA fallback served `index.html` for a missing
    // /assets/*.js, the browser refused to evaluate HTML as a JS
    // module). The exact message varies by browser; pin all three.
    "TypeError: 'text/html' is not a valid JavaScript MIME type.",
    "MIME type ('text/html') is not a valid JavaScript MIME type for module script.",
    "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\".",
    // ABBEYGATE-REACT-4 — Vite's own preload-error path on a stale
    // CSS sibling chunk. Reproduces on every product wizard the
    // moment a deploy lands while a tab is still open.
    'Unable to preload CSS for /assets/QuotePage-BqWAYDyR.css',
    'Error: Unable to preload CSS for /assets/index-Cl3Aw_xX.css',
  ])('matches the production error message %#: "%s"', (message) => {
    expect(isStaleChunkError(new Error(message))).toBe(true);
  });

  it('accepts plain strings as the rejection reason', () => {
    expect(isStaleChunkError('Failed to fetch dynamically imported module: ...')).toBe(true);
  });

  it('returns false for nullish / unrelated errors', () => {
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
    expect(isStaleChunkError(new Error('Something else broke'))).toBe(false);
    expect(isStaleChunkError(new TypeError('Cannot read properties of undefined'))).toBe(false);
  });

  it('extracts message from plain objects with a `message` field', () => {
    expect(isStaleChunkError({ message: 'Failed to fetch dynamically imported module: x' })).toBe(true);
    expect(isStaleChunkError({ message: 'unrelated' })).toBe(false);
  });
});

describe('isLazyDefaultUndefined (REACT-5 — stack-aware lazy default match)', () => {
  it.each([
    "Cannot read properties of undefined (reading 'default')",
    'Cannot read property \'default\' of undefined',
    "undefined is not an object (evaluating 'r.default')",
    "undefined is not an object (evaluating 'mod.default')",
    '(intermediate value).default is undefined',
  ])('matches "%s" when the stack contains a react-vendor frame', (message) => {
    expect(isLazyDefaultUndefined(makeReactVendorLazyError(message))).toBe(true);
  });

  it('does NOT match the bare TypeError text without a react-vendor stack frame', () => {
    // Anchor invariant — same assertion as the line that previously stood
    // alone in `isStaleChunkError`'s negative cases. Real application bugs
    // throwing this exact message must still flow to the React error boundary,
    // not auto-reload the page.
    const err = new TypeError("Cannot read properties of undefined (reading 'default')");
    err.stack = [
      "TypeError: Cannot read properties of undefined (reading 'default')",
      '    at appCode (https://example.com/assets/index-DXCKdc_B.js:2:165498)',
    ].join('\n');
    expect(isLazyDefaultUndefined(err)).toBe(false);
  });

  it('does NOT match unrelated TypeErrors even with a react-vendor frame', () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'pleaseFix')");
    err.stack = [
      "TypeError: Cannot read properties of undefined (reading 'pleaseFix')",
      '    at z (https://example.com/assets/react-vendor-DkvYbNWg.js:1:1)',
    ].join('\n');
    expect(isLazyDefaultUndefined(err)).toBe(false);
  });

  it('returns false when message matches but stack is empty (insufficient evidence)', () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'default')");
    err.stack = '';
    expect(isLazyDefaultUndefined(err)).toBe(false);
  });

  it('returns false for nullish reasons', () => {
    expect(isLazyDefaultUndefined(null)).toBe(false);
    expect(isLazyDefaultUndefined(undefined)).toBe(false);
  });
});

describe('attemptStaleChunkRecovery', () => {
  function makeStorage(): Pick<Storage, 'getItem' | 'setItem'> & { state: Record<string, string> } {
    const state: Record<string, string> = {};
    return {
      state,
      getItem: (key: string) => state[key] ?? null,
      setItem: (key: string, value: string) => { state[key] = value; },
    };
  }

  it('returns false (no reload) for non-chunk errors', () => {
    const reload = vi.fn();
    const result = attemptStaleChunkRecovery(new Error('not a chunk error'), {
      storage: makeStorage(),
      reload,
      now: () => 1000,
    });
    expect(result).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('triggers a reload the first time a chunk error is observed', () => {
    const storage = makeStorage();
    const reload = vi.fn();
    const result = attemptStaleChunkRecovery(
      new Error('Failed to fetch dynamically imported module: ...'),
      { storage, reload, now: () => 5000 },
    );
    expect(result).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.state).toEqual(expect.objectContaining({
      'facio.staleChunkRetriedAt': '5000',
    }));
  });

  it('refuses a second reload within the dedupe window (no infinite loop)', () => {
    const storage = makeStorage();
    const reload = vi.fn();

    // First failure: 5000ms → reloads.
    attemptStaleChunkRecovery(
      new Error('Failed to fetch dynamically imported module: ...'),
      { storage, reload, now: () => 5000 },
    );

    // Second failure 30 seconds later → must NOT reload again.
    const second = attemptStaleChunkRecovery(
      new Error('Failed to fetch dynamically imported module: ...'),
      { storage, reload, now: () => 35_000 },
    );

    expect(second).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh reload after the dedupe window has expired', () => {
    const storage = makeStorage();
    const reload = vi.fn();

    attemptStaleChunkRecovery(
      new Error('Failed to fetch dynamically imported module: ...'),
      { storage, reload, now: () => 0 },
    );

    // 11 minutes later (window is 10) → new failure is allowed to reload.
    const second = attemptStaleChunkRecovery(
      new Error('Failed to fetch dynamically imported module: ...'),
      { storage, reload, now: () => 11 * 60 * 1000 },
    );

    expect(second).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('triggers a reload for the REACT-5 lazy-default-undefined variant', () => {
    const storage = makeStorage();
    const reload = vi.fn();
    const result = attemptStaleChunkRecovery(
      makeReactVendorLazyError("Cannot read properties of undefined (reading 'default')"),
      { storage, reload, now: () => 7000 },
    );
    expect(result).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does NOT trigger a reload for a bare default-undefined TypeError without a react-vendor frame', () => {
    // Locks in the anti-false-positive contract from `isLazyDefaultUndefined`:
    // generic application bugs that share the message text must NOT recover.
    const reload = vi.fn();
    const result = attemptStaleChunkRecovery(
      new TypeError("Cannot read properties of undefined (reading 'default')"),
      { storage: makeStorage(), reload, now: () => 9000 },
    );
    expect(result).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('canAttemptStaleChunkRecovery', () => {
  function makeStorage(): Pick<Storage, 'getItem' | 'setItem'> & { state: Record<string, string> } {
    const state: Record<string, string> = {};
    return {
      state,
      getItem: (key: string) => state[key] ?? null,
      setItem: (key: string, value: string) => { state[key] = value; },
    };
  }

  it('returns true when no prior retry is recorded', () => {
    expect(canAttemptStaleChunkRecovery({ storage: makeStorage(), now: () => 1000 })).toBe(true);
  });

  it('returns false within the dedupe window after a prior retry', () => {
    const storage = makeStorage();
    storage.setItem('facio.staleChunkRetriedAt', '5000');
    expect(canAttemptStaleChunkRecovery({ storage, now: () => 35_000 })).toBe(false);
  });

  it('returns true after the dedupe window expires', () => {
    const storage = makeStorage();
    storage.setItem('facio.staleChunkRetriedAt', '1000');
    expect(canAttemptStaleChunkRecovery({ storage, now: () => 11 * 60 * 1000 + 1000 })).toBe(true);
  });
});

describe('shouldSuppressStaleChunkSentryReport (ABY-478 / ABY-512)', () => {
  function makeStorage(): Pick<Storage, 'getItem' | 'setItem'> & { state: Record<string, string> } {
    const state: Record<string, string> = {};
    return {
      state,
      getItem: (key: string) => state[key] ?? null,
      setItem: (key: string, value: string) => { state[key] = value; },
    };
  }

  it('suppresses the PT QuotePage stale-chunk error before the one-shot reload', () => {
    const storage = makeStorage();
    const error = new TypeError(
      'Failed to fetch dynamically imported module: https://pt.abbeygate.com/assets/QuotePage-Bb5iYnVA.js',
    );
    expect(shouldSuppressStaleChunkSentryReport(error, { storage, now: () => 1000 })).toBe(true);
  });

  it('suppresses after recovery already set the retry flag (Sentry race, ABY-512)', () => {
    const storage = makeStorage();
    const reload = vi.fn();
    const error = new TypeError(
      'Failed to fetch dynamically imported module: https://pt.abbeygate.com/assets/QuotePage-Bb5iYnVA.js',
    );

    attemptStaleChunkRecovery(error, { storage, reload, now: () => 5000 });

    expect(shouldSuppressStaleChunkSentryReport(error, { storage, now: () => 5100 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not suppress a second failure solely because the reload guard persisted', () => {
    const storage = makeStorage();
    const error = new TypeError(
      'Failed to fetch dynamically imported module: https://pt.abbeygate.com/assets/QuotePage-Bb5iYnVA.js',
    );

    // This is the storage state that survives into the freshly reloaded
    // document. The document-local Sentry race guard is intentionally absent.
    storage.setItem('facio.staleChunkRetriedAt', '1000000');
    expect(shouldSuppressStaleChunkSentryReport(error, { storage, now: () => 1000100 })).toBe(false);
  });

  it('does not suppress a persistent failure once the race window has elapsed', () => {
    const storage = makeStorage();
    const reload = vi.fn();
    const error = new TypeError(
      'Failed to fetch dynamically imported module: https://pt.abbeygate.com/assets/QuotePage-Bb5iYnVA.js',
    );

    attemptStaleChunkRecovery(error, { storage, reload, now: () => 5000 });

    expect(shouldSuppressStaleChunkSentryReport(error, { storage, now: () => 7000 })).toBe(false);
  });

  it('does not suppress unrelated errors', () => {
    expect(shouldSuppressStaleChunkSentryReport(new Error('network down'))).toBe(false);
  });

  it('does not suppress after the one-shot reload window is exhausted', () => {
    const storage = makeStorage();
    storage.setItem('facio.staleChunkRetriedAt', '5000');
    const error = new TypeError(
      'Failed to fetch dynamically imported module: https://pt.abbeygate.com/assets/QuotePage-Bb5iYnVA.js',
    );
    expect(shouldSuppressStaleChunkSentryReport(error, { storage, now: () => 35_000 })).toBe(false);
  });
});

describe('collectStaleChunkSentryCandidates / shouldSuppressAnyStaleChunkSentryReport', () => {
  function makeStorage(): Pick<Storage, 'getItem' | 'setItem'> & { state: Record<string, string> } {
    const state: Record<string, string> = {};
    return {
      state,
      getItem: (key: string) => state[key] ?? null,
      setItem: (key: string, value: string) => { state[key] = value; },
    };
  }

  it('suppresses when only the Sentry event message is available', () => {
    const storage = makeStorage();
    const candidates = collectStaleChunkSentryCandidates(
      undefined,
      'TypeError: Failed to fetch dynamically imported module: https://pt.abbeygate.com/assets/QuotePage-Bb5iYnVA.js',
      null,
    );
    expect(shouldSuppressAnyStaleChunkSentryReport(candidates, { storage, now: () => 1000 })).toBe(true);
  });

  it('suppresses when only exception.values is available', () => {
    const storage = makeStorage();
    const candidates = collectStaleChunkSentryCandidates(undefined, null, [
      {
        type: 'TypeError',
        value: 'Failed to fetch dynamically imported module: https://pt.abbeygate.com/assets/QuotePage-Bb5iYnVA.js',
      },
    ]);
    expect(shouldSuppressAnyStaleChunkSentryReport(candidates, { storage, now: () => 1000 })).toBe(true);
  });
});
