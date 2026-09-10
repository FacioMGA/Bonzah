/**
 * Tenant fixtures for product conformance tests.
 *
 * Returns the four seeded MGA tenants with their deterministic UUIDs and
 * jurisdiction-correct IPT / legal-pack values.  Used by the tenant-axis
 * conformance matrix to verify that all product engines work correctly under
 * every supported jurisdiction without requiring DB access.
 */

import { TENANT_IDS, type TenantConfig } from '../../platform/tenant/tenantConfig.js';

const BRAND_LOGO = { white: '', blue: '' } as const;

export function getTenantFixtures(): TenantConfig[] {
  return ([
    {
      id: TENANT_IDS.CY,
      tenantSlug: 'abbeygate-cy',
      countryCode: 'CY',
      country: 'Cyprus',
      currency: 'EUR',
      // CY Home + Travel binders carry no policy-level IPT
      // (legacy schedules show Local Taxes / Tax Fee = 0.00).
      ipt: { flatFee: 0 },
      adminFee: 18,
      legalPack: 'cy',
      publicBaseUrl: 'https://abbeygate-cy.facio.io',
      fromEmail: 'no-reply@facio.io',
      brandLogo: BRAND_LOGO,
    },
    {
      id: TENANT_IDS.PT,
      tenantSlug: 'abbeygate-pt',
      countryCode: 'PT',
      country: 'Portugal',
      currency: 'EUR',
      ipt: { rate: 0.09 },
      adminFee: 18,
      legalPack: 'pt',
      publicBaseUrl: 'https://abbeygate-pt.facio.io',
      fromEmail: 'no-reply@facio.io',
      brandLogo: BRAND_LOGO,
    },
    {
      id: TENANT_IDS.GR,
      tenantSlug: 'abbeygate-gr',
      countryCode: 'GR',
      country: 'Greece',
      currency: 'EUR',
      ipt: { rate: 0.15 },
      adminFee: 18,
      legalPack: 'gr',
      publicBaseUrl: 'https://abbeygate-gr.facio.io',
      fromEmail: 'no-reply@facio.io',
      brandLogo: BRAND_LOGO,
    },
    {
      id: TENANT_IDS.ES,
      tenantSlug: 'abbeygate-es',
      countryCode: 'ES',
      country: 'Spain',
      currency: 'EUR',
      ipt: { rate: 0.0815 },
      adminFee: 18,
      legalPack: 'es',
      publicBaseUrl: 'https://abbeygate-es.facio.io',
      fromEmail: 'no-reply@facio.io',
      brandLogo: BRAND_LOGO,
    },
  ] satisfies TenantConfig[]).map((tenant) => ({ ...tenant, runtimeSettings: {
    schemaVersion: 'tenant-runtime-v1' as const, locale: 'en-GB', timeZone: 'UTC',
    organization: { declaredRole: 'MGA' as const },
    contact: { email: 'training@example.invalid', phone: '+35700000000' },
    routing: { underwritingReferralTo: ['training@example.invalid'], underwritingReferralCc: [], onlinePolicyConfirmationCopies: [] },
    branding: { displayName: 'Training MGA', legalName: 'Training Insurance Limited', addressLines: ['1 Training Street'], legalLines: ['Training authority only'], regulatorLine: null, websiteUrl: null, websiteLabel: null },
  } }));
}
