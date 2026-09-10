// Stale-chunk recovery for SPA deploys (ABY-240).
//
// Why this exists
//
// When `main` is deployed, Vite emits new content-hashed chunk
// filenames (e.g. `DashboardPage-qnrfdBee.js`). Tabs that were
// open with the previous build keep their already-loaded
// `index.html` in memory. The next time those tabs lazy-import
// a route (`React.lazy(() => import('./DashboardPage'))`) the
// browser fetches a chunk filename that no longer exists on the
// CDN and throws:
//
//   TypeError: Failed to fetch dynamically imported module:
//     https://.../assets/DashboardPage-qnrfdBee.js
//
// The user sees a white screen (the lazy-loaded route never
// renders, the surrounding shell already unmounted). That is
// the cause of ABY-240 — Sentry captured the exact error at the
// moment the marker.io was filed, tagged with the release SHA
// of the commit that had just deployed.
//
// The fix is the standard SPA pattern: a one-shot reload that
// pulls down the fresh `index.html`, which then references the
// new chunk filenames.
//
// Design constraints
//
// - One-shot only. If a reload doesn't fix it (chunk truly 404s
//   even after `index.html` refresh) we must NOT loop forever.
//   sessionStorage keyed by a short window guards this.
// - Detect across browsers + Vite's own `vite:preloadError`
//   event so we recover whether the failure surfaces as an
//   unhandled rejection, a React error-boundary catch, or
//   Vite's pre-throw hook.
// - Pure predicate (`isStaleChunkError`) so unit tests can
//   exercise every message variant without touching the DOM.

const RETRY_FLAG_KEY = 'facio.staleChunkRetriedAt';
/**
 * Short-lived guard so Sentry does not report the original chunk failure while
 * this document is already navigating to a fresh build. This must remain
 * document-local: a persistent failure after the reload is evidence, not
 * recoverable noise.
 */
let sentryRaceSuppressUntil = 0;
/**
 * Refuse a second auto-reload within this window so a permanently
 * broken chunk (404 on the new build too) can't trap the user in
 * a reload loop. After the window expires the recovery is allowed
 * to run again on the next chunk failure.
 */
const RETRY_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
/**
 * When our unhandledrejection handler runs before Sentry's `beforeSend`
 * check, it sets the retry flag first and suppression would otherwise
 * read "already retried" and let the event through (ABY-512). A brief
 * post-recovery suppress window covers that race without hiding a persistent
 * failure in the freshly reloaded document.
 */
const SENTRY_RACE_SUPPRESS_MS = 1000;

/**
 * Cross-browser message matchers for "dynamic import / chunk
 * failed to load". Add new variants as we observe them in Sentry.
 *
 * The list intentionally includes shapes that surface when the
 * stale chunk WAS served (with the wrong MIME) instead of 404'd —
 * Mobile Safari 18.7+ refuses any non-`application/javascript`
 * response for an ESM import and throws the literal MIME message;
 * Vite's `vite:preloadError` handler surfaces "Unable to preload
 * CSS" when a stale `<link rel="modulepreload">` for a sibling
 * stylesheet 404s. Both pre-fix surfaced as ABBEYGATE-REACT-3 and
 * ABBEYGATE-REACT-4 on the abbeygate-react Sentry project.
 */
const STALE_CHUNK_MESSAGE_PATTERNS: readonly RegExp[] = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /\bChunkLoadError\b/i,
  /Loading chunk\s+\S+\s+failed/i,
  /Loading CSS chunk\s+\S+\s+failed/i,
  // ABBEYGATE-REACT-3 — Safari/iOS strict ESM MIME check on a stale
  // chunk URL that gets served as `text/html` (legacy SPA fallback
  // before backend/index.ts started 404'ing missing /assets/* paths).
  /'text\/html' is not a valid JavaScript MIME type/i,
  // Same family, Firefox / Chromium phrasing variants observed in
  // the wild on stale-chunk deploys.
  /MIME type \('text\/html'\) is not a (?:valid|supported) JavaScript MIME type/i,
  /Failed to load module script/i,
  // ABBEYGATE-REACT-4 — Vite's runtime emits this when
  // `<link rel="modulepreload">` for a sibling .css asset 404s after
  // the index.html in the user's tab references a hash that's no
  // longer on disk. Same root cause as the JS chunk variants; same
  // recovery (one-shot reload pulls the new index.html + new hashes).
  /Unable to preload CSS for/i,
  /Unable to preload\b/i,
];

function extractErrorMessage(reason: unknown): string {
  if (!reason) return '';
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return reason.message || String(reason);
  if (typeof reason === 'object') {
    const candidate = reason as { message?: unknown; toString?: () => string };
    if (typeof candidate.message === 'string') return candidate.message;
    if (typeof candidate.toString === 'function') {
      try { return candidate.toString(); } catch { return ''; }
    }
  }
  return '';
}

/**
 * Pure predicate — true when `reason` looks like a dynamic-import
 * / chunk-load failure regardless of which browser threw it.
 *
 * Exported for unit tests; production callers should go through
 * `attemptStaleChunkRecovery` which also enforces the one-shot
 * reload guard.
 */
export function isStaleChunkError(reason: unknown): boolean {
  const message = extractErrorMessage(reason);
  if (!message) return false;
  return STALE_CHUNK_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Cross-browser message variants that surface when a dynamic-import
 * chunk loaded with HTTP 200 + correct MIME but the resolved module
 * object's `default` is `undefined`. React 19's `lazy` initializer
 * reads `moduleObject.default` and throws this exact shape when the
 * module record itself is `undefined` after a stale-chunk deploy.
 *
 * Caught in production as `ABBEYGATE-REACT-5` on the abbeygate-react
 * Sentry project — same root cause as the rest of the ABY-240 family
 * (a tab held open across a deploy boundary), but a different surface
 * shape because the chunk fetch SUCCEEDED before the export check
 * failed. Browsers phrase it differently:
 *
 *   - Chrome / Edge / Firefox 120+: `Cannot read properties of undefined (reading 'default')`
 *   - Older Firefox / SpiderMonkey: `(intermediate value).default is undefined`
 *   - Safari / Webkit: `undefined is not an object (evaluating '*.default')`
 */
const LAZY_DEFAULT_UNDEFINED_MESSAGE_PATTERNS: readonly RegExp[] = [
  // Modern V8 (Chrome 76+, Node 16+, Firefox 120+): the property name appears
  // inside `(reading '<name>')` after the message body.
  /Cannot read propert(?:y|ies) of undefined \(reading ['"]default['"]\)/i,
  // Pre-2019 V8 phrasing (still emitted by some embedded engines and surfaced
  // verbatim through Sentry's stack symbolication): the property name appears
  // before "of undefined".
  /Cannot read property ['"]default['"] of undefined/i,
  // Firefox / SpiderMonkey "(intermediate value).default is undefined".
  /\bdefault\b is undefined/i,
  // Safari / WebKit: `undefined is not an object (evaluating '<expr>.default')`.
  // The `default` is not itself quoted — the whole accessor expression is. We
  // therefore look for `.default` followed by an optional closing string quote
  // and the final `)` of `evaluating '...'`.
  /undefined is not an object \(evaluating [^)]*\.default['"]?\)/i,
];

/**
 * "React-vendor" chunk URL signature — Vite's `manualChunks` strategy in
 * `frontend/vite.config.ts` pins `react`, `react-dom` and `react-router-dom`
 * into the `react-vendor-*.js` chunk. React's `lazy` initializer lives in
 * that chunk, so a stack frame from there is the structural fingerprint of
 * "React itself read `.default` and got undefined" rather than a random
 * application bug that happens to share the message text.
 */
const REACT_VENDOR_FRAME_PATTERN = /\breact-vendor-[A-Za-z0-9_-]+\.js\b/i;

/**
 * Stack-aware predicate — true when the error is "React.lazy resolved a
 * chunk whose default export is missing". This is intentionally NARROWER
 * than message-only matching so we don't trap real application bugs that
 * happen to throw the bare `Cannot read properties of undefined` message.
 *
 * Two conditions must BOTH hold:
 *   1. The error message matches one of the cross-browser
 *      `LAZY_DEFAULT_UNDEFINED_MESSAGE_PATTERNS` shapes — we are reading
 *      a `default` property off `undefined`, not some arbitrary key.
 *   2. The error stack contains a frame from the `react-vendor-*.js`
 *      chunk — the throw originated inside React's `lazy` initializer,
 *      not inside first-party application code. (Application bugs that
 *      share the message text never have a `react-vendor` frame as the
 *      throwing location.)
 *
 * Exported for unit tests; production callers go through
 * `attemptStaleChunkRecovery` which composes this with the message-only
 * `isStaleChunkError` family.
 */
export function isLazyDefaultUndefined(reason: unknown): boolean {
  const message = extractErrorMessage(reason);
  if (!message) return false;
  if (!LAZY_DEFAULT_UNDEFINED_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return false;
  }
  const stack = extractErrorStack(reason);
  if (!stack) return false;
  return REACT_VENDOR_FRAME_PATTERN.test(stack);
}

function extractErrorStack(reason: unknown): string {
  if (!reason) return '';
  if (reason instanceof Error) return typeof reason.stack === 'string' ? reason.stack : '';
  if (typeof reason === 'object') {
    const candidate = reason as { stack?: unknown };
    if (typeof candidate.stack === 'string') return candidate.stack;
  }
  return '';
}

type RecoveryHooks = {
  /** Override for tests. Defaults to `window.sessionStorage`. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  /** Override for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Override for tests. Defaults to `window.location.reload`. */
  reload?: () => void;
};

/**
 * Pure predicate — true when the one-shot reload guard would allow
 * another automatic recovery attempt. Exported so Sentry's
 * `beforeSend` and the React 19 error handlers can suppress noise
 * from recoverable stale-chunk failures (ABY-478 / ADR-0075) without
 * mutating sessionStorage or triggering a reload.
 */
export function canAttemptStaleChunkRecovery(hooks: Pick<RecoveryHooks, 'storage' | 'now'> = {}): boolean {
  if (typeof window === 'undefined') return false;

  const storage = hooks.storage ?? safeSessionStorage();
  const now = hooks.now ?? Date.now;
  if (!storage) return false;

  try {
    const lastRetry = Number(storage.getItem(RETRY_FLAG_KEY) ?? '0');
    return !(lastRetry > 0 && now() - lastRetry < RETRY_DEDUPE_WINDOW_MS);
  } catch {
    return false;
  }
}

/**
 * Collect every string shape Sentry may hand to `beforeSend` for a stale-chunk
 * failure so suppression survives missing `hint.originalException`.
 */
export function collectStaleChunkSentryCandidates(
  original: unknown,
  eventMessage?: string | null,
  exceptionValues?: Array<{ type?: string; value?: string }> | null,
): unknown[] {
  const candidates: unknown[] = [];
  if (original != null) candidates.push(original);
  if (typeof eventMessage === 'string' && eventMessage.trim()) candidates.push(eventMessage);

  const first = exceptionValues?.[0];
  if (first?.value) {
    candidates.push(first.value);
    if (first.type) candidates.push(`${first.type}: ${first.value}`);
  }

  return candidates;
}

export function shouldSuppressAnyStaleChunkSentryReport(
  candidates: unknown[],
  hooks: Pick<RecoveryHooks, 'storage' | 'now'> = {},
): boolean {
  return candidates.some((candidate) => shouldSuppressStaleChunkSentryReport(candidate, hooks));
}

/**
 * True when a stale-chunk failure is about to be (or was just)
 * recovered automatically and must NOT be reported to Sentry.
 * Persistent failures after the one-shot window is exhausted are
 * intentionally NOT suppressed — those reach the error boundary and
 * `captureFrontendException`.
 */
export function shouldSuppressStaleChunkSentryReport(
  reason: unknown,
  hooks: Pick<RecoveryHooks, 'storage' | 'now'> = {},
): boolean {
  if (!isStaleChunkError(reason) && !isLazyDefaultUndefined(reason)) return false;

  if (canAttemptStaleChunkRecovery(hooks)) return true;

  if (typeof window === 'undefined') return false;

  const now = hooks.now ?? Date.now;
  return sentryRaceSuppressUntil > now();
}

/**
 * Attempt to recover from a stale-chunk failure. Returns `true`
 * when a reload was actually triggered (caller should `preventDefault`
 * on the originating event to suppress the default white-screen),
 * `false` when the error wasn't a chunk failure OR when we already
 * tried to reload within the dedupe window.
 */
export function attemptStaleChunkRecovery(reason: unknown, hooks: RecoveryHooks = {}): boolean {
  if (!isStaleChunkError(reason) && !isLazyDefaultUndefined(reason)) return false;
  if (typeof window === 'undefined') return false;

  const storage = hooks.storage ?? safeSessionStorage();
  const now = hooks.now ?? Date.now;
  const reload = hooks.reload ?? (() => window.location.reload());

  if (!storage) return false;

  try {
    if (!canAttemptStaleChunkRecovery({ storage, now })) {
      // We already tried to recover recently and the same chunk
      // failure is happening again — the new build must also be
      // missing the chunk (404). Bail so the error boundary can
      // surface a meaningful failure instead of an infinite
      // reload loop.
      return false;
    }
    const at = now();
    storage.setItem(RETRY_FLAG_KEY, String(at));
    sentryRaceSuppressUntil = at + SENTRY_RACE_SUPPRESS_MS;
    reload();
    return true;
  } catch {
    return false;
  }
}

function safeSessionStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Wire global handlers so any chunk-load failure auto-recovers
 * before the user sees a white screen. Idempotent — safe to call
 * multiple times during HMR / tests.
 */
export function installStaleChunkRecovery(): void {
  if (typeof window === 'undefined') return;
  const flagged = window as Window & { __facioStaleChunkInstalled?: boolean };
  if (flagged.__facioStaleChunkInstalled) return;
  flagged.__facioStaleChunkInstalled = true;

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    if (attemptStaleChunkRecovery(event.reason)) {
      event.preventDefault();
    }
  });

  window.addEventListener('error', (event: ErrorEvent) => {
    if (attemptStaleChunkRecovery(event.error ?? event.message)) {
      event.preventDefault();
    }
  });

  // Vite ships its own `vite:preloadError` that fires BEFORE the
  // import() throws. Catch it too so we recover at the earliest
  // possible point.
  window.addEventListener('vite:preloadError', (event: Event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    if (attemptStaleChunkRecovery(payload)) {
      event.preventDefault();
    }
  });
}
