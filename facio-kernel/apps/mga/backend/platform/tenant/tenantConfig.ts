/**
 * Tenant configuration resolver — ALS-only.
 *
 * Per ADR-0019, `getTenantConfig()` returns the per-request operating
 * tenant bound by the `resolveOperatingTenant` HTTP middleware, or the
 * tenant explicitly set via `runWithOperatingTenant(...)` for workers /
 * scheduled jobs / system outbox writes.
 *
 * **There is no env-driven singleton fallback.** A call to
 * `getTenantConfig()` outside an ALS context is a bug — it indicates
 * code that escaped the per-request tenancy plumbing — and throws a
 * `TENANT_NOT_RESOLVED` error so the bug surfaces immediately rather
 * than silently leaking the deployment-default tenant across requests.
 *
 * Non-HTTP entrypoints (CLI scripts, seed, system outbox helper, etc.)
 * use `buildTenantConfigFromEnv()` from `./tenantConfigForCli.ts` to
 * materialise an explicit tenant from the environment, then wrap their
 * work in `runWithOperatingTenant(...)`.
 *
 * This module is the single source of truth for tenant-scoped values.
 * Nothing outside `tenantConfigForCli.ts` may read DEFAULT_COUNTRY,
 * DEFAULT_REGION_CODE, DEFAULT_CURRENCY, or similar env vars directly.
 *
 */

import { getOperatingTenantConfig } from './tenantAls.js';
import { parseTenantRuntimeSettings, TenantConfigurationIncompleteError, type TenantRuntimeSettings } from './tenantRuntimeSettings.js';

export type CountryCode = 'CY' | 'PT' | 'GR' | 'ES' | 'IT' | 'US';
export type LegalPack = 'cy' | 'pt' | 'gr' | 'es' | 'it' | 'us';

export interface TenantConfig {
  /** Tenant table primary key (UUID). Used by Sprint 2+ FK columns. */
  id: string;
  /** Server-owned deployment lifecycle; never accepted from an MGA profile form. */
  kind?: 'PRODUCTION' | 'SYNTHETIC' | 'TEST';
  status?: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  parentOrganizationId?: string;
  tenantSlug: string;
  countryCode: CountryCode;
  country: string;
  currency: string;
  ipt: { rate?: number; flatFee?: number };
  adminFee: number;
  publicBaseUrl: string;
  fromEmail: string;
  brandLogo: { white: string; blue: string };
  legalPack: LegalPack;
  /** Display name for the operating broker. Shown in projections and correspondence. */
  defaultBrokerName?: string;
  /** Missing content means setup incomplete; communication never supplies a customer fallback. */
  runtimeSettings?: TenantRuntimeSettings;
}

/**
 * Deterministic operating-tenant IDs. These are system identities, not seed-only
 * fixture data; migrations, seeds, runtime fallback config, and tests must agree.
 */
export const TENANT_IDS = {
  CY: '00000000-0000-4000-8000-000000000001',
  PT: '00000000-0000-4000-8000-000000000002',
  GR: '00000000-0000-4000-8000-000000000003',
  ES: '00000000-0000-4000-8000-000000000004',
} as const;

/** Tenant communication settings must be resolved from the full current tenant, never country alone. */
export function getTenantRuntimeSettings(config: TenantConfig = getTenantConfig()): TenantRuntimeSettings {
  return parseTenantRuntimeSettings(config.runtimeSettings);
}

function settingsForCurrentCountry(countryCode: CountryCode): TenantRuntimeSettings {
  const config = getTenantConfig();
  if (countryCode !== config.countryCode) throw new TenantConfigurationIncompleteError('requested country differs from current operating tenant');
  return getTenantRuntimeSettings(config);
}

/** Compatibility entrypoints preserve callers while removing their former country-map authority. */
export function contactEmailForCountry(countryCode: CountryCode): string {
  return settingsForCurrentCountry(countryCode).contact.email;
}
export function contactPhoneForCountry(countryCode: CountryCode): string {
  return settingsForCurrentCountry(countryCode).contact.phone;
}
export function uwReferralEmailsForCountry(countryCode: CountryCode): readonly string[] {
  const { routing } = settingsForCurrentCountry(countryCode);
  return [...new Map([...routing.underwritingReferralTo, ...routing.underwritingReferralCc]
    .map((email) => [email.toLowerCase(), email] as const)).values()];
}
export function onlinePolicyConfirmationCopyEmailsForCountry(countryCode: CountryCode): readonly string[] {
  return settingsForCurrentCountry(countryCode).routing.onlinePolicyConfirmationCopies;
}

/**
 * Thrown when `getTenantConfig()` is called outside an ALS context.
 * Always indicates a bug — production HTTP/worker code must always run
 * inside `runWithOperatingTenant(...)`.
 */
export class TenantNotResolvedError extends Error {
  readonly code: 'TENANT_NOT_RESOLVED' = 'TENANT_NOT_RESOLVED';
  constructor() {
    super(
      'TENANT_NOT_RESOLVED: getTenantConfig() called outside an ALS context. ' +
        'HTTP code must run inside resolveOperatingTenant middleware; workers / ' +
        'CLI scripts must wrap their entrypoint with runWithOperatingTenant(buildTenantConfigFromEnv(), ...) ' +
        'from backend/platform/tenant/tenantConfigForCli.ts. ' +
        'See ADR-0019 (tenancy + authority fail-closed).',
    );
    this.name = 'TenantNotResolvedError';
  }
}

/**
 * Return the operating-tenant config bound by `runWithOperatingTenant`.
 * Throws `TenantNotResolvedError` if called outside an ALS context.
 */
export function getTenantConfig(): TenantConfig {
  const alsConfig = getOperatingTenantConfig();
  if (alsConfig) return alsConfig;
  throw new TenantNotResolvedError();
}
