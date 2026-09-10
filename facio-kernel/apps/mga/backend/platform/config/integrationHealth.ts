/**
 * Integration health — single source of truth for whether configured-by-env
 * provider integrations (CardCorp, Creditsafe, …) are actually configured.
 *
 * Used by:
 *   - validateStartupConfig() to log loud warnings when a production-relevant
 *     integration is silently unconfigured (so a missing K8s secret key shows
 *     up at deploy time, not at first checkout).
 *   - GET /health/integrations to report integration status to deploy smoke
 *     checks, ops dashboards, and runbooks. Returns 503 in production when a
 *     required integration is missing.
 *
 * Adding a new integration: append a row to `INTEGRATIONS` and define how to
 * detect "configured". Do not duplicate this logic anywhere else.
 */

export type IntegrationStatus = {
  /** Integration identifier used in logs and the /health/integrations payload. */
  id: string;
  /** Display name for human-readable logs. */
  name: string;
  /**
   * True when the integration is fully configured (all required env vars
   * non-empty). False when *any* required value is missing.
   */
  configured: boolean;
  /**
   * True when the platform considers this integration mandatory for the
   * current runtime. We treat CardCorp and Creditsafe as required in
   * production because every product flow ultimately depends on them; in
   * non-production they are advisory only.
   */
  required: boolean;
  /** Names of env vars that drive `configured`, for diagnostics. */
  envVars: string[];
};

function envHas(name: string): boolean {
  return String(process.env[name] || '').trim().length > 0;
}

function isProd(): boolean {
  return (process.env.NODE_ENV || 'development') === 'production';
}

function isCreditsafeEnabled(): boolean {
  const raw = String(process.env.CREDITSAFE_ENABLED || '').trim().toLowerCase();
  if (!raw) return false;
  return !['0', 'false', 'no', 'off', 'disabled'].includes(raw);
}

// ADR-0049 — CardCorp is provisioned per country: a shared bearer token plus a
// per-country entity id + webhook secret. "Configured" means the bearer is set
// AND at least one country has both its entity id and webhook secret. Kept as a
// local env read (this platform module must not import the payments module).
const CARDCORP_COUNTRIES = ['CY', 'PT', 'GR', 'ES'] as const;
function isCardcorpConfigured(): boolean {
  if (!envHas('CARDCORP_BEARER_TOKEN')) return false;
  return CARDCORP_COUNTRIES.some(
    (cc) => envHas(`CARDCORP_ENTITY_ID_${cc}`) && envHas(`CARDCORP_WEBHOOK_SECRET_${cc}`),
  );
}

const INTEGRATIONS: ReadonlyArray<{
  id: string;
  name: string;
  envVars: string[];
  /** Returns true when the integration is required in the current runtime. */
  isRequired: () => boolean;
  /** Optional override of the default "all envVars present" configured check. */
  isConfigured?: () => boolean;
}> = [
  {
    id: 'cardcorp',
    name: 'CardCorp',
    envVars: ['CARDCORP_BEARER_TOKEN', 'CARDCORP_ENTITY_ID_CY', 'CARDCORP_WEBHOOK_SECRET_CY'],
    isRequired: () => isProd(),
    isConfigured: isCardcorpConfigured,
  },
  {
    id: 'creditsafe',
    name: 'Creditsafe',
    envVars: ['CREDITSAFE_BASE_URL', 'CREDITSAFE_USERNAME', 'CREDITSAFE_PASSWORD'],
    isRequired: () => isProd() && isCreditsafeEnabled(),
  },
  {
    // The pod's `instrument.ts` already throws in production when
    // SENTRY_DSN is missing, so a degraded state here in production
    // means SENTRY_DSN was somehow set to whitespace at boot but
    // re-blanked in the live env (or this code was hot-reloaded). In
    // non-prod environments this row is the only loud signal that
    // Sentry is dark.
    id: 'sentry',
    name: 'Sentry',
    envVars: ['SENTRY_DSN'],
    isRequired: () => isProd(),
  },
  {
    // Outbound customer email (welcome-on-contract, policy documents,
    // endorsements). Previously invisible to /health/integrations, so the
    // ADR-0047 ENOENT that silently blocked all CY+PT emails did not surface
    // as a degraded integration. Required in production: every product flow
    // ends in a customer email.
    id: 'sendgrid',
    name: 'SendGrid (email)',
    // SENDGRID_API_KEY is the hard requirement for primary delivery; the
    // from-address always has a default + aliases (NOTIFICATIONS_EMAIL_FROM /
    // EMAIL_FROM_ADDRESS), so requiring it here would false-degrade prod.
    envVars: ['SENDGRID_API_KEY'],
    isRequired: () => isProd(),
  },
];

export function getIntegrationStatuses(): IntegrationStatus[] {
  return INTEGRATIONS.map((row) => ({
    id: row.id,
    name: row.name,
    configured: row.isConfigured ? row.isConfigured() : row.envVars.every(envHas),
    required: row.isRequired(),
    envVars: [...row.envVars],
  }));
}

export type IntegrationHealthSummary = {
  status: 'ok' | 'degraded';
  integrations: IntegrationStatus[];
};

export function summarizeIntegrationHealth(): IntegrationHealthSummary {
  const integrations = getIntegrationStatuses();
  const degraded = integrations.some((i) => i.required && !i.configured);
  return {
    status: degraded ? 'degraded' : 'ok',
    integrations,
  };
}
