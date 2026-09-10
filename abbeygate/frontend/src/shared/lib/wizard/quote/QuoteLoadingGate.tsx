import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QuoteLoading, type QuoteLoadingVariant } from '../components/QuoteLoading';

/**
 * Canonical minimum quote-loader visible time, in milliseconds.
 * Per docs/architecture/contracts/canonical-ownership.md, the rating UX
 * minimum-delay is owned by `QuoteLoadingGate`; products import this
 * constant rather than defining a local copy.
 */
export const QUOTE_LOADER_MIN_DELAY_MS = 3000;

export interface QuoteLoadingGateProps {
  /** Stable identifier for the current quote (e.g. quote reference). When it changes, the gate restarts. */
  triggerKey: string;
  /** Whether the underlying quote payload is in the right state to reveal `children`. */
  ready: boolean;
  /** Extra readiness booleans that must all be `true` before reveal (e.g. recommendations loaded). */
  extraReadinessSignals?: boolean[];
  /** Minimum time the loader must be visible. Defaults to 3000ms. */
  minDelayMs?: number;
  /** Loader headline. */
  title?: string;
  /** Optional loader sub-headline. */
  subtitle?: string;
  /** Loader artwork variant (icon + motion). Forwarded to `QuoteLoading`. */
  variant?: QuoteLoadingVariant;
  /** Content shown once the gate opens. */
  children: ReactNode;
}

/**
 * Quote loading gate — enforces a minimum loader visible time so quotes never
 * flash too quickly. Holds back `children` until both:
 *   1. all `extraReadinessSignals` are true AND `ready === true`, and
 *   2. at least `minDelayMs` has elapsed since `triggerKey` last changed.
 *
 * Restarts the timer on every `triggerKey` change so callers don't accidentally
 * reuse a stale "min-delay done" flag across quote re-rates.
 *
 * Pass `minDelayMs={0}` to bypass the timer entirely — useful for products
 * (like Home) whose rating loader is already shown upstream in `onNext`, so
 * there's no need for a second 3s wait on the quote step.
 */
export function QuoteLoadingGate({
  triggerKey,
  ready,
  extraReadinessSignals = [],
  minDelayMs = QUOTE_LOADER_MIN_DELAY_MS,
  title,
  subtitle,
  variant,
  children,
}: QuoteLoadingGateProps) {
  // Initialize as `true` when no min-delay is requested so the very first
  // render reveals immediately (no loader flash) when `ready` is already true.
  const [minDelayDone, setMinDelayDone] = useState(() => minDelayMs <= 0);
  const triggerRef = useRef<string>('');

  useEffect(() => {
    if (triggerRef.current === triggerKey) return;
    triggerRef.current = triggerKey;
    if (!triggerKey || minDelayMs <= 0) {
      setMinDelayDone(true);
      return;
    }
    setMinDelayDone(false);
    const handle = window.setTimeout(() => setMinDelayDone(true), minDelayMs);
    return () => window.clearTimeout(handle);
  }, [minDelayMs, triggerKey]);

  const allExtraReady = extraReadinessSignals.every(Boolean);
  const reveal = ready && allExtraReady && minDelayDone;

  if (!reveal) {
    return (
      <div className="max-w-5xl mx-auto px-5 py-2 md:py-12 relative z-10">
        <QuoteLoading title={title} subtitle={subtitle} variant={variant} />
      </div>
    );
  }
  return <>{children}</>;
}
