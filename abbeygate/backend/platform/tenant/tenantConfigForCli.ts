/**
 * Tenant configuration bootstrap for **non-HTTP contexts only**.
 *
 * Production HTTP/worker code MUST resolve the operating tenant via the
 * `resolveOperatingTenant` middleware (HTTP) or one of the explicit
 * `runWith*OperatingTenant` helpers in `tenantJobContext.ts` (workers).
 * Outside those code paths there is no per-request tenant — and per
 * ADR-0019 we no longer fall back to an implicit env-driven singleton
 * inside `getTenantConfig()`.
 *
 * CLI scripts (`backend/seed.ts`, `backend/scripts/*.mts`), one-shot
 * migration scripts under `tools/migrations/`, and the
 * `enqueueSystemOutboxEvent` helper that fires before any HTTP request
 * exists call `buildTenantConfigFromEnv()` to materialise an explicit
 * `TenantConfig` from environment variables, then wrap their entrypoint
 * in `runWithOperatingTenant(...)` so downstream code sees a normal ALS
 * context.
 *
 * This file is the **only** allowed home for module-level reads of
 * `DEFAULT_REGION_CODE`, `TENANT_SLUG`, `DEFAULT_COUNTRY`, currency,
 * IPT, admin-fee, and brand-logo env vars. Other modules must read
 * tenant context from ALS via `getTenantConfig()`.
 */

import {
  type CountryCode,
  type TenantConfig,
  TENANT_IDS,
  TENANT_IDS_BY_SLUG,
} from './tenantConfig.js';

function envStr(key: string, fallback: string): string {
  const v = process.env[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function envNum(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const DEFAULTS_BY_COUNTRY: Record<
  CountryCode,
  Omit<TenantConfig, 'id' | 'tenantSlug' | 'publicBaseUrl' | 'fromEmail' | 'brandLogo' | 'defaultBrokerName'>
> = {
  CY: {
    countryCode: 'CY',
    country: 'Cyprus',
    currency: 'EUR',
    // Cyprus binders (Home + Travel) have no policy-level IPT — the
    // legacy Abbeygate schedules show `Local Taxes / Tax Fee: 0.00`.
    // Motor uses its own tax regime (MIF surcharge + stamp duty) and
    // does not read this field.
    ipt: { flatFee: 0 },
    adminFee: 18,
    legalPack: 'cy',
  },
  PT: {
    countryCode: 'PT',
    country: 'Portugal',
    currency: 'EUR',
    ipt: { rate: 0.09 },
    adminFee: 18,
    legalPack: 'pt',
  },
  GR: {
    countryCode: 'GR',
    country: 'Greece',
    currency: 'EUR',
    ipt: { rate: 0.15 },
    adminFee: 18,
    legalPack: 'gr',
  },
  ES: {
    countryCode: 'ES',
    country: 'Spain',
    currency: 'EUR',
    ipt: { rate: 0.0815 },
    adminFee: 18,
    legalPack: 'es',
  },
  IT: {
    countryCode: 'IT',
    country: 'Italy',
    currency: 'EUR',
    ipt: { rate: 0.225 },
    adminFee: 18,
    legalPack: 'it',
  },
};

function resolveCountryCode(): CountryCode {
  const raw = String(process.env.DEFAULT_REGION_CODE || 'CY').toUpperCase();
  if (raw === 'CY' || raw === 'PT' || raw === 'GR' || raw === 'ES' || raw === 'IT') return raw;
  return 'CY';
}

/**
 * Build a fresh `TenantConfig` from environment variables. Pure function,
 * no caching. Each call re-reads `process.env` so test setups that
 * mutate env vars between cases see the latest values.
 *
 * Intended call sites:
 *   - `backend/seed.ts`
 *   - `backend/scripts/*.mts`
 *   - `tools/migrations/*` one-shot scripts
 *   - `enqueueSystemOutboxEvent` (system outbox writes that fire before
 *     an HTTP request can establish ALS)
 *   - test setup that needs an explicit tenant for a unit-of-work that
 *     cannot use the standard tenant fixtures
 *
 * Anywhere else in production code, call `getTenantConfig()` from
 * within an ALS context bound by `resolveOperatingTenant` /
 * `runWithPolicyOperatingTenant` / `runWithBinderOperatingTenant`.
 */
export function buildTenantConfigFromEnv(): TenantConfig {
  const countryCode = resolveCountryCode();
  const defaults = DEFAULTS_BY_COUNTRY[countryCode];
  const tenantSlug = envStr('TENANT_SLUG', `abbeygate-${countryCode.toLowerCase()}`);
  return {
    id: TENANT_IDS_BY_SLUG[tenantSlug] ?? TENANT_IDS.CY,
    tenantSlug,
    countryCode,
    country: envStr('DEFAULT_COUNTRY', defaults.country),
    currency: envStr('DEFAULT_CURRENCY', defaults.currency),
    ipt: {
      rate: envNum('IPT_RATE', defaults.ipt.rate ?? 0),
      flatFee: envNum('IPT_FLAT_FEE', defaults.ipt.flatFee ?? 0),
    },
    adminFee: envNum('ADMIN_FEE', defaults.adminFee),
    publicBaseUrl: envStr('PUBLIC_BASE_URL', `https://${tenantSlug}.facio.io`),
    fromEmail: envStr('EMAIL_FROM_ADDRESS', 'no-reply@facio.io'),
    brandLogo: {
      white: envStr('BRAND_LOGO_WHITE_URL', ''),
      blue: envStr('BRAND_LOGO_BLUE_URL', ''),
    },
    legalPack: defaults.legalPack,
  };
}
