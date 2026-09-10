/**
 * outlookMessage — normalized Outlook/Graph email shape for Org2Vec
 * ingestion (ADR-0044).
 *
 * One canonical message shape that every ingestion adapter (sample inbox,
 * upload, live Microsoft Graph) produces, so the downstream pipeline never
 * branches on source. Pure domain — string mapping only, no IO.
 */

export interface OutlookContact {
  name?: string;
  email: string;
}

export interface OutlookAttachmentMeta {
  name: string;
  contentType?: string;
  sizeBytes?: number;
  externalId?: string;
}

/**
 * Deterministic linkage hints the source can attach (most reliable path).
 * The seed/upload payloads set these explicitly; the Graph adapter leaves
 * them empty and the pipeline falls back to regex extraction.
 */
export interface OutlookLinkHints {
  claimReference?: string;
  claimId?: string;
  policyReference?: string;
  policyId?: string;
  submissionId?: string;
  vehicleRegistration?: string;
}

export interface NormalizedOutlookMessage {
  externalMessageId: string;
  conversationId: string;
  subject: string;
  from: OutlookContact;
  to: OutlookContact[];
  cc?: OutlookContact[];
  sentAt: string;
  receivedAt?: string;
  bodyText: string;
  bodyHtml?: string;
  attachments: OutlookAttachmentMeta[];
  linkHints?: OutlookLinkHints;
}

function htmlToText(html: string): string {
  return String(html || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface GraphEmailAddress {
  emailAddress?: { name?: string; address?: string };
}

interface GraphMessage {
  id?: string;
  conversationId?: string;
  subject?: string;
  from?: GraphEmailAddress;
  sender?: GraphEmailAddress;
  toRecipients?: GraphEmailAddress[];
  ccRecipients?: GraphEmailAddress[];
  sentDateTime?: string;
  receivedDateTime?: string;
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  hasAttachments?: boolean;
  attachments?: Array<{ name?: string; contentType?: string; size?: number; id?: string }>;
}

function mapContact(addr?: GraphEmailAddress): OutlookContact | null {
  const email = String(addr?.emailAddress?.address || '').trim().toLowerCase();
  if (!email) return null;
  const name = String(addr?.emailAddress?.name || '').trim();
  return name ? { name, email } : { email };
}

function mapContacts(list?: GraphEmailAddress[]): OutlookContact[] {
  return (list ?? []).map(mapContact).filter((c): c is OutlookContact => c !== null);
}

/** Map a raw Microsoft Graph `message` resource to the normalized shape. */
export function normalizeGraphMessage(raw: GraphMessage): NormalizedOutlookMessage {
  const isHtml = String(raw.body?.contentType || '').toLowerCase() === 'html';
  const content = String(raw.body?.content || '');
  const bodyText = isHtml ? htmlToText(content) : content || String(raw.bodyPreview || '');
  const from = mapContact(raw.from) ?? mapContact(raw.sender) ?? { email: 'unknown@unknown' };
  return {
    externalMessageId: String(raw.id || '').trim(),
    conversationId: String(raw.conversationId || raw.id || '').trim(),
    subject: String(raw.subject || '').trim(),
    from,
    to: mapContacts(raw.toRecipients),
    cc: mapContacts(raw.ccRecipients),
    sentAt: String(raw.sentDateTime || raw.receivedDateTime || new Date().toISOString()),
    receivedAt: raw.receivedDateTime ? String(raw.receivedDateTime) : undefined,
    bodyText,
    bodyHtml: isHtml ? content : undefined,
    attachments: (raw.attachments ?? []).map((a) => ({
      name: String(a.name || 'attachment'),
      contentType: a.contentType,
      sizeBytes: typeof a.size === 'number' ? a.size : undefined,
      externalId: a.id,
    })),
  };
}

/** True when a value is structurally a normalized message (defensive at boundaries). */
export function isNormalizedOutlookMessage(value: unknown): value is NormalizedOutlookMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as {
    externalMessageId?: unknown;
    conversationId?: unknown;
    subject?: unknown;
    bodyText?: unknown;
    from?: unknown;
  };
  return (
    typeof v.externalMessageId === 'string' &&
    typeof v.conversationId === 'string' &&
    typeof v.subject === 'string' &&
    typeof v.bodyText === 'string' &&
    typeof v.from === 'object'
  );
}
