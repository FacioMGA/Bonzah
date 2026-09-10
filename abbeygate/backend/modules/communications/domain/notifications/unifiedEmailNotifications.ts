import { dispatchCustomerEmailTrigger } from '../../app/customerEmailTriggerService.js';
import type { CommunicationAttachmentRef } from '../../domain/types.js';
import { logger } from './emailInfra.js';

interface IInvoice {
  invoiceNumber: string;
  billingPeriod: { start: Date; end: Date };
  netToCapacity: number;
  pdfUrl?: string;
}

interface ILandlord {
  name: string;
  contactInfo?: { email?: string };
}

// Peter's approved Beazley correspondence rule: the separate contents notice
// accompanies a placed Home policy when the contents sum insured is €50,000 or
// more. It is deliberately owned by the canonical customer-email dispatcher,
// so it cannot be sent from a quote-only path.
const HOME_HIGH_VALUE_CONTENTS_NOTICE_THRESHOLD = 50_000;

export async function sendInvoiceEmail(invoice: IInvoice, landlord: ILandlord): Promise<boolean> {
  const toEmail = landlord.contactInfo?.email || `contact@${landlord.name.replace(/\s+/g, '').toLowerCase()}.com`;
  const result = await dispatchCustomerEmailTrigger({
    trigger: 'PAYMENT_REQUESTED',
    entityType: 'INVOICE',
    entityId: String(invoice.invoiceNumber || 'invoice'),
    toEmail,
    variables: {
      customer: { firstName: String(landlord.name || '').trim().split(/\s+/)[0] || 'there' },
      policy: { number: String(invoice.invoiceNumber || '') },
      payment: {
        amount: Number(invoice.netToCapacity || 0).toFixed(2),
        url: String(invoice.pdfUrl || ''),
        expiresAt: String(invoice.billingPeriod?.start?.toISOString?.() || ''),
      },
    },
    idempotencySeed: String(invoice.invoiceNumber || ''),
  });
  return Boolean(!result.skipped);
}

export async function sendAutoQuoteInviteEmail(params: {
  toEmail: string;
  contactName: string;
  insuredName: string;
  quoteUrl: string;
  kind: 'initial' | 'resend';
  policyId?: string;
  quoteReference?: string;
  premium?: string;
  excess?: string;
  registration?: string;
}): Promise<boolean> {
  const result = await dispatchCustomerEmailTrigger({
    trigger: params.kind === 'initial' ? 'QUOTE_SENT' : 'QUOTE_FOLLOW_UP',
    entityType: 'POLICY',
    entityId: String(params.policyId || ''),
    toEmail: params.toEmail,
    variables: {
      customer: { firstName: String(params.contactName || '').trim().split(/\s+/)[0] || 'there' },
      policy: {
        vehicleDescription: quoteFieldOrDash(params.insuredName),
        registration: quoteFieldOrDash(params.registration),
      },
      quote: {
        reference: quoteFieldOrDash(params.quoteReference),
        premium: quoteFieldOrDash(params.premium),
        excess: quoteFieldOrDash(params.excess),
        url: params.quoteUrl,
      },
      renewal: { url: params.quoteUrl, date: '' },
    },
    idempotencySeed: `${params.kind}:${params.quoteUrl}`,
  });
  return Boolean(!result.skipped);
}

export async function sendUwQuestionnaireRequestEmail(params: {
  toEmail: string;
  firstName: string;
  applicationUrl: string;
  policyId?: string;
}): Promise<boolean> {
  const result = await dispatchCustomerEmailTrigger({
    trigger: 'UW_INFO_REQUESTED',
    entityType: 'POLICY',
    entityId: String(params.policyId || ''),
    toEmail: params.toEmail,
    variables: {
      customer: { firstName: params.firstName || 'there' },
      uw: { message: '', url: params.applicationUrl },
    },
    idempotencySeed: params.applicationUrl,
  });
  return Boolean(!result.skipped);
}

export async function sendFollowUpBatchEmail(
  toEmail: string,
  insuredName: string,
  requests: Array<{ question: string; note: string; type: string }>,
  contactName: string,
  questionnaireUrl: string,
  context?: { policyId?: string }
): Promise<boolean> {
  const messageText = (requests || [])
    .slice(0, 12)
    .map((r) => `${String(r.question || r.type || 'Item')}${r.note ? ` - ${String(r.note)}` : ''}`)
    .join('\n');

  const result = await dispatchCustomerEmailTrigger({
    trigger: 'UW_INFO_REQUESTED',
    entityType: 'POLICY',
    entityId: String(context?.policyId || ''),
    toEmail,
    variables: {
      customer: { firstName: String(contactName || '').trim().split(/\s+/)[0] || 'there' },
      policy: { vehicleDescription: insuredName },
      uw: { message: messageText, url: questionnaireUrl },
    },
    idempotencySeed: `${questionnaireUrl}:${messageText}`,
  });
  return Boolean(!result.skipped);
}

/**
 * Normalise a template variable that the `QUOTE_STANDARD` template marks as
 * `required`. `validateVariables` treats `''`, `null`, and `undefined` as missing
 * and causes the whole dispatch to be skipped — so callers that do not yet know
 * a particular field (initial quote invite, pre-pricing, pre-binding) would
 * silently fail. We substitute an em-dash placeholder instead so the email
 * still ships and renders a legible "— not yet known" cell.
 */
function quoteFieldOrDash(value: string | number | null | undefined): string {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  return text.length > 0 ? text : '—';
}

export type QuoteEmailDispatchResult = {
  queued: boolean;
  messageId?: string;
  skippedReason?: string;
};

export type QuoteEmailAttachment = {
  filename: string;
  content: Buffer;
};

export async function dispatchQuoteEmail(
  toEmail: string,
  insuredName: string,
  quoteUrl: string,
  pdfBuffer?: Buffer,
  pdfFilename?: string,
  context?: {
    policyId?: string;
    quote?: { reference?: string; premium?: string; excess?: string; productLabel?: string };
    policy?: { registration?: string; vehicleDescription?: string };
    productCode?: string;
    idempotencySeed?: string;
    /**
     * Quote-pack attachments selected by the canonical document service.
     * When supplied, this replaces the legacy single-PDF argument so a
     * regulated quote pack is dispatched as the exact generated set.
     */
    attachments?: QuoteEmailAttachment[];
    /** Additional document references selected by a product-owned pack. */
    extraAttachments?: CommunicationAttachmentRef[];
  }
): Promise<QuoteEmailDispatchResult> {
  const attachmentName = (pdfFilename && pdfFilename.trim().length > 0 ? pdfFilename.trim() : `quote-${Date.now()}.pdf`);
  const firstName = String(insuredName || '').trim().split(/\s+/)[0] || 'there';
  const vehicleDescription = quoteFieldOrDash(
    context?.policy?.vehicleDescription || insuredName
  );
  const attachments = Array.isArray(context?.attachments)
    ? context.attachments.map((attachment) => ({
      filename: attachment.filename.toLowerCase().endsWith('.pdf') ? attachment.filename : `${attachment.filename}.pdf`,
      mimetype: 'application/pdf',
      contentBase64: attachment.content.toString('base64'),
    }))
    : (pdfBuffer && pdfBuffer.length > 0
      ? [{
        filename: attachmentName.toLowerCase().endsWith('.pdf') ? attachmentName : `${attachmentName}.pdf`,
        mimetype: 'application/pdf',
        contentBase64: pdfBuffer.toString('base64'),
      }]
      : []);
  const result = await dispatchCustomerEmailTrigger({
    trigger: 'QUOTE_SENT',
    entityType: 'POLICY',
    entityId: String(context?.policyId || ''),
    toEmail,
    variables: {
      customer: { firstName },
      policy: {
        vehicleDescription,
        registration: quoteFieldOrDash(context?.policy?.registration),
      },
      quote: {
        reference: quoteFieldOrDash(context?.quote?.reference),
        premium: quoteFieldOrDash(context?.quote?.premium),
        excess: quoteFieldOrDash(context?.quote?.excess),
        productLabel: String(context?.quote?.productLabel || '').trim() || 'motor insurance quote',
        url: quoteUrl,
      },
    },
    productCode: context?.productCode,
    attachments: [...attachments, ...(context?.extraAttachments || [])],
    idempotencySeed: context?.idempotencySeed || `${quoteUrl}:${attachmentName}`,
  });
  if (result.skipped) {
    logger.warn({ event: 'quote.send.skipped', reason: result.reason }, 'quote.send.skipped');
    return { queued: false, skippedReason: result.reason };
  }
  logger.info({ event: 'quote.send.queued', messageId: result.messageId }, 'quote.send.queued');
  return { queued: true, messageId: result.messageId };
}

export async function sendQuoteEmail(
  toEmail: string,
  insuredName: string,
  quoteUrl: string,
  pdfBuffer?: Buffer,
  pdfFilename?: string,
  context?: {
    policyId?: string;
    quote?: { reference?: string; premium?: string; excess?: string; productLabel?: string };
    policy?: { registration?: string; vehicleDescription?: string };
  }
): Promise<boolean> {
  const result = await dispatchQuoteEmail(toEmail, insuredName, quoteUrl, pdfBuffer, pdfFilename, context);
  return result.queued;
}

export async function sendPaymentRequestEmail(params: {
  toEmail: string;
  contactName: string;
  policyNumber: string;
  amount: number;
  paymentUrl: string;
  expiresAtIso: string;
  balanceSnapshot?: number;
  entityType?: 'POLICY' | 'CLAIM' | 'ACCOUNT' | 'QUOTE' | 'PARTY' | 'CASE' | 'INVOICE';
  entityId?: string;
}): Promise<boolean> {
  const amountText = Number(params.amount || 0).toFixed(2);
  const expiresAtText = (() => {
    const d = new Date(String(params.expiresAtIso || ''));
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB');
  })();
  const result = await dispatchCustomerEmailTrigger({
    trigger: 'PAYMENT_REQUESTED',
    entityType: params.entityType || 'POLICY',
    entityId: String(params.entityId || params.policyNumber || ''),
    toEmail: params.toEmail,
    variables: {
      customer: { firstName: String(params.contactName || '').trim().split(/\s+/)[0] || 'there' },
      policy: { number: params.policyNumber },
      payment: { amount: amountText, url: params.paymentUrl, expiresAt: expiresAtText },
    },
    idempotencySeed: `${params.paymentUrl}:${params.expiresAtIso}`,
  });
  return Boolean(!result.skipped);
}

export async function sendEmailVerificationOtpEmail(params: {
  toEmail: string;
  code: string;
  expiresMinutes: number;
}): Promise<boolean> {
  const result = await dispatchCustomerEmailTrigger({
    trigger: 'AUTH_EMAIL_VERIFICATION_OTP',
    entityType: 'ACCOUNT',
    entityId: params.toEmail.toLowerCase(),
    toEmail: params.toEmail,
    variables: { auth: { code: params.code, expiresMinutes: params.expiresMinutes } },
    idempotencySeed: `verify:${params.code}:${params.expiresMinutes}`,
    forceSystemOnly: true,
  });
  return Boolean(!result.skipped);
}

export async function sendPasswordResetOtpEmail(params: {
  toEmail: string;
  code: string;
  expiresMinutes: number;
}): Promise<boolean> {
  const result = await dispatchCustomerEmailTrigger({
    trigger: 'AUTH_PASSWORD_RESET_OTP',
    entityType: 'ACCOUNT',
    entityId: params.toEmail.toLowerCase(),
    toEmail: params.toEmail,
    variables: { auth: { code: params.code, expiresMinutes: params.expiresMinutes } },
    idempotencySeed: `reset:${params.code}:${params.expiresMinutes}`,
    forceSystemOnly: true,
  });
  return Boolean(!result.skipped);
}

/**
 * Send a one-time, signed password-reset link.
 *
 * The `url` MUST already include the opaque token (typically as `?token=...`).
 * The recipient clicks the link, lands on `/auth/reset`, and the page POSTs
 * the token + chosen password to `/api/auth/password-reset/confirm-link`.
 *
 * `expiresHours` controls the copy in the email; the actual expiry is enforced
 * server-side against the persisted `UserOtp` row.
 */
export async function sendPasswordResetLinkEmail(params: {
  toEmail: string;
  url: string;
  expiresHours: number;
}): Promise<boolean> {
  const result = await dispatchCustomerEmailTrigger({
    trigger: 'AUTH_PASSWORD_RESET_LINK',
    entityType: 'ACCOUNT',
    entityId: params.toEmail.toLowerCase(),
    toEmail: params.toEmail,
    variables: { auth: { url: params.url, expiresHours: params.expiresHours } },
    idempotencySeed: `reset-link:${params.url}`,
    forceSystemOnly: true,
  });
  return Boolean(!result.skipped);
}

/**
 * Send a "you've been invited" magic link to an admin-created user.
 *
 * Same redemption flow as `sendPasswordResetLinkEmail` (POST to
 * `/api/auth/password-reset/confirm-link`); the confirm endpoint also
 * activates the user (`isActive=true`) and clears the invite token columns
 * when the redeeming user was previously inactive-with-invite.
 */
export async function sendInviteLinkEmail(params: {
  toEmail: string;
  firstName: string;
  url: string;
  expiresHours: number;
  invitedBy?: string;
  platformName?: string;
}): Promise<boolean> {
  const platformName = String(params.platformName || 'Abbeygate').trim() || 'Abbeygate';
  const firstName = String(params.firstName || '').trim() || 'there';
  const invitedByText = String(params.invitedBy || '').trim();
  const invitedBySuffix = invitedByText.length > 0 ? ` by ${invitedByText}` : '';
  const result = await dispatchCustomerEmailTrigger({
    trigger: 'AUTH_INVITE_LINK',
    entityType: 'ACCOUNT',
    entityId: params.toEmail.toLowerCase(),
    toEmail: params.toEmail,
    variables: {
      auth: {
        url: params.url,
        firstName,
        platformName,
        expiresHours: params.expiresHours,
        invitedBySuffix,
      },
    },
    idempotencySeed: `invite-link:${params.url}`,
    forceSystemOnly: true,
  });
  return Boolean(!result.skipped);
}

export async function sendPolicyWelcomeEmail(params: {
  toEmail: string;
  contactName: string;
  policyNumber: string;
  dashboardUrl: string;
  policyStartDate?: string;
  policyEndDate?: string;
  /** The date the contract was bound/issued (display form, e.g. "24 July 2026"). */
  policyBoundDate?: string;
  /** Tenant-jurisdiction support phone (display form). Falls back to the Cyprus office. */
  supportPhone?: string;
  vehicleDetails?: string;
  coverSubjectLabel?: string;
  coverType?: string;
  jacketPdf?: Buffer;
  jacketFilename?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
  policyId?: string;
  productCode?: string;
  isRenewal?: boolean;
  /** Canonical Home coverage supplied by the issued-pack orchestrator. */
  homeContentsSumInsured?: number;
  /** Mark this welcome email as synthetic (issuance-proof canary). */
  synthetic?: boolean;
  /** Origin tag for the synthetic marker (e.g. 'ISSUANCE_PROOF'). */
  source?: string;
}): Promise<boolean> {
  const attachments = Array.isArray(params.attachments) && params.attachments.length
    ? params.attachments
    : (params.jacketPdf
      ? [{
        filename: params.jacketFilename || 'Policy Jacket.pdf',
        content: params.jacketPdf,
        contentType: 'application/pdf',
      }]
      : []);
  // ABY-77 — every required template variable for `NEW_BUSINESS_CONFIRMATION`
  // (`policy.startDate / endDate / vehicleDescription / dashboardUrl /
  // support.phone`) MUST be non-empty; the canonical template renderer
  // (`templateRenderer.validateVariables`) treats `''` as missing and
  // silently skips dispatch. The orchestrator now resolves all of these
  // from canonical sources, but we defensively fall back here so a future
  // caller can never re-introduce the silent-drop regression.
  const policyNumber = String(params.policyNumber || '').trim();
  const fallbackSubject = policyNumber ? `Policy ${policyNumber}` : 'your new policy';
  const startDate = String(params.policyStartDate || '').trim() || 'on file';
  const endDate = String(params.policyEndDate || '').trim() || 'on file';
  // Bound date ≙ the moment this email goes out (issuance), so "today" is the
  // correct default when a caller does not pass it explicitly.
  const boundDate = String(params.policyBoundDate || '').trim()
    || new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const supportPhone = String(params.supportPhone || '').trim() || '+357 26 819175';
  const vehicleDescription = String(params.vehicleDetails || '').trim() || fallbackSubject;
  // The cover-subject noun ("Vehicle" / "Trip" / "Property" / ...) is a
  // required template variable; never let it reach the renderer empty.
  const coverSubjectLabel = String(params.coverSubjectLabel || '').trim() || 'Cover';
  const dashboardUrl = String(params.dashboardUrl || '').trim();
  const result = await dispatchCustomerEmailTrigger({
    trigger: 'NEW_BUSINESS_PLACED',
    entityType: 'POLICY',
    entityId: String(params.policyId || params.policyNumber || ''),
    toEmail: params.toEmail,
    variables: {
      customer: { firstName: String(params.contactName || '').trim().split(/\s+/)[0] || 'there' },
      policy: {
        number: policyNumber,
        boundDate,
        startDate,
        endDate,
        coverSubjectLabel,
        vehicleDescription,
        dashboardUrl,
      },
      support: { phone: supportPhone },
    },
    attachments: attachments.map((a) => ({
      filename: a.filename,
      mimetype: a.contentType || 'application/pdf',
      contentBase64: Buffer.from(a.content).toString('base64'),
    })),
    idempotencySeed: `${policyNumber}:${dashboardUrl}`,
    productCode: params.productCode,
    isRenewal: params.isRenewal,
    ...(params.synthetic ? { synthetic: true, source: params.source || 'ISSUANCE_PROOF' } : {}),
  });
  if (result.skipped) {
    const reason = String(result.reason || 'Welcome email dispatch skipped').trim();
    logger.error(
      {
        event: 'email.welcome.dispatch_skipped',
        policyId: params.policyId,
        policyNumber,
        toEmail: params.toEmail,
        reason,
      },
      'email.welcome.dispatch_skipped',
    );
    throw new Error(reason);
  }
  const homeContentsSumInsured = params.homeContentsSumInsured;
  if (String(params.productCode || '').trim().toUpperCase() === 'HOME'
    && Number.isFinite(homeContentsSumInsured)
    && Number(homeContentsSumInsured) >= HOME_HIGH_VALUE_CONTENTS_NOTICE_THRESHOLD) {
    const contentsNotice = await dispatchCustomerEmailTrigger({
      trigger: 'HOME_HIGH_VALUE_CONTENTS_NOTICE',
      entityType: 'POLICY',
      entityId: String(params.policyId || params.policyNumber || ''),
      toEmail: params.toEmail,
      productCode: 'HOME',
      variables: {
        customer: { firstName: String(params.contactName || '').trim().split(/\s+/)[0] || 'there' },
        policy: { number: policyNumber },
        home: { contentsSumInsured: `EUR ${Number(homeContentsSumInsured).toFixed(2)}` },
      },
      idempotencySeed: `home-contents-notice:${policyNumber}:${dashboardUrl}`,
    });
    if (contentsNotice.skipped) {
      logger.warn(
        { event: 'home.contents_notice.skipped', reason: contentsNotice.reason, policyId: params.policyId },
        'home.contents_notice.skipped',
      );
    }
  }
  return true;
}

/**
 * Send the internal staff "new business placed" notification.
 *
 * This is a dedicated back-office template (`INTERNAL_SALE_NOTIFICATION`) — it
 * is NOT a duplicate of the customer welcome email. It gives the sales desk a
 * structured operational summary: who bought what, for how much, from where,
 * plus the payment reference and correlation id needed to reconcile the sale.
 * The template is system-only, so we pass `forceSystemOnly: true`.
 */
export async function sendInternalSaleNotificationEmail(params: {
  toEmail: string;
  purchaserName: string;
  purchaserEmail: string;
  productLabel: string;
  policyNumber: string;
  coverSummary?: string;
  paymentReference?: string;
  source?: string;
  correlationId?: string;
  adminUrl?: string;
  policyId?: string;
}): Promise<boolean> {
  // Every placeholder in the template must resolve or the dispatcher treats the
  // message as having missing variables and silently skips it. Optional fields
  // therefore default to a readable 'n/a' rather than being left undefined.
  const orNa = (value: string | undefined): string => {
    const v = String(value || '').trim();
    return v || 'n/a';
  };
  const result = await dispatchCustomerEmailTrigger({
    trigger: 'INTERNAL_SALE_NOTIFICATION',
    entityType: 'POLICY',
    entityId: String(params.policyId || params.policyNumber || ''),
    toEmail: params.toEmail,
    forceSystemOnly: true,
    variables: {
      policy: { number: String(params.policyNumber || '').trim() },
      sale: {
        purchaserName: String(params.purchaserName || '').trim() || 'Customer',
        purchaserEmail: String(params.purchaserEmail || '').trim() || 'n/a',
        productLabel: String(params.productLabel || '').trim() || 'Policy',
        coverSummary: orNa(params.coverSummary),
        paymentReference: orNa(params.paymentReference),
        source: orNa(params.source),
        correlationId: orNa(params.correlationId),
        adminUrl: orNa(params.adminUrl),
      },
    },
    // Include the recipient so a desk fan-out (e.g. CY -> Danny/Peter/Theo) is
    // idempotent per mailbox rather than collapsing to a single send.
    idempotencySeed: `internal-sale:${params.policyNumber}:${orNa(params.paymentReference)}:${String(params.toEmail || '').trim().toLowerCase()}`,
  });
  if (result.skipped) {
    logger.warn(
      {
        event: 'email.internal_sale.dispatch_skipped',
        policyId: params.policyId,
        policyNumber: params.policyNumber,
        toEmail: params.toEmail,
        reason: result.reason,
      },
      'email.internal_sale.dispatch_skipped',
    );
  }
  return Boolean(!result.skipped);
}

export async function sendRequestedDocumentsEmail(params: {
  toEmail: string;
  contactName: string;
  policyNumber: string;
  attachments: Array<{ filename: string; content: Buffer; contentType?: string }>;
  policyId?: string;
}): Promise<boolean> {
  const result = await dispatchCustomerEmailTrigger({
    trigger: 'DOCUMENTS_RESEND',
    entityType: 'POLICY',
    entityId: String(params.policyId || params.policyNumber || ''),
    toEmail: params.toEmail,
    variables: {
      customer: { firstName: String(params.contactName || '').trim().split(/\s+/)[0] || 'there' },
      policy: { number: params.policyNumber },
    },
    attachments: (params.attachments || []).map((a) => ({
      filename: a.filename,
      mimetype: a.contentType || 'application/pdf',
      contentBase64: Buffer.from(a.content).toString('base64'),
    })),
    idempotencySeed: `${params.policyNumber}:${(params.attachments || []).map((a) => a.filename).join(',')}`,
  });
  return Boolean(!result.skipped);
}

/**
 * ABY-259 — send a quiet "resume your in-progress quote" link.
 *
 * Used by the customer quote wizard footer (`QuoteWizardResumeLink`). The
 * point of this template is to be deliberately low-key: no PDF attachment,
 * no OTP gate (the customer already typed this email into the wizard a
 * moment ago), no marketing copy. Just one URL the customer can click to
 * land back in the wizard at the same step.
 *
 * The link itself is the wizard's `publicSessionToken`, which has no TTL
 * (see `genericPublicQuoteRouter.ts:64` and `schema.prisma:478`) — so the
 * customer can come back days later and still re-open the same draft.
 */
export async function sendQuoteResumeLinkEmail(params: {
  toEmail: string;
  firstName: string;
  resumeUrl: string;
  policyId?: string;
}): Promise<boolean> {
  const result = await dispatchCustomerEmailTrigger({
    trigger: 'QUOTE_RESUME_LINK_REQUESTED',
    entityType: 'POLICY',
    entityId: String(params.policyId || ''),
    toEmail: params.toEmail,
    variables: {
      customer: { firstName: String(params.firstName || '').trim() || 'there' },
      quote: { resumeUrl: params.resumeUrl },
    },
    idempotencySeed: `resume-link:${params.resumeUrl}`,
  });
  return Boolean(!result.skipped);
}

export async function sendFnolIntakeLinkEmail(params: {
  toEmail: string;
  contactName?: string;
  fnolLink: string;
  claimReference?: string;
  policyNumber?: string;
  expiresInDays?: number;
  claimId?: string;
  policyId?: string;
}): Promise<boolean> {
  const entityType = params.claimId ? 'CLAIM' : 'POLICY';
  const entityId = String(params.claimId || params.policyId || params.policyNumber || '');
  const result = await dispatchCustomerEmailTrigger({
    trigger: 'CLAIMS_FNOL_LINK',
    entityType,
    entityId,
    toEmail: params.toEmail,
    variables: {
      customer: { firstName: String(params.contactName || '').trim().split(/\s+/)[0] || 'there' },
      claim: { fnolUrl: params.fnolLink, reference: params.claimReference || '' },
      policy: { number: params.policyNumber || '' },
    },
    idempotencySeed: `${params.claimReference || ''}:${params.fnolLink}`,
  });
  return Boolean(!result.skipped);
}

export async function sendTimelineMessageEmail(params: {
  toEmail: string;
  subject: string;
  message: string;
}): Promise<boolean> {
  const result = await dispatchCustomerEmailTrigger({
    trigger: 'UW_INFO_REQUESTED',
    entityType: 'ACCOUNT',
    entityId: params.toEmail.toLowerCase(),
    toEmail: params.toEmail,
    variables: {
      customer: { firstName: 'there' },
      uw: { message: params.message, url: '' },
    },
    idempotencySeed: `${params.subject}:${params.message}`,
    forceSystemOnly: true,
  });
  return Boolean(!result.skipped);
}
