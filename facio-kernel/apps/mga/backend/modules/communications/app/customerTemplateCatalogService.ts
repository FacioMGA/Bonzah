import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { Prisma } from '@prisma/client';
import { logger } from '../../../platform/utils/logger.js';
import { resolveDeployedSha } from './syntheticEmailAudit.js';
import { getTenantConfig, getTenantRuntimeSettings, type TenantConfig } from '../../../platform/tenant/tenantConfig.js';
import {
  CUSTOMER_TEMPLATE_DEFINITIONS,
  type CustomerTemplateDefinition,
  type CustomerTemplateKey,
} from '../domain/customerTemplateCatalog.js';
import {
  renderCustomerTemplate as renderCustomerTemplatePure,
  type RenderedCustomerTemplate,
} from '../domain/customerTemplateRenderer.js';
import { buildBrandProfile, type BrandProfile } from '../domain/emailBranding.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * Resolve the DB override that dispatch would actually apply for a template:
 * the most-recent enabled `communication_templates` row, but ONLY when it is
 * `APPROVED` (Phase 3 governance). Any other state is refused and `null` is
 * returned so callers fall back to the shipped code design. Exported so the
 * Email Preview & Testing Centre renders/lints/coverages the SAME effective
 * template that production and test sends use — not just the code fallback.
 */
export async function fetchApprovedTemplateOverride(
  templateKey: CustomerTemplateKey,
): ReturnType<typeof fetchTemplateOverride> {
  return fetchTemplateOverride(templateKey);
}

async function fetchTemplateOverride(templateKey: CustomerTemplateKey): Promise<Record<string, unknown> | null> {
  const db = await tenantScopedPrisma.communicationTemplate.findFirst({
    where: {
      name: templateKey,
      channel: 'EMAIL',
      enabled: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (!db) return null;
  // Phase 3 governance: a DB-backed row may only OVERRIDE the shipped code
  // design when it has been explicitly APPROVED. A stale/unapproved DB template
  // must never silently reach a customer — we fall back to the approved,
  // code-backed canonical template and make the refusal operationally visible.
  if (String(db.approvalStatus || '').toUpperCase() !== 'APPROVED') {
    logger.warn(
      {
        event: 'email.template.override.refused_unapproved',
        templateKey,
        templateId: db.id,
        approvalStatus: db.approvalStatus,
        version: db.version,
      },
      'email.template.override.refused_unapproved',
    );
    return null;
  }
  return asRecord(db);
}

/**
 * Translate the per-request {@link TenantConfig} into a domain-pure
 * {@link BrandProfile}. This is the only place where the email branding
 * pipeline crosses the platform / domain boundary — keeping this resolution
 * in the app layer preserves the CHAMPS rule that domain code must not
 * depend on platform infrastructure.
 */
export function resolveCustomerEmailBrandProfile(tenant?: TenantConfig): BrandProfile {
  const cfg = tenant ?? getTenantConfig();
  const { branding, contact } = getTenantRuntimeSettings(cfg);
  return buildBrandProfile({
    countryCode: cfg.countryCode,
    brokerName: branding.displayName,
    whiteLogoUrl: cfg.brandLogo?.white || null,
    publicBaseUrl: cfg.publicBaseUrl,
    fromEmail: cfg.fromEmail,
    colors: branding.primaryColor ? { primary: branding.primaryColor, accent: branding.primaryColor } : undefined,
    signature: {
      jurisdiction: cfg.country,
      legalLines: [...branding.legalLines],
      addressLines: [...branding.addressLines],
      regulatorLine: branding.regulatorLine ?? undefined,
      websiteLabel: branding.websiteLabel ?? undefined,
      websiteUrl: branding.websiteUrl ?? undefined,
      phones: [{ label: 'Contact', display: contact.phone, tel: contact.phone.replace(/[^+0-9]/g, '') }],
    },
  });
}

export async function renderCustomerTemplate(
  templateKey: CustomerTemplateKey,
  variables: Parameters<typeof renderCustomerTemplatePure>[1],
  options?: { synthetic?: boolean }
): Promise<RenderedCustomerTemplate> {
  const templateOverride = await fetchTemplateOverride(templateKey);
  const brand = resolveCustomerEmailBrandProfile();
  return renderCustomerTemplatePure(templateKey, variables, {
    templateOverride,
    brand,
    synthetic: options?.synthetic,
  });
}

export async function upsertCanonicalCustomerTemplates(): Promise<void> {
  // The code-backed catalog IS the shipped, approved design. Seeding it marks
  // each row APPROVED and stamps the deploy SHA so the approval gate in
  // `fetchTemplateOverride` treats the canonical rows as the source of truth,
  // while any hand-edited DB row stays DRAFT (and is therefore ignored) until
  // a human approves it.
  const deployedSha = resolveDeployedSha();
  const tenantId = getTenantConfig().id;
  for (const definition of CUSTOMER_TEMPLATE_DEFINITIONS) {
    const variables = Object.keys(definition.variablesSchema || {}).reduce<Record<string, string>>((acc, key) => {
      acc[key] = String(definition.variablesSchema[key] || 'optional');
      return acc;
    }, {});
    await tenantScopedPrisma.communicationTemplate.upsert({
      where: { id: `${tenantId}:customer-template-${definition.key.toLowerCase()}` },
      update: {
        name: definition.key,
        channel: definition.channel,
        subjectTemplate: definition.subjectTemplate,
        bodyTemplate: definition.bodyTemplate,
        variablesSchema: variables,
        enabled: definition.enabled !== false,
        approvalRequired: Boolean(definition.approvalRequired),
        tags: toInputJson(definition.tags || []),
        approvalStatus: 'APPROVED',
        approvedBy: 'system:canonical-seed',
        approvedAt: new Date(),
        lastEditor: 'system:canonical-seed',
        lastDeployedSha: deployedSha,
      },
      create: {
        id: `${tenantId}:customer-template-${definition.key.toLowerCase()}`,
        name: definition.key,
        channel: definition.channel,
        subjectTemplate: definition.subjectTemplate,
        bodyTemplate: definition.bodyTemplate,
        variablesSchema: toInputJson(variables),
        enabled: definition.enabled !== false,
        approvalRequired: Boolean(definition.approvalRequired),
        ownership: 'TENANT',
        tags: toInputJson(definition.tags || []),
        approvalStatus: 'APPROVED',
        approvedBy: 'system:canonical-seed',
        approvedAt: new Date(),
        lastEditor: 'system:canonical-seed',
        lastDeployedSha: deployedSha,
      },
    });
  }
}

export function listCanonicalCustomerTemplateDefinitions(): CustomerTemplateDefinition[] {
  return [...CUSTOMER_TEMPLATE_DEFINITIONS];
}
