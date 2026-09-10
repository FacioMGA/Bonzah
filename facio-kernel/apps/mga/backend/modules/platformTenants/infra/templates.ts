import { createHash } from 'node:crypto';
import { homeManifest } from '@facio/products';
import { loadHomeRates } from '../../../products/home/pricing/data/loader.js';
import { DEFAULT_HOME_UW_CONFIG, parseHomeUwConfig } from '../../../products/home/underwriting/homeUwAutomation.js';
import { HomeProductAdapter } from '../../../products/home/HomeProductAdapter.js';
import { buildDefaultProgramMbeProductConfig } from '../../mbe/domain/programProduct.js';
import { tenantRuntimeSettingsSchema } from '../../../platform/tenant/tenantRuntimeSettings.js';
import type { PlatformTemplateView, PlatformTenantProfile } from '../domain/contracts.js';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
export function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const contentHash = (value: unknown) => createHash('sha256').update(canonical(json(value))).digest('hex');

export type ReusableTenantTemplate = {
  view: PlatformTemplateView;
  countryCode: 'CY' | 'PT' | 'ES' | 'GR'; country: string; currency: string; legalPack: 'cy' | 'pt' | 'es' | 'gr';
  product?: { code: string; name: string; icon: string; classOfBusiness: string; riskCode: string; programCode: string };
  additionalTemplates?: ReusableTenantTemplate[];
  configuration: {
    underwriting: Json; coverage: Json; questionnaire: Json; workflow: Json; channels: Json;
    ratingTables: Json; documentSources: Json; ratingStages?: Json;
  };
};

/** Explicit opt-in synthetic reuse of the pinned source's existing Home rules, never a runtime fallback. */
export function createReusableHomeTemplate(): ReusableTenantTemplate {
  const adapter = new HomeProductAdapter();
  const catalog = {
    productType: 'HOME',
    get: (code: string) => adapter.getEndorsementTemplate(code),
    getAll: () => adapter.getEndorsementCatalog(),
    getGroups: () => adapter.getEndorsementGroups(),
  };
  const fields = homeManifest.questionnaire.sections.flatMap((section) => section.fields);
  const configuration = {
    underwriting: json(parseHomeUwConfig(DEFAULT_HOME_UW_CONFIG)),
    coverage: json(buildDefaultProgramMbeProductConfig({ productType: 'HOME', catalog })),
    questionnaire: json({
      requiredness: Object.fromEntries(fields.filter((field) => field.required === true).map((field) => [field.path, true])),
      // The existing claims contract's empty/default form is explicit. No incident
      // types are enabled until a tenant publishes its reviewed claims configuration.
      claimsContract: { version: 1, fnol: { incidentTypes: [], thirdPartyKinds: [], rules: { minDescriptionLength: 10, allowedCountries: ['Cyprus'], requiresThirdPartyFor: [], requiresPoliceFor: [] } }, fullClaimForm: { fields: [], source: 'metadata' } },
      sections: homeManifest.questionnaire.sections.map((section) => ({
        id: section.id, title: section.title,
        questions: section.fields.map((field) => ({ ...field, key: field.path })),
      })),
    }),
    workflow: json({ approvalRules: [], billing: {}, referralOnly: false, externalIssuance: { mode: 'NONE' } }),
    channels: json({ questions: true, quote: true, payment: false }),
    ratingTables: json(loadHomeRates()),
    documentSources: json([
      { documentType: 'HOME_SCHEDULE_PDF', sourceId: 'home-schedule', sourceVersion: 'v4-footer-clearance' },
      { documentType: 'HOME_STATEMENT_OF_FACT_PDF', sourceId: 'home-statement-of-fact', sourceVersion: 'v1' },
    ]),
  };
  const basis = {
    id: 'home-cy-synthetic', version: 1,
    sourceCommit: 'f85219459e6a888996d3d3af731b6d45a98fde94',
    countryCode: 'CY' as const, country: 'Cyprus', currency: 'EUR', legalPack: 'cy' as const,
    configuration,
  };
  return {
    ...basis,
    view: {
      id: basis.id, version: basis.version, hash: contentHash(basis),
      name: 'Home insurance · Cyprus · synthetic training',
      jurisdiction: 'CY', currency: 'EUR', productCodes: ['HOME'], kind: 'SYNTHETIC',
      sourceCommit: basis.sourceCommit,
      limitations: [
        'Explicit reuse of pinned Home pricing, underwriting, questionnaire and coverage configuration for synthetic exercise only.',
        'No insurer appointment, coverholder licence, customer acceptance, live payment or external delivery is granted.',
        'This template supports the existing Cyprus Home engine; arbitrary jurisdictions and new products require their own reviewed template.',
        'Claims incident types are not enabled by this quote/bind template and require explicit tenant configuration.',
      ],
    },
  };
}

export function runtimeSettingsForProfile(profile: PlatformTenantProfile) {
  return tenantRuntimeSettingsSchema.parse({
    schemaVersion: 'tenant-runtime-v1',
    locale: profile.locale, timeZone: profile.timeZone, organization: { declaredRole: profile.declaredRole },
    contact: { email: profile.contactEmail, phone: profile.contactPhone },
    routing: { underwritingReferralTo: [profile.contactEmail], underwritingReferralCc: [], onlinePolicyConfirmationCopies: [] },
    branding: {
      displayName: profile.displayName, legalName: profile.legalName,
      addressLines: profile.addressLines,
      legalLines: ['Synthetic sandbox configuration. No insurance cover or regulatory authority.'],
      regulatorLine: null, websiteUrl: null, websiteLabel: null,
      ...(profile.primaryColor ? { primaryColor: profile.primaryColor } : {}),
      ...(profile.secondaryColor ? { secondaryColor: profile.secondaryColor } : {}),
    },
  });
}

export function productDocumentsForProfile(profile: PlatformTenantProfile, template: ReusableTenantTemplate) {
  const disclaimer = 'Synthetic training only. No insurance cover or regulatory authority.';
  return {
    productKit: {
      schemaVersion: 1,
      // Existing endorsement catalog identifier, not a customer identity or a source-tenant reference.
      programCode: template.product?.programCode || 'abbeygate_home',
      brand: {
        brokerDisplayName: profile.displayName, brokerLegalName: profile.legalName,
        brokerAddressMultiline: profile.addressLines.join('\n'), brokerAddressOneLine: profile.addressLines.join(', '),
        brokerRegulatoryLine: disclaimer, uwTeamName: `${profile.displayName} training`,
        coverholderStatement: disclaimer, dataControllerName: profile.displayName,
      },
    },
    issuedPack: { requiredTypes: (template.configuration.documentSources as Array<{ documentType: string }>).map((source) => source.documentType).filter((type) => !type.endsWith('_QUOTE_PDF')) },
    sources: template.configuration.documentSources,
  };
}
