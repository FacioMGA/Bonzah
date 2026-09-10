import * as Sentry from '@sentry/react';

import {
  collectStaleChunkSentryCandidates,
  installStaleChunkRecovery,
  shouldSuppressAnyStaleChunkSentryReport,
  shouldSuppressStaleChunkSentryReport,
} from '@/src/shared/app/staleChunkRecovery';
import { shouldSuppressAndroidWebViewBridgeSentryReport } from '@/src/shared/lib/observability/androidWebViewBridgeNoise';
import { logger } from '@/src/shared/lib/logger';
import { getOperatingCountryFromHost } from '@/src/shared/lib/tenant/operatingCountry';

const IS_PROD = import.meta.env.PROD;

type RateEnvName =
  | 'VITE_SENTRY_ERROR_SAMPLE_RATE'
  | 'VITE_SENTRY_TRACES_SAMPLE_RATE'
  | 'VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE'
  | 'VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE';

export type FrontendSentryStatus = {
  initialized: boolean;
  reason?: 'no_dsn';
  environment: string;
  release: string | null;
  dsnHost: string | null;
};

let status: FrontendSentryStatus = {
  initialized: false,
  reason: 'no_dsn',
  environment: import.meta.env.MODE || 'development',
  release: null,
  dsnHost: null,
};

declare global {
  interface Window {
    __SENTRY_BOOT__?: FrontendSentryStatus;
  }
}

function readRate(name: RateEnvName, rawValue: string | undefined, defaultValue: number): number {
  const raw = rawValue?.trim() ?? '';
  if (!raw) return defaultValue;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${name} must be a number between 0 and 1`);
  }

  return parsed;
}

function tracePropagationTargets(): Array<string | RegExp> {
  const apiUrl = import.meta.env.VITE_API_URL?.trim() ?? '';
  return [
    /^\/api/,
    'localhost',
    ...(apiUrl ? [apiUrl] : []),
  ];
}

function dsnHostFromUrl(dsn: string): string {
  try {
    return new URL(dsn).host;
  } catch {
    return 'invalid-dsn';
  }
}

/**
 * Operating-tenant Sentry tags derived from the browser host, mirroring the
 * backend `tenant` / `tenant.country` tags so both Sentry projects
 * (`abbeygate`, `abbeygate-react`) filter and alert per territory with the
 * same tag names.
 *
 * The country code is the only tenant signal a browser has (see
 * `operatingCountry.ts`, the read-only host→country helper). The slug follows
 * the fixed `abbeygate-<code>` convention canonically owned by the backend
 * host map (`resolveTenant.ts` / `TENANT_IDS_BY_SLUG`); we derive it here
 * purely as an observability label, never for authority or business logic.
 * Returns `{}` on non-tenant hosts (localhost, previews) so the tags stay off.
 *
 * @internal exported for unit tests only.
 */
export function operatingTenantTags(): Record<string, string> {
  const countryCode = getOperatingCountryFromHost();
  if (!countryCode) return {};
  return {
    tenant: `abbeygate-${countryCode.toLowerCase()}`,
    'tenant.country': countryCode,
  };
}

function publishStatus(next: FrontendSentryStatus): void {
  status = next;
  if (typeof window !== 'undefined') {
    window.__SENTRY_BOOT__ = next;
  }
}

export function getFrontendSentryStatus(): FrontendSentryStatus {
  return status;
}

export function initFrontendSentry(): void {
  if (status.initialized) return;

  // Install before Sentry.init so our unhandledrejection handler is
  // registered first and the retry flag is set before Sentry evaluates
  // beforeSend on the same event (ABY-512).
  installStaleChunkRecovery();

  const environment =
    import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() || import.meta.env.MODE || 'development';
  const release = import.meta.env.VITE_SENTRY_RELEASE?.trim() || null;
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim() ?? '';

  if (!dsn) {
    publishStatus({
      initialized: false,
      reason: 'no_dsn',
      environment,
      release,
      dsnHost: null,
    });
    if (IS_PROD) {
      // Loud signal in production. The build pipeline already refuses
      // to ship the API/frontend image without VITE_SENTRY_DSN
      // (.github/workflows/azure-images.yml), so reaching this branch
      // means a non-pipeline build was deployed. We do NOT throw —
      // crashing the SPA bundle for end users is worse than running
      // without Sentry — but we make the absence visible to anyone
      // opening DevTools and to any log shipper hooked into pino.
      logger.error(
        { event: 'sentry.disabled', reason: 'no_dsn', environment },
        '[sentry] VITE_SENTRY_DSN is not set in this build. Frontend errors are NOT being sent to Sentry. ' +
          'Rebuild via the GitHub Actions image workflow with the production-aks environment.',
      );
    } else {
      logger.info(
        { event: 'sentry.disabled', reason: 'no_dsn', environment },
        '[sentry] disabled (no VITE_SENTRY_DSN). Set it in .env to enable in dev.',
      );
    }
    return;
  }

  Sentry.init({
    dsn,
    environment,
    release: release ?? undefined,
    beforeSend(event, hint) {
      const original = hint?.originalException;
      const candidates = collectStaleChunkSentryCandidates(
        original,
        event.message,
        event.exception?.values,
      );
      if (shouldSuppressAnyStaleChunkSentryReport(candidates)) {
        return null;
      }
      if (shouldSuppressAndroidWebViewBridgeSentryReport(original ?? event.message ?? '', event)) {
        return null;
      }
      return event;
    },
    sampleRate: readRate('VITE_SENTRY_ERROR_SAMPLE_RATE', import.meta.env.VITE_SENTRY_ERROR_SAMPLE_RATE, 1),
    tracesSampleRate: readRate(
      'VITE_SENTRY_TRACES_SAMPLE_RATE',
      import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
      IS_PROD ? 0.1 : 1,
    ),
    tracePropagationTargets: tracePropagationTargets(),
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    replaysSessionSampleRate: readRate(
      'VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE',
      import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
      IS_PROD ? 0.01 : 0,
    ),
    replaysOnErrorSampleRate: readRate(
      'VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE',
      import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,
      1,
    ),
    sendDefaultPii: import.meta.env.VITE_SENTRY_SEND_DEFAULT_PII?.toLowerCase() === 'true',
    initialScope: {
      tags: operatingTenantTags(),
    },
  });

  const dsnHost = dsnHostFromUrl(dsn);
  publishStatus({
    initialized: true,
    environment,
    release,
    dsnHost,
  });
  logger.info(
    { event: 'sentry.initialized', environment, release, dsnHost },
    '[sentry] initialized',
  );
}

export function captureFrontendException(error: unknown, context?: Record<string, unknown>): void {
  if (!status.initialized) return;
  if (shouldSuppressStaleChunkSentryReport(error)) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

initFrontendSentry();
