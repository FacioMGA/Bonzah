/**
 * Sentry pre-instrumentation entrypoint.
 *
 * Why this file is separate from `sentry.ts`:
 * `@sentry/node` v10 must call `Sentry.init()` BEFORE any module that
 * Sentry auto-instruments (express, http, prisma, etc.) is imported,
 * otherwise the OpenTelemetry instrumentations cannot patch them and
 * traces / breadcrumbs go silently missing. ESM hoists every `import`
 * in a module to the top of that module before any non-import body
 * runs, so a `Sentry.init()` *call site* inside an exported function
 * cannot meet that ordering requirement — by the time the call runs,
 * express/prisma have already been evaluated.
 *
 * Solution: this file performs `Sentry.init()` at module top-level.
 * Every entrypoint (`backend/index.ts`, `backend/worker.ts`,
 * `apps/api/index.ts`, `apps/worker/index.ts`) imports this file as
 * the very first import, so the side effect runs before any other
 * dependency's module body executes.
 *
 * Fail-fast contract (chosen 2026-05-16):
 *   - In production (`NODE_ENV=production`), missing `SENTRY_DSN`
 *     throws at module load. The pod will fail its startup probe and
 *     Helm will roll back. This mirrors the CardCorp / Creditsafe
 *     posture and is the only way to keep "0 errors for days" from
 *     being indistinguishable between "Sentry off" and "everything is
 *     healthy".
 *   - In non-production, missing DSN logs a single line and continues.
 *
 * The actual init status is exported via `getSentryStatus()` from
 * `./sentry.ts` and surfaced through `/health/integrations` (canonical
 * via `integrationHealth.ts`) and the standalone `/health/sentry`
 * debug endpoint.
 */

import 'dotenv/config';
import { createRequire } from 'node:module';
import * as Sentry from '@sentry/node';

import { logger } from '../utils/logger.js';

import { recordSentryInit } from './sentry.js';

const IS_PROD = (process.env.NODE_ENV || 'development') === 'production';

function readRate(name: string, defaultValue: number): number {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return defaultValue;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${name} must be a number between 0 and 1`);
  }

  return parsed;
}

function dsnHostFromUrl(dsn: string): string {
  try {
    return new URL(dsn).host;
  } catch {
    return 'invalid-dsn';
  }
}

(function bootstrapSentry(): void {
  // Make sure SERVICE_ROLE has a value before Sentry reads it for the
  // initial scope tag. The entrypoints used to set this *after*
  // imports, which meant the tag was always the default.
  if (!process.env.SERVICE_ROLE) {
    process.env.SERVICE_ROLE = 'facio-platform-api';
  }

  const dsn = String(process.env.SENTRY_DSN || '').trim();
  const environment =
    process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';
  const release = process.env.SENTRY_RELEASE;
  const serviceRole = process.env.SERVICE_ROLE || 'facio-platform-api';

  if (!dsn) {
    const structuredPlatformLogs = process.env.KERNEL_PLATFORM_MODE === 'true' && process.env.KERNEL_OBSERVABILITY_MODE === 'structured_logs';
    if (IS_PROD && !structuredPlatformLogs) {
      // Fail-fast: the pod refuses to start. K8s will surface this as
      // CrashLoopBackOff and the AKS rollout will fail-loud instead of
      // serving traffic with no error visibility.
      throw new Error(
        '[sentry] SENTRY_DSN is required in production. Add it to the AKS runtime secret ' +
          '(Helm: runtimeConfig.secretKeys.SENTRY_DSN) and redeploy.',
      );
    }
    logger.info(
      { event: 'sentry.disabled', reason: structuredPlatformLogs ? 'configured_structured_logs' : 'no_dsn', environment },
      'sentry.disabled',
    );
    recordSentryInit({
      initialized: false,
      reason: 'no_dsn',
      environment,
      release,
      serviceRole,
      dsnHost: null,
    });
    return;
  }

  Sentry.init({
    dsn,
    environment,
    release,
    sampleRate: readRate('SENTRY_ERROR_SAMPLE_RATE', 1),
    tracesSampleRate: readRate('SENTRY_TRACES_SAMPLE_RATE', IS_PROD ? 0.1 : 1),
    sendDefaultPii:
      String(process.env.SENTRY_SEND_DEFAULT_PII || '').toLowerCase() === 'true',
    initialScope: {
      tags: { serviceRole },
    },
  });

  // Force-load express through OpenTelemetry's require-in-the-middle
  // hook NOW, while the hook is freshly registered by Sentry.init.
  // Without this, the application's later `import express from 'express'`
  // tends to bypass the hook in our ESM+CJS hybrid setup, leaving
  // `app.use` unwrapped — Sentry then logs
  //   [Sentry] express is not instrumented. Please make sure to
  //   initialize Sentry in a separate file that you `--import`...
  // at boot (and HTTP transactions never auto-create either).
  //
  // Loading express via createRequire() guarantees the CJS require
  // path (which the RITM hook patches) is exercised. Express enters
  // `require.cache` as the patched module. Subsequent ESM imports
  // resolve to the cached, patched instance.
  //
  // We deliberately do NOT touch the returned value; the cache write
  // is the only side effect we need. Errors are swallowed (e.g. if
  // express isn't installed in some runtime variant like worker.js)
  // — the worst case is we fall back to the pre-2026-05-17 state
  // where auto-instrumentation didn't fire but explicit
  // captureException still worked.
  try {
    const req = createRequire(import.meta.url);
    req('express');
  } catch {
    // express isn't a hard dependency of every entrypoint.
  }

  const dsnHost = dsnHostFromUrl(dsn);
  recordSentryInit({
    initialized: true,
    environment,
    release,
    serviceRole,
    dsnHost,
  });
  logger.info(
    {
      event: 'sentry.initialized',
      environment,
      release: release || null,
      serviceRole,
      dsnHost,
    },
    'sentry.initialized',
  );
})();
