/**
 * Sentry helpers for the API and worker processes.
 *
 * Initialisation lives in `./instrument.ts`, which MUST be imported as
 * the first import of every entrypoint (see that file for the ESM
 * ordering rationale). This module only exposes:
 *   - the helpers that wrap Sentry SDK calls so callers do not branch
 *     on initialisation state;
 *   - `getSentryStatus()` for `/health/integrations` and the standalone
 *     `/health/sentry` debug endpoint.
 */

import * as Sentry from '@sentry/node';
import type { Express } from 'express';

import { getOperatingTenantConfig, readOperatingTenantFromError } from '../tenant/tenantAls.js';

export type SentryStatus = {
  initialized: boolean;
  reason?: 'no_dsn';
  environment: string;
  release?: string;
  serviceRole: string;
  dsnHost: string | null;
};

let status: SentryStatus = {
  initialized: false,
  reason: 'no_dsn',
  environment: process.env.NODE_ENV || 'development',
  serviceRole: process.env.SERVICE_ROLE || 'abbeygate-api',
  dsnHost: null,
};

export function recordSentryInit(next: SentryStatus): void {
  status = next;
}

export function getSentryStatus(): SentryStatus {
  return status;
}

export function setupSentryExpressErrorHandler(app: Express): void {
  if (!status.initialized) return;
  Sentry.setupExpressErrorHandler(app);
}

export function captureSentryException(error: unknown): void {
  if (!status.initialized) return;
  Sentry.captureException(error);
}

// ---------------------------------------------------------------------------
// Background-error capture (BullMQ workers, Redis client, etc.)
// ---------------------------------------------------------------------------
//
// Background error sources fire outside the express error middleware, so
// `setupSentryExpressErrorHandler` can't see them. The 2026-05-16 production
// investigation found PDF worker EPIPE storms producing ~40 errors / 4h /
// pod, none of which reached Sentry — every BullMQ `on('error')` /
// `on('failed')` handler was logging via Pino and silently dropping the
// exception.
//
// We can't just call `captureSentryException` from those handlers — a Redis
// EPIPE storm would burn through the project's event quota in minutes.
// Instead, this helper rate-limits per fingerprint (`{ tag, error.message }`)
// and folds the dropped count into the next Sentry event so the rate is
// visible. The fingerprint tag is also surfaced as a Sentry tag so the
// `tag:redis.connection_error` filter works in the UI.
//
// Window default is 60s — fine-grained enough to surface a new EPIPE within
// a minute but coarse enough that a sustained storm sends one event per
// minute, not one per packet.

export type BackgroundErrorOptions = {
  /**
   * Stable identifier for the call site (e.g. `pdf_worker.error`,
   * `queue.notifications.failed`, `redis.connection_error`). Used both for
   * rate-limit fingerprinting and as a Sentry tag.
   */
  tag: string;
  /**
   * Minimum gap between captures for the same fingerprint. Defaults to 60s.
   * The dropped count is attached as `extra.droppedSinceLastSend`.
   */
  windowMs?: number;
  /**
   * Extra context attached to the Sentry event. Avoid PII; this lands in
   * `extra`.
   */
  extra?: Record<string, unknown>;
};

type WindowState = { lastSendMs: number; dropped: number };
const captureWindows = new Map<string, WindowState>();

function fingerprintOf(tag: string, error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return `${tag}::${msg.slice(0, 200)}`;
}

function nowMs(): number {
  return Date.now();
}

export function captureBackgroundException(
  error: unknown,
  options: BackgroundErrorOptions,
): void {
  if (!status.initialized) return;
  const { tag, windowMs = 60_000, extra } = options;
  const fingerprint = fingerprintOf(tag, error);
  const now = nowMs();
  const state = captureWindows.get(fingerprint);

  if (state && now - state.lastSendMs < windowMs) {
    state.dropped += 1;
    captureWindows.set(fingerprint, state);
    return;
  }

  const dropped = state ? state.dropped : 0;
  captureWindows.set(fingerprint, { lastSendMs: now, dropped: 0 });

  Sentry.withScope((scope) => {
    scope.setTag('background.tag', tag);
    // Attribute the error to its operating tenant so the shared backend
    // project can be filtered/alerted per territory. The ALS scope is gone by
    // the time a BullMQ `on('failed')` listener runs, so fall back to the
    // tenant stamped onto the error while it unwound through
    // `runWithOperatingTenant`.
    const alsTenant = getOperatingTenantConfig();
    const tenant = alsTenant
      ? { slug: alsTenant.tenantSlug, countryCode: alsTenant.countryCode }
      : readOperatingTenantFromError(error);
    if (tenant) {
      scope.setTag('tenant', tenant.slug);
      scope.setTag('tenant.country', tenant.countryCode);
    }
    if (dropped > 0) {
      scope.setExtra('droppedSinceLastSend', dropped);
      scope.setExtra('rateLimitWindowMs', windowMs);
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        scope.setExtra(k, v);
      }
    }
    Sentry.captureException(error);
  });
}

/**
 * Test-only: reset the rate-limit map so unit tests are deterministic.
 */
export function __resetBackgroundCaptureWindowsForTests(): void {
  captureWindows.clear();
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!status.initialized) return;
  await Sentry.close(timeoutMs);
}
