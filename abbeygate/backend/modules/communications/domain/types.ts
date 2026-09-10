/**
 * CHAMPS Domain Types — Communications Module
 *
 * Pure type definitions for the communications domain.
 * No imports from infra, http, or external libraries.
 */

// ── Direction of communication ──────────────────────────────────────────────
export type MessageDirection = 'OUTBOUND' | 'INBOUND' | 'INTERNAL';

// ── Channel through which communication travels ─────────────────────────────
export type CommunicationChannel =
  | 'EMAIL'
  | 'SMS'
  | 'WHATSAPP'
  | 'PHONE_CALL'
  | 'NOTE'
  | 'INTERNAL_CHAT'
  | 'SYSTEM';

// ── External delivery provider ──────────────────────────────────────────────
export type DeliveryProvider =
  | 'SENDGRID'
  | 'TWILIO'
  | 'META_WHATSAPP'
  | 'SMTP'
  | 'SYSTEM'
  | 'MANUAL'
  | 'MAILGUN';

// ── Delivery attempt lifecycle states ───────────────────────────────────────
export type DeliveryStatus =
  | 'QUEUED'
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'BOUNCED'
  | 'FAILED';

// ── Overall message status ──────────────────────────────────────────────────
export type MessageStatus =
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'RECEIVED'
  | 'LOGGED'
  | 'DRAFT_PENDING_APPROVAL';

// ── Type of communication ───────────────────────────────────────────────────
export type CommunicationType = 'EXTERNAL' | 'INTERNAL_NOTE' | 'SYSTEM_EVENT';
export type ApprovalState = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

// ── Subject context types ───────────────────────────────────────────────────
export type SubjectEntityType =
  | 'POLICY'
  | 'CLAIM'
  | 'ACCOUNT'
  | 'QUOTE'
  | 'INVOICE'
  | 'PARTY'
  | 'CASE';

// ── Participant roles ───────────────────────────────────────────────────────
export type ParticipantRole =
  | 'POLICYHOLDER'
  | 'BROKER'
  | 'ADJUSTER'
  | 'UNDERWRITER'
  | 'INTERNAL'
  | 'CLAIMANT'
  | 'INSURED'
  | 'PAYER';

// ── Resolved recipient (output of the RecipientResolver) ────────────────────
export interface ResolvedRecipient {
  participantId: string;
  contactName: string;
  role: ParticipantRole;
  channel: CommunicationChannel;
  address: string; // email or phone number
  consent: boolean;
  recipientClass?: 'EXTERNAL' | 'INTERNAL';
  groupLabel?: string;
  source?: 'participant' | 'policy' | 'claim' | 'account' | 'internal';
  preferredChannel?: CommunicationChannel;
  disabledReason?: string;
  isPrimary?: boolean;
}

export interface CommunicationAttachmentRef {
  filename: string;
  size?: number;
  mimetype?: string;
  url?: string;
  storageUri?: string;
  contentBase64?: string;
}

export interface CommunicationApprovalMeta {
  state: ApprovalState;
  requestedBy?: string;
  requestedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  reason?: string;
}

export interface CommunicationTemplateMeta {
  templateId: string;
  templateName?: string;
  variables?: Record<string, unknown>;
  renderedBody?: string;
  renderedSubject?: string | null;
  missingVariables?: string[];
  approvalRequired?: boolean;
}

export interface CommunicationExternalRefs {
  providerMessageId?: string;
  providerTemplateId?: string;
  template?: CommunicationTemplateMeta;
  approval?: CommunicationApprovalMeta;
  replyToMessageId?: string;
  cc?: string[];
  bcc?: string[];
  renderedHtml?: string;
  trigger?: string;
  templateKey?: string;
  /** Staff client-file note shared across the tenant (ABY-466). */
  accountClientNote?: boolean;
}

// ── Delivery result (output of a provider adapter) ──────────────────────────
export interface DeliveryResult {
  status: DeliveryStatus;
  externalId?: string;
  errorCode?: string;
  errorDetail?: string;
  sentAt?: Date;
  deliveredAt?: Date;
}

// ── Send message input (app-layer command input) ────────────────────────────
export interface SendMessageInput {
  entityType: string;
  entityId: string;
  primaryPartyId?: string;
  direction: MessageDirection;
  channel: CommunicationChannel;
  provider: string;
  communicationType?: CommunicationType;
  fromActor: string;
  toRecipients: string[];
  subject?: string;
  body?: string;
  attachments?: CommunicationAttachmentRef[];
  status?: MessageStatus;
  templateId?: string;
  templateVariables?: Record<string, unknown>;
  templateName?: string;
  renderedBody?: string;
  renderedSubject?: string | null;
  missingVariables?: string[];
  approvalRequired?: boolean;
  approvalState?: ApprovalState;
  externalRefs?: CommunicationExternalRefs;
  idempotencyKey?: string;
  // Claim-specific instrumentation context
  claimMeta?: {
    communicationType?: string;
    partyType?: string;
  };
}
