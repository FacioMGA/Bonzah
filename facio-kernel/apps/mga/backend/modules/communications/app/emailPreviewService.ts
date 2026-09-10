import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import {
  CUSTOMER_EMAIL_TRIGGER_REGISTRY,
  resolveTemplateForTrigger,
  type CustomerEmailTriggerMapping,
  type CustomerEmailTriggerKey,
} from './customerEmailTriggerRegistry.js';
import { dispatchCustomerEmailTrigger } from './customerEmailTriggerService.js';
import { fetchApprovedTemplateOverride } from './customerTemplateCatalogService.js';
import { getOperatingTenantConfig } from '../../../platform/tenant/tenantAls.js';
import {
  getCustomerTemplateDefinitionByKey,
  type CustomerTemplateKey,
} from '../domain/customerTemplateCatalog.js';
import { renderCustomerTemplate } from '../domain/customerTemplateRenderer.js';
import { extractVariables } from '../domain/templateRenderer.js';
import {
  buildPreviewBrand,
  buildPreviewVariables,
  normalizePreviewJurisdiction,
  PREVIEW_JURISDICTIONS,
  type PreviewJurisdiction,
} from '../domain/emailPreviewFixtures.js';
import { lintRenderedEmail, type EmailLintFinding } from '../domain/emailPreviewLint.js';
import { assertSyntheticRecipientsAllowed } from '../infra/syntheticRecipientAllowlist.js';
import { resolveDeployedSha } from './syntheticEmailAudit.js';

export interface TemplateGovernance {
  version: number | null;
  approvalStatus: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  lastEditor: string | null;
  lastDeployedSha: string | null;
  hasDbOverride: boolean;
}

export interface EmailInventoryItem {
  trigger: CustomerEmailTriggerKey;
  templateKey: CustomerTemplateKey;
  templateName: string;
  systemOnly: boolean;
  productCode?: string;
  isRenewal?: boolean;
  tags: string[];
  requiredVariables: string[];
  governance: TemplateGovernance;
}

async function loadGovernanceByName(): Promise<Map<string, TemplateGovernance>> {
  const rows = await tenantScopedPrisma.communicationTemplate.findMany({
    where: { channel: 'EMAIL' },
    select: {
      name: true,
      version: true,
      approvalStatus: true,
      approvedBy: true,
      approvedAt: true,
      lastEditor: true,
      lastDeployedSha: true,
    },
  });
  const map = new Map<string, TemplateGovernance>();
  for (const r of rows) {
    map.set(r.name, {
      version: r.version ?? null,
      approvalStatus: r.approvalStatus ?? null,
      approvedBy: r.approvedBy ?? null,
      approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
      lastEditor: r.lastEditor ?? null,
      lastDeployedSha: r.lastDeployedSha ?? null,
      hasDbOverride: true,
    });
  }
  return map;
}

function emptyGovernance(): TemplateGovernance {
  return {
    version: null,
    approvalStatus: null,
    approvedBy: null,
    approvedAt: null,
    lastEditor: null,
    lastDeployedSha: null,
    hasDbOverride: false,
  };
}

function requiredVariablesFor(templateKey: CustomerTemplateKey): string[] {
  const def = getCustomerTemplateDefinitionByKey(templateKey);
  if (!def) return [];
  return Array.from(
    new Set([
      ...extractVariables(def.subjectTemplate || ''),
      ...extractVariables(def.bodyTemplate || ''),
    ]),
  ).filter((p) => p !== 'brandName' && !p.startsWith('brand.'));
}

/**
 * System emails that are produced OUTSIDE the customer-email trigger registry —
 * they build and send their own payload directly through a provider, so they
 * have no catalog template to render/lint here. They are still surfaced in the
 * inventory (flagged not-previewable) so the "every system email" view is
 * honest rather than silently omitting active senders. Keep this list in step
 * with any new direct producer; the coverage report counts only the previewable
 * (trigger-registry) templates.
 */
export interface DirectEmailProducer {
  id: string;
  source: string;
  reason: string;
}

export const DIRECT_EMAIL_PRODUCERS: readonly DirectEmailProducer[] = [
  {
    id: 'CARDOG_MODEL_SUGGESTION',
    source: 'backend/workers/handlers/EMAIL.CARDOG_MODEL_SUGGESTION.ts',
    reason:
      'Internal ops notification built and sent directly via SendGrid (no catalog template); not customer-facing and not previewable through the render pipeline.',
  },
];

export interface EmailPreviewInventory {
  triggerTemplates: EmailInventoryItem[];
  directProducers: readonly DirectEmailProducer[];
}

export async function listEmailPreviewInventory(): Promise<EmailPreviewInventory> {
  const governance = await loadGovernanceByName();
  const triggerTemplates = CUSTOMER_EMAIL_TRIGGER_REGISTRY.map((entry) => {
    const def = getCustomerTemplateDefinitionByKey(entry.templateKey);
    return {
      trigger: entry.trigger,
      templateKey: entry.templateKey,
      templateName: def?.name || entry.templateKey,
      systemOnly: Boolean(entry.systemOnly || def?.systemOnly),
      productCode: entry.productCode,
      isRenewal: entry.isRenewal,
      tags: (def?.tags || []).map((t) => String(t)),
      requiredVariables: requiredVariablesFor(entry.templateKey),
      governance: governance.get(entry.templateKey) || emptyGovernance(),
    };
  });
  return { triggerTemplates, directProducers: DIRECT_EMAIL_PRODUCERS };
}

export interface EmailPreviewResult {
  trigger: CustomerEmailTriggerKey | null;
  templateKey: CustomerTemplateKey;
  templateName: string;
  jurisdiction: PreviewJurisdiction;
  systemOnly: boolean;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  missingVariables: string[];
  lint: EmailLintFinding[];
  governance: TemplateGovernance;
  availableJurisdictions: readonly PreviewJurisdiction[];
}

function resolveTemplateKey(input: {
  trigger?: string;
  templateKey?: string;
}): { templateKey: CustomerTemplateKey; trigger: CustomerEmailTriggerKey | null; mapping?: CustomerEmailTriggerMapping } {
  if (input.trigger) {
    const key = resolveTemplateForTrigger(input.trigger as CustomerEmailTriggerKey);
    if (!key) throw new Error(`Unknown email trigger: ${input.trigger}`);
    return { templateKey: key, trigger: input.trigger as CustomerEmailTriggerKey };
  }
  if (input.templateKey) {
    const def = getCustomerTemplateDefinitionByKey(input.templateKey as CustomerTemplateKey);
    if (!def) throw new Error(`Unknown email template: ${input.templateKey}`);
    const entry = CUSTOMER_EMAIL_TRIGGER_REGISTRY.find((e) => e.templateKey === input.templateKey);
    return { templateKey: input.templateKey as CustomerTemplateKey, trigger: entry?.trigger || null, mapping: entry };
  }
  throw new Error('previewEmail requires a trigger or templateKey');
}

export async function previewEmail(input: {
  trigger?: string;
  templateKey?: string;
  jurisdiction?: string;
}): Promise<EmailPreviewResult> {
  const { templateKey, trigger } = resolveTemplateKey(input);
  const def = getCustomerTemplateDefinitionByKey(templateKey);
  if (!def) throw new Error(`Unknown email template: ${templateKey}`);
  const jurisdiction = normalizePreviewJurisdiction(input.jurisdiction);
  const brand = buildPreviewBrand(jurisdiction);
  const variables = buildPreviewVariables(def, jurisdiction);

  // Render the EFFECTIVE template dispatch would send: an APPROVED DB override
  // if one exists (Phase 3 governance), otherwise the shipped code design.
  // Rendering only the code fallback would let an override with new variables
  // or broken links pass preview/lint/coverage while production ships it.
  const templateOverride = await fetchApprovedTemplateOverride(templateKey);
  const rendered = renderCustomerTemplate(templateKey, variables, { templateOverride, brand, synthetic: true });
  const lint = lintRenderedEmail({
    subject: rendered.subject,
    bodyText: rendered.bodyText,
    bodyHtml: rendered.bodyHtml,
    logoUrl: brand.logoUrl,
  });

  const governance = (await loadGovernanceByName()).get(templateKey) || emptyGovernance();

  return {
    trigger,
    templateKey,
    templateName: rendered.templateName,
    jurisdiction,
    systemOnly: rendered.systemOnly,
    subject: rendered.subject,
    bodyHtml: rendered.bodyHtml,
    bodyText: rendered.bodyText,
    missingVariables: rendered.missingVariables,
    lint,
    governance,
    availableJurisdictions: PREVIEW_JURISDICTIONS,
  };
}

export interface EmailCoverageRow {
  trigger: CustomerEmailTriggerKey;
  templateKey: CustomerTemplateKey;
  hasFixture: boolean;
  rendersClean: boolean;
  lintErrors: number;
  approvalStatus: string;
  snapshotStatus: 'NOT_CAPTURED';
}

export async function emailCoverageReport(): Promise<{
  generatedShaAtRuntime: string;
  rows: EmailCoverageRow[];
  summary: { total: number; clean: number; withErrors: number; directProducers: number };
}> {
  const governance = await loadGovernanceByName();
  const rows: EmailCoverageRow[] = [];
  for (const entry of CUSTOMER_EMAIL_TRIGGER_REGISTRY) {
    const def = getCustomerTemplateDefinitionByKey(entry.templateKey);
    if (!def) continue;
    const brand = buildPreviewBrand('CY');
    const variables = buildPreviewVariables(def, 'CY');
    const templateOverride = await fetchApprovedTemplateOverride(entry.templateKey);
    const rendered = renderCustomerTemplate(entry.templateKey, variables, { templateOverride, brand, synthetic: true });
    const lint = lintRenderedEmail({
      subject: rendered.subject,
      bodyText: rendered.bodyText,
      bodyHtml: rendered.bodyHtml,
      logoUrl: brand.logoUrl,
    });
    const errors = lint.filter((f) => f.severity === 'error').length;
    rows.push({
      trigger: entry.trigger,
      templateKey: entry.templateKey,
      hasFixture: true,
      rendersClean: rendered.missingVariables.length === 0 && errors === 0,
      lintErrors: errors,
      approvalStatus: governance.get(entry.templateKey)?.approvalStatus || 'CODE_ONLY',
      snapshotStatus: 'NOT_CAPTURED',
    });
  }
  const clean = rows.filter((r) => r.rendersClean).length;
  // `total` counts the previewable trigger-registry templates only. Direct
  // producers (see DIRECT_EMAIL_PRODUCERS) are reported separately so the
  // summary never implies coverage it does not have.
  return {
    generatedShaAtRuntime: resolveDeployedSha(),
    rows,
    summary: {
      total: rows.length,
      clean,
      withErrors: rows.length - clean,
      directProducers: DIRECT_EMAIL_PRODUCERS.length,
    },
  };
}

export interface PreviewTestSendResult {
  sent: boolean;
  messageId?: string;
  blocked?: boolean;
  reason?: string;
}

/**
 * Send a SYNTHETIC test email of a template to an ALLOWLISTED test mailbox.
 * Never creates a policy/payment/claim — it only queues a synthetic comm
 * message, which the transport re-checks against the allowlist (defence in
 * depth). Refuses immediately if the recipient is not allowlisted.
 */
export async function sendPreviewTestEmail(input: {
  trigger?: string;
  templateKey?: string;
  jurisdiction?: string;
  toEmail: string;
}): Promise<PreviewTestSendResult> {
  const { templateKey, trigger, mapping } = resolveTemplateKey(input);
  if (!trigger) {
    return { sent: false, blocked: true, reason: `Template ${templateKey} has no dispatch trigger; preview only` };
  }
  const toEmail = String(input.toEmail || '').trim();
  const allow = assertSyntheticRecipientsAllowed([toEmail]);
  if (!allow.ok) {
    return {
      sent: false,
      blocked: true,
      reason: `Recipient not on the synthetic test allowlist: ${allow.blocked.join(', ') || '(empty)'}`,
    };
  }
  const def = getCustomerTemplateDefinitionByKey(templateKey);
  if (!def) return { sent: false, blocked: true, reason: `Unknown template ${templateKey}` };
  const jurisdiction = normalizePreviewJurisdiction(input.jurisdiction);

  // A test SEND renders through dispatch, which resolves branding + the legal
  // footer from the request's ALS operating tenant — NOT from the previewed
  // jurisdiction. Previewing PT/ES/GR then sending would queue a CY-branded
  // email. Preview (non-sending) is free to switch jurisdictions; a SEND is
  // pinned to the operator's operating tenant. Refuse a cross-jurisdiction send
  // with a clear instruction to switch MGA context first.
  const operatingCountry = String(getOperatingTenantConfig()?.countryCode || '').toUpperCase();
  if (operatingCountry && operatingCountry !== jurisdiction) {
    return {
      sent: false,
      blocked: true,
      reason: `Test send is pinned to your operating tenant (${operatingCountry}); switch MGA context to send a ${jurisdiction} email, or preview only.`,
    };
  }
  const variables = buildPreviewVariables(def, jurisdiction);

  const result = await dispatchCustomerEmailTrigger({
    trigger,
    entityType: 'POLICY',
    entityId: `preview-test:${templateKey}`,
    toEmail,
    variables,
    synthetic: true,
    source: 'PREVIEW_TEST_SEND',
    forceSystemOnly: true,
    productCode: mapping?.productCode,
    isRenewal: mapping?.isRenewal,
    idempotencySeed: `preview-test:${templateKey}:${jurisdiction}:${Date.now()}`,
  });
  if (result.skipped) {
    return { sent: false, reason: result.reason };
  }
  return { sent: true, messageId: result.messageId };
}
