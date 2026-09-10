import { renderTemplate, validateVariables } from './templateRenderer.js';
import {
  CUSTOMER_TEMPLATE_DEFINITIONS,
  type CustomerTemplateDefinition,
  type CustomerTemplateKey,
  getCustomerTemplateDefinitionByKey,
} from './customerTemplateCatalog.js';
import {
  type BrandProfile,
  brandVariables,
  expandBrandPlaceholders,
  getFallbackBrandProfile,
  renderEmailLayout,
  SYNTHETIC_TEST_SUBJECT_PREFIX,
} from './emailBranding.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export interface RenderedCustomerTemplate {
  templateKey: CustomerTemplateKey;
  templateId?: string;
  templateName: string;
  /**
   * Revision of the DB-backed override actually rendered, or null when the
   * shipped code template was used (no approved DB override). Carried through
   * so the synthetic-run audit can record WHICH revision produced a canary.
   */
  templateVersion: number | null;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  missingVariables: string[];
  usedVariables: string[];
  variablesSchemaValidation: { valid: boolean; missing: string[] };
  systemOnly: boolean;
}

export interface RenderCustomerTemplateOptions {
  /** Optional DB override (CommunicationTemplate row, opaque shape). */
  templateOverride?: Record<string, unknown> | null;
  /**
   * Brand profile used by the wrapper to render the header logo, signature
   * block and compliance footer. The app layer is responsible for resolving
   * this from `getTenantConfig()` per request — the domain renderer stays
   * pure. When omitted the deterministic fallback profile is used (CY).
   */
  brand?: BrandProfile;
  /**
   * When true the rendered email is SYNTHETIC (health canary, preview, or a
   * "send test" from the Email Preview & Testing Centre). The subject is
   * prefixed with {@link SYNTHETIC_TEST_SUBJECT_PREFIX} and a prominent test
   * banner is rendered in the HTML body so a synthetic message can never be
   * mistaken for a real customer communication. Defaults to false, so real
   * customer emails are byte-identical to before.
   */
  synthetic?: boolean;
}

export function renderCustomerTemplate(
  templateKey: CustomerTemplateKey,
  variables: Record<string, unknown>,
  options?: RenderCustomerTemplateOptions
): RenderedCustomerTemplate {
  const fallback = getCustomerTemplateDefinitionByKey(templateKey);
  if (!fallback) {
    throw new Error(`Unknown customer template key: ${templateKey}`);
  }
  const brand = options?.brand ?? getFallbackBrandProfile();
  const dbTemplate = options?.templateOverride ? asRecord(options.templateOverride) : null;
  const rawSubjectTemplate = String(dbTemplate?.subjectTemplate || fallback.subjectTemplate || '').trim();
  const rawBodyTemplate = String(dbTemplate?.bodyTemplate || fallback.bodyTemplate || '').trim();
  const subjectTemplate = expandBrandPlaceholders(rawSubjectTemplate, brand);
  const bodyTemplate = expandBrandPlaceholders(rawBodyTemplate, brand);
  const templateName = String(dbTemplate?.name || fallback.name || templateKey);
  const templateId = String(dbTemplate?.id || '').trim() || undefined;
  const templateVersion = typeof dbTemplate?.version === 'number' ? dbTemplate.version : null;

  const schemaValue = dbTemplate?.variablesSchema;
  const schemaRecord = schemaValue && typeof schemaValue === 'object' && !Array.isArray(schemaValue)
    ? (schemaValue as Record<string, unknown>)
    : fallback.variablesSchema;

  const mergedVariables: Record<string, unknown> = {
    ...brandVariables(brand),
    ...variables,
  };

  const subjectResult = renderTemplate(subjectTemplate, mergedVariables);
  const bodyResult = renderTemplate(bodyTemplate, mergedVariables);
  const schemaValidation = validateVariables(schemaRecord, mergedVariables);
  const usedVariables = Array.from(new Set([...subjectResult.usedVariables, ...bodyResult.usedVariables]));
  const missingVariables = Array.from(
    new Set([
      ...subjectResult.missingVariables,
      ...bodyResult.missingVariables,
      ...schemaValidation.missing,
    ])
  );

  const tags = Array.isArray(dbTemplate?.tags)
    ? (dbTemplate?.tags as unknown[]).map((x) => String(x).toLowerCase())
    : (fallback.tags || []).map((x) => String(x).toLowerCase());
  const systemOnly = tags.includes('system-only') || Boolean(fallback.systemOnly);

  const synthetic = Boolean(options?.synthetic);
  const subject = synthetic
    ? `${SYNTHETIC_TEST_SUBJECT_PREFIX}${subjectResult.rendered}`
    : subjectResult.rendered;

  const inlineLinks = (fallback.inlineLinks || []).flatMap((link) => {
    const label = renderTemplate(`{{${link.labelVariable}}}`, mergedVariables);
    const url = renderTemplate(`{{${link.urlVariable}}}`, mergedVariables);
    if (label.missingVariables.length || url.missingVariables.length) return [];
    return [{ label: label.rendered, url: url.rendered }];
  });

  const bodyHtml = renderEmailLayout({
    bodyText: bodyResult.rendered,
    brand,
    title: subject,
    synthetic,
    inlineLinks,
  });

  return {
    templateKey,
    templateId,
    templateName,
    templateVersion,
    subject,
    bodyText: bodyResult.rendered,
    bodyHtml,
    missingVariables,
    usedVariables,
    variablesSchemaValidation: schemaValidation,
    systemOnly,
  };
}

export function listCanonicalCustomerTemplateKeys(): CustomerTemplateKey[] {
  return CUSTOMER_TEMPLATE_DEFINITIONS.map((tpl) => tpl.key);
}

export function listCanonicalCustomerTemplateDefinitions(): CustomerTemplateDefinition[] {
  return [...CUSTOMER_TEMPLATE_DEFINITIONS];
}
