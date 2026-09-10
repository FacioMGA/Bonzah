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
 * Initial tenants: abbeygate-cy, abbeygate-pt, abbeygate-gr, abbeygate-es.
 */

import { getOperatingTenantConfig } from './tenantAls.js';

export type CountryCode = 'CY' | 'PT' | 'GR' | 'ES' | 'IT';
export type LegalPack = 'cy' | 'pt' | 'gr' | 'es' | 'it';

export interface TenantConfig {
  /** Tenant table primary key (UUID). Used by Sprint 2+ FK columns. */
  id: string;
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
  /** Display name for the operating broker (e.g. "Abbeygate Cyprus"). Shown in projections and correspondence. */
  defaultBrokerName?: string;
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

export const TENANT_IDS_BY_SLUG: Readonly<Record<string, string>> = {
  'abbeygate-cy': TENANT_IDS.CY,
  'abbeygate-pt': TENANT_IDS.PT,
  'abbeygate-gr': TENANT_IDS.GR,
  'abbeygate-es': TENANT_IDS.ES,
};

/**
 * Canonical per-country customer contact address shown in facioMGA
 * communications and generated documents. Single source of truth — comms and
 * document view models resolve it from `getTenantConfig().countryCode`; never
 * hardcode a country contact string at a call site.
 */
export const CONTACT_EMAIL_BY_COUNTRY: Readonly<Record<CountryCode, string>> = {
  CY: 'cyprus@abbeygate.cy',
  PT: 'portugal@abbeygate.pt',
  GR: 'greece@abbeygate.gr',
  ES: 'spain@abbeygate.es',
  IT: 'italy@abbeygate.it',
};

export function contactEmailForCountry(countryCode: CountryCode): string {
  return CONTACT_EMAIL_BY_COUNTRY[countryCode];
}

/**
 * Canonical per-country customer contact telephone shown in facioMGA
 * communications and generated documents (display form). Mirrors
 * `CONTACT_EMAIL_BY_COUNTRY` — comms and document view models resolve it from
 * `getTenantConfig().countryCode`; never hardcode a country phone string at a
 * call site. ES/IT operations are currently served from the Cyprus office.
 */
export const CONTACT_PHONE_BY_COUNTRY: Readonly<Record<CountryCode, string>> = {
  CY: '00357 26 819175',
  PT: '00351 289 369 254',
  GR: '0030 211 2345 774',
  ES: '00357 26 819175',
  IT: '00357 26 819175',
};

export function contactPhoneForCountry(countryCode: CountryCode): string {
  return CONTACT_PHONE_BY_COUNTRY[countryCode];
}

/**
 * Cyprus underwriting referral handler. Routes to Danny only — the full-roster
 * blast caused every CY staffer to phone Danny about the same referral, so
 * Danny/Peter asked for referrals to land with Danny alone with no change to
 * the CC (Danny + Peter Sheppard, 5 Aug 2026). GR/ES/IT have no dedicated
 * office and are serviced by Cyprus, so they route here too.
 */
const CYPRUS_UW_RECIPIENTS: readonly string[] = ['danny@abbeygate.cy'];

/**
 * Portugal underwriting referral handlers — the underwriting trio confirmed in
 * the same thread (Peter / Andy F, 5 Aug 2026). `matt` is Matthew Pickering's
 * mailbox. Emails follow the roster convention `firstname@abbeygate.pt`.
 */
const PORTUGAL_UW_RECIPIENTS: readonly string[] = [
  'matt@abbeygate.pt',
  'ivan@abbeygate.pt',
  'francisco@abbeygate.pt',
];

/**
 * Canonical per-country underwriting referral recipients. When a quote lands
 * in REFERRAL (age, claims history, rate-table referral, …) the
 * `EMAIL.UW_REFERRAL` worker notifies the jurisdiction's underwriting handler
 * so they can contact the client. Mirrors `CONTACT_EMAIL_BY_COUNTRY` — resolve
 * from `getTenantConfig().countryCode`; never hardcode a recipient at a call
 * site. CY routes to Danny; PT to its underwriting trio; GR/ES/IT are serviced
 * by Cyprus. Confirmed by Danny / Peter Sheppard / Andy F, 5 Aug 2026.
 */
export const UW_REFERRAL_EMAILS_BY_COUNTRY: Readonly<Record<CountryCode, readonly string[]>> = {
  CY: CYPRUS_UW_RECIPIENTS,
  PT: PORTUGAL_UW_RECIPIENTS,
  GR: CYPRUS_UW_RECIPIENTS,
  ES: CYPRUS_UW_RECIPIENTS,
  IT: CYPRUS_UW_RECIPIENTS,
};

/**
 * Andrew (Andy) Francis oversees both offices and is CC'd on his jurisdiction
 * mailbox: `andy@abbeygate.cy` for Cyprus-serviced risks (CY/GR/ES/IT) and
 * `andy@abbeygate.pt` for Portugal risks (Andy F, 5 Aug 2026).
 */
const UW_REFERRAL_OVERSIGHT_CC_BY_COUNTRY: Readonly<Record<CountryCode, string>> = {
  CY: 'andy@abbeygate.cy',
  PT: 'andy@abbeygate.pt',
  GR: 'andy@abbeygate.cy',
  ES: 'andy@abbeygate.cy',
  IT: 'andy@abbeygate.cy',
};

/**
 * Appended to every UW referral notification across all jurisdictions and
 * products, deduplicated case-insensitively so a recipient is never emailed
 * twice. The central monitoring inbox (`yuval`) plus ALL-territory oversight
 * copied on every office: Peter Sheppard (kept on all UW referrals, Andy F,
 * 5 Aug 2026) and IT support (Theodoros Dengestinos), on the `.cy` HQ domain.
 */
export const UW_REFERRAL_GLOBAL_CC: readonly string[] = [
  'yuval@facio.io',
  'peter@abbeygate.cy',
  'theo@abbeygate.cy',
];

export function uwReferralEmailsForCountry(countryCode: CountryCode): readonly string[] {
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const email of [
    ...UW_REFERRAL_EMAILS_BY_COUNTRY[countryCode],
    UW_REFERRAL_OVERSIGHT_CC_BY_COUNTRY[countryCode],
    ...UW_REFERRAL_GLOBAL_CC,
  ]) {
    const key = email.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recipients.push(email);
  }
  return recipients;
}

/**
 * Internal copy recipients for online policy confirmations. The customer
 * `NEW_BUSINESS_CONFIRMATION` email remains customer-only; the issued-pack
 * worker sends a separate `INTERNAL_SALE_NOTIFICATION` staff copy to each
 * mailbox listed here so the sales desk sees every processed policy.
 *
 * Cyprus now notifies the full desk — Danny, Peter and Theo — because Danny
 * reported he was not receiving "a policy that has been processed" email
 * (Danny / Peter Sheppard, 2026-08-14). Other jurisdictions keep their single
 * monitoring mailbox until asked otherwise; ES/IT have no online desk yet.
 */
export const ONLINE_POLICY_CONFIRMATION_COPY_EMAILS_BY_COUNTRY: Readonly<Record<CountryCode, readonly string[]>> = {
  CY: ['danny@abbeygate.cy', 'peter@abbeygate.cy', 'theo@abbeygate.cy'],
  PT: ['theo@abbeygate.pt'],
  GR: ['theo@abbeygate.gr'],
  ES: [],
  IT: [],
};

export function onlinePolicyConfirmationCopyEmailsForCountry(countryCode: CountryCode): readonly string[] {
  return ONLINE_POLICY_CONFIRMATION_COPY_EMAILS_BY_COUNTRY[countryCode];
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
