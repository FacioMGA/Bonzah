import crypto from 'node:crypto';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { CommunicationAttachmentRef } from '../domain/types.js';
import type { CustomerEmailTriggerKey } from './customerEmailTriggerRegistry.js';
import { resolveTemplateForTrigger } from './customerEmailTriggerRegistry.js';
import { renderCustomerTemplate } from './customerTemplateCatalogService.js';
import { sendMessageCommand } from './commands/sendMessageCommand.js';
import { recordSyntheticEmailRun } from './syntheticEmailAudit.js';
import { assertSyntheticRecipientsAllowed } from '../infra/syntheticRecipientAllowlist.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { ProductConfigurationError, resolveJurisdictionProductConfig } from '../../jurisdiction/domain/productConfiguration.js';
import { getOperatingTenantConfig } from '../../../platform/tenant/tenantAls.js';

export interface CustomerEmailTriggerDispatchInput {
  trigger: CustomerEmailTriggerKey;
  entityType: 'POLICY' | 'CLAIM' | 'ACCOUNT' | 'QUOTE' | 'PARTY' | 'CASE' | 'INVOICE';
  entityId: string;
  toEmail: string;
  fromActor?: string;
  provider?: 'SENDGRID' | 'SMTP';
  variables: Record<string, unknown>;
  attachments?: CommunicationAttachmentRef[];
  idempotencySeed?: string;
  forceSystemOnly?: boolean;
  /** Product-aware selection is owned by the communications template catalog. */
  productCode?: string;
  /** Selects the renewal-issued variant when a policy issuance is a renewal. */
  isRenewal?: boolean;
  /**
   * Mark this dispatch as SYNTHETIC (issuance-proof canary, preview, or a
   * "send test" from the Email Preview & Testing Centre). When true the subject
   * is stamped with the synthetic prefix, a test banner is rendered, and the
   * message is flagged on `externalRefs.synthetic` so the transport enforces the
   * test-mailbox allowlist and refuses to deliver a synthetic message to a real
   * customer address. Absent/false ⇒ a normal customer email (unchanged).
   */
  synthetic?: boolean;
  /** Free-form origin tag for audit (e.g. 'ISSUANCE_PROOF', 'PREVIEW_TEST_SEND'). */
  source?: string;
}

function makeIdempotencyKey(parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

export async function dispatchCustomerEmailTrigger(
  input: CustomerEmailTriggerDispatchInput
): Promise<{ messageId?: string; skipped?: boolean; reason?: string }> {
  let productCode = String(input.productCode || '').trim().toUpperCase() || undefined;
  const productBoundTrigger = ['QUOTE_SENT', 'QUOTE_FOLLOW_UP', 'QUOTE_RESUME_LINK_REQUESTED', 'UW_INFO_REQUESTED', 'PAYMENT_REQUESTED', 'NEW_BUSINESS_PLACED', 'RENEWAL_INVITE', 'RENEWAL_CHASER'].includes(input.trigger);
  // Generic synthetic previews contain no business policy; the existing recipient allowlist still applies.
  const genericPreview = input.synthetic === true && input.source === 'PREVIEW_TEST_SEND' && !productCode;
  if (productBoundTrigger && !productCode && !genericPreview) {
    const policy = input.entityType === 'POLICY' && input.entityId ? await tenantScopedPrisma.policy.findUnique({
      where: { id: input.entityId },
      select: { productType: true },
    }) : null;
    productCode = String(policy?.productType || '').trim().toUpperCase() || undefined;
    const genericPayment = input.trigger === 'PAYMENT_REQUESTED' && input.entityType !== 'POLICY';
    if (!productCode && !genericPayment) return { skipped: true, reason: 'PRODUCT_IDENTITY_REQUIRED: policy product could not be resolved' };
  }
  if (productBoundTrigger && productCode) {
    try {
      resolveJurisdictionProductConfig({ productCode, tenant: getTenantConfig() });
    } catch (error) {
      if (!(error instanceof ProductConfigurationError)) throw error;
      return { skipped: true, reason: `PRODUCT_UNAVAILABLE: ${error.message}` };
    }
  }
  const templateKey = resolveTemplateForTrigger(input.trigger, {
    productCode,
    isRenewal: input.isRenewal,
  });
  if (!templateKey) {
    return { skipped: true, reason: `No template mapping for trigger ${input.trigger}` };
  }

  const rendered = await renderCustomerTemplate(templateKey, input.variables, {
    synthetic: input.synthetic,
  });
  if (rendered.missingVariables.length > 0) {
    return {
      skipped: true,
      reason: `Missing variables: ${rendered.missingVariables.join(', ')}`,
    };
  }

  if (rendered.systemOnly && !input.forceSystemOnly) {
    return {
      skipped: true,
      reason: `Template ${templateKey} is system-only and manual override was not allowed`,
    };
  }

  if (input.synthetic) {
    const allow = assertSyntheticRecipientsAllowed([input.toEmail]);
    if (!allow.ok) {
      return {
        skipped: true,
        reason: `SYNTHETIC_RECIPIENT_NOT_ALLOWLISTED: ${allow.blocked.join(', ') || '(empty)'}`,
      };
    }
  }

  const idempotencyKey = makeIdempotencyKey([
    input.entityType,
    input.entityId,
    input.trigger,
    input.toEmail.toLowerCase(),
    // Synthetic and normal dispatches must never share an idempotency key: a
    // synthetic attempt blocked by the transport allowlist would otherwise
    // "poison" the key so a later legitimate customer delivery is treated as a
    // duplicate and never queued.
    input.synthetic ? 'synthetic' : 'normal',
    input.idempotencySeed || '',
    JSON.stringify(input.variables || {}),
  ]);

  const message = await sendMessageCommand.execute({
    entityType: input.entityType,
    entityId: input.entityId,
    direction: 'OUTBOUND',
    channel: 'EMAIL',
    provider: input.provider || 'SENDGRID',
    communicationType: 'EXTERNAL',
    fromActor: input.fromActor || 'system',
    toRecipients: [input.toEmail],
    subject: rendered.subject,
    body: rendered.bodyText,
    attachments: input.attachments || [],
    status: 'QUEUED',
    templateId: rendered.templateId || rendered.templateKey,
    templateName: rendered.templateName,
    templateVariables: input.variables,
    renderedBody: rendered.bodyText,
    renderedSubject: rendered.subject,
    missingVariables: rendered.missingVariables,
    externalRefs: {
      template: {
        templateId: rendered.templateId || rendered.templateKey,
        templateName: rendered.templateName,
        variables: input.variables,
        renderedBody: rendered.bodyText,
        renderedSubject: rendered.subject,
        missingVariables: rendered.missingVariables,
      },
      // Persist rendered html for channel adapter usage.
      renderedHtml: rendered.bodyHtml,
      trigger: input.trigger,
      templateKey: rendered.templateKey,
      // Synthetic marker travels with the message so the transport can enforce
      // the test-mailbox allowlist regardless of which caller queued it.
      ...(input.synthetic ? { synthetic: true, source: input.source || 'SYNTHETIC' } : {}),
    },
    idempotencyKey,
  });

  // Phase 3 — every synthetic dispatch leaves a persistent audit record
  // (deployed SHA, trigger, template + rendered version, recipients, delivery
  // id, operating tenant, cleanup status). Best-effort: never let an audit
  // failure affect the send. The outbound worker later finalises `result` and
  // the issuance-proof lifecycle closes out `cleanupStatus`.
  if (input.synthetic) {
    const source = input.source || 'SYNTHETIC';
    // The issuance-proof canary creates a throwaway policy/pack that must be
    // cleaned up; other synthetic sources (preview "send test") create nothing.
    const cleanupStatus = source === 'ISSUANCE_PROOF' ? 'PENDING' : 'NOT_REQUIRED';
    await recordSyntheticEmailRun({
      trigger: input.trigger,
      templateKey: rendered.templateKey,
      templateVersion: rendered.templateVersion,
      messageId: message.id ?? null,
      operatingTenantId: getOperatingTenantConfig()?.tenantSlug ?? null,
      recipients: [input.toEmail],
      deliveryIds: message.id ? [message.id] : [],
      result: 'QUEUED',
      cleanupStatus,
      source,
      correlationId: input.entityId,
    });
  }

  return { messageId: message.id };
}
