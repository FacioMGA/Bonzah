/**
 * CardCorp configuration — single canonical, tenant-aware resolver.
 *
 * ADR-0049 (CardCorp per-tenant live cutover). CardCorp is provisioned per
 * jurisdiction: each country channel (CY, PT, GR) has its OWN entity id and
 * webhook decryption secret, but shares ONE bearer token per environment.
 * `CARDCORP_ENV` selects test vs live (base URL + whether OPPWA's `testMode`
 * form param is sent at all — live requests must omit it).
 *
 * Env scheme (secrets live only in the K8s secret, never in the repo):
 *   CARDCORP_ENV                 test | live         (default: test)
 *   CARDCORP_BEARER_TOKEN        shared per environment
 *   CARDCORP_BASE_URL            optional explicit override of the OPPWA host
 *   CARDCORP_TEST_MODE           EXTERNAL | INTERNAL  (test mode only)
 *   CARDCORP_ENTITY_ID_<CC>      per-country entity id (CC = CY|PT|GR|ES)
 *   CARDCORP_WEBHOOK_SECRET_<CC> per-country AES-GCM webhook secret (64 hex)
 *
 * There is NO global fallback (no bare CARDCORP_ENTITY_ID). Per the
 * no-defensive-fallbacks rule a missing per-country key is a configuration
 * error surfaced by boot validation / a 501 at checkout, never silently
 * papered over with another tenant's credentials. Staging (single test
 * entity) sets CARDCORP_ENTITY_ID_CY/_PT/_GR to the same test id explicitly.
 *
 * The operating country comes from the ALS operating tenant bound by
 * `resolveOperatingTenant` (HTTP) / `runWithOperatingTenant` (worker). The
 * webhook path has no operating tenant, so it selects the secret by trying
 * each configured per-country secret (AES-GCM authenticates the right key).
 */

import { getOperatingTenantConfig } from '../../../platform/tenant/tenantAls.js';

export type CardcorpConfig = {
  entityId: string;
  bearerToken: string;
  baseUrl: string;
  testMode?: 'EXTERNAL' | 'INTERNAL';
  countryCode: string;
};

/** Countries that can be provisioned with a CardCorp channel. */
export const CARDCORP_COUNTRIES = ['CY', 'PT', 'GR', 'ES'] as const;

function env(name: string): string {
  return String(process.env[name] || '').trim();
}

export function isCardcorpLive(): boolean {
  return env('CARDCORP_ENV').toLowerCase() === 'live';
}

export function cardcorpBaseUrl(): string {
  const explicit = env('CARDCORP_BASE_URL');
  if (explicit) return explicit;
  return isCardcorpLive() ? 'https://eu-prod.oppwa.com' : 'https://eu-test.oppwa.com';
}

function normalizeCountry(countryCode: string | null | undefined): string {
  return String(countryCode || '').trim().toUpperCase();
}

/**
 * Operating-tenant country from ALS, or '' when called outside an ALS
 * context (e.g. the webhook receiver). Never throws — the empty string
 * yields an unconfigured `entityId`, which callers already treat as
 * 501 NOT_CONFIGURED.
 */
export function resolveOperatingCountryCode(): string {
  const config = getOperatingTenantConfig();
  return config ? normalizeCountry(config.countryCode) : '';
}

export function cardcorpEntityIdForCountry(countryCode: string): string {
  const cc = normalizeCountry(countryCode);
  return cc ? env(`CARDCORP_ENTITY_ID_${cc}`) : '';
}

export function cardcorpWebhookSecretForCountry(countryCode: string): string {
  const cc = normalizeCountry(countryCode);
  return cc ? env(`CARDCORP_WEBHOOK_SECRET_${cc}`) : '';
}

/**
 * Resolve the CardCorp config for a country. Defaults to the ALS operating
 * tenant's country when `countryCode` is omitted. In live mode the OPPWA
 * `testMode` param is omitted entirely (returned `undefined`).
 */
export function getCardcorpConfig(countryCode?: string): CardcorpConfig {
  const cc = normalizeCountry(countryCode) || resolveOperatingCountryCode();
  const testMode = isCardcorpLive()
    ? undefined
    : env('CARDCORP_TEST_MODE').toUpperCase() === 'INTERNAL'
      ? 'INTERNAL'
      : 'EXTERNAL';
  return {
    entityId: cardcorpEntityIdForCountry(cc),
    bearerToken: env('CARDCORP_BEARER_TOKEN'),
    baseUrl: cardcorpBaseUrl(),
    testMode,
    countryCode: cc,
  };
}

/** Countries with BOTH an entity id and a webhook secret configured. */
export function listConfiguredCardcorpCountries(): string[] {
  return CARDCORP_COUNTRIES.filter(
    (cc) => cardcorpEntityIdForCountry(cc) && cardcorpWebhookSecretForCountry(cc),
  );
}

/** Every configured per-country webhook secret, for host-agnostic decryption. */
export function listCardcorpWebhookSecrets(): Array<{ countryCode: string; secretHex: string }> {
  return CARDCORP_COUNTRIES.map((cc) => ({
    countryCode: cc,
    secretHex: cardcorpWebhookSecretForCountry(cc),
  })).filter((entry) => entry.secretHex.length > 0);
}
