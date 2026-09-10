/**
 * Filters benign Android in-app browser (Facebook / Instagram WebView)
 * native-bridge failures from Sentry. Their injected
 * `navigation_performance_logger_android` script calls `postMessage` on a
 * Java object that has already been garbage-collected during navigation or
 * WebView teardown. Abbeygate does not use `postMessage` or any Android
 * bridge — this is third-party host-browser noise (ABY-491).
 */

type SentryFrame = {
  filename?: string | null;
};

type SentryEventLike = {
  message?: string | null;
  exception?: {
    values?: Array<{
      value?: string | null;
      stacktrace?: { frames?: SentryFrame[] | null } | null;
    } | null> | null;
  } | null;
};

const JAVA_OBJECT_GONE_MESSAGE_RE = /^Error invoking \S+: Java object is gone$/;
const NAV_PERF_LOGGER_FRAME_RE = /navigation_performance_logger_android/;
const FIRST_PARTY_FRAME_RE = /abbeygate\.com|\/assets\/|\/src\//;

export function isAndroidWebViewBridgeJavaObjectGoneMessage(message: string): boolean {
  return JAVA_OBJECT_GONE_MESSAGE_RE.test(message.trim());
}

function frameFilename(frame: SentryFrame | null | undefined): string {
  const filename = frame?.filename;
  return typeof filename === 'string' ? filename.trim() : '';
}

function framesFromEvent(event?: SentryEventLike): SentryFrame[] {
  const values = event?.exception?.values;
  if (!Array.isArray(values)) return [];

  const frames: SentryFrame[] = [];
  for (const entry of values) {
    const stackFrames = entry?.stacktrace?.frames;
    if (!Array.isArray(stackFrames)) continue;
    frames.push(...stackFrames);
  }
  return frames;
}

function framesFromError(reason: unknown): SentryFrame[] {
  if (!(reason instanceof Error)) return [];
  const stack = typeof reason.stack === 'string' ? reason.stack : '';
  if (!stack) return [];

  return stack
    .split('\n')
    .slice(1)
    .map((line) => {
      const match = line.match(/(?:at\s+.*\()?(.+?):\d+:\d+\)?$/);
      return { filename: match?.[1]?.trim() ?? line.trim() };
    });
}

function collectFrames(reason: unknown, event?: SentryEventLike): SentryFrame[] {
  const eventFrames = framesFromEvent(event);
  if (eventFrames.length > 0) return eventFrames;
  return framesFromError(reason);
}

function hasNavigationPerformanceLoggerFrame(frames: SentryFrame[]): boolean {
  return frames.some((frame) => NAV_PERF_LOGGER_FRAME_RE.test(frameFilename(frame)));
}

function hasFirstPartyFrame(frames: SentryFrame[]): boolean {
  return frames.some((frame) => FIRST_PARTY_FRAME_RE.test(frameFilename(frame)));
}

function isFramelessCapture(frames: SentryFrame[]): boolean {
  if (frames.length === 0) return true;
  return frames.every((frame) => {
    const filename = frameFilename(frame);
    return !filename || filename === 'undefined' || filename === '?';
  });
}

function messageFromReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  return '';
}

function messageFromEvent(event?: SentryEventLike): string {
  const values = event?.exception?.values;
  if (Array.isArray(values)) {
    for (const entry of values) {
      const value = entry?.value;
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return typeof event?.message === 'string' ? event.message : '';
}

/**
 * True when Sentry captured Facebook / Instagram Android WebView bridge
 * noise and the event must NOT be reported.
 */
export function shouldSuppressAndroidWebViewBridgeSentryReport(
  reason: unknown,
  event?: SentryEventLike,
): boolean {
  const message = messageFromReason(reason) || messageFromEvent(event);
  if (!isAndroidWebViewBridgeJavaObjectGoneMessage(message)) return false;

  const frames = collectFrames(reason, event);
  // Sentry's global handler can append its own bundled capture frame to a
  // third-party Android bridge exception.  The injected origin remains the
  // authority for this specific browser-owned error.
  if (hasNavigationPerformanceLoggerFrame(frames)) return true;
  if (hasFirstPartyFrame(frames)) return false;

  // Frameless captures still carry the canonical WebView bridge message.
  return isFramelessCapture(frames);
}
