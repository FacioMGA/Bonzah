/**
 * normalizeThreads — pipeline step 3 (ADR-0041).
 *
 * Reduces raw `CommunicationMessage` rows to a canonical, extraction-ready
 * `NormalizedMessage` shape.  Strips obvious quoted-chain duplicates while
 * preserving the original messageId so citations remain stable.
 *
 * Deterministic and pure — no IO.
 */

import type { CommunicationThread, CommunicationMessage } from '@prisma/client';

export type SenderRole =
  | 'broker'
  | 'policyholder'
  | 'repairer'
  | 'adjuster'
  | 'underwriter'
  | 'internal'
  | 'third_party'
  | 'unknown';

export type Direction = 'inbound' | 'outbound' | 'internal';

export interface NormalizedAttachment {
  fileName: string;
  mimeType?: string;
  documentId?: string;
}

export interface NormalizedMessage {
  threadId: string;
  messageId: string;
  sentAt: string;
  direction: Direction;
  senderDomain: string | null;
  senderRole: SenderRole;
  subject: string | null;
  bodyText: string;
  attachments: NormalizedAttachment[];
}

export interface NormalizedThread {
  threadId: string;
  entityType: string;
  entityId: string;
  firstActivityAt: string;
  lastActivityAt: string;
  messages: NormalizedMessage[];
}

const QUOTE_BLOCK_REGEX = /(\n>+ ?[^\n]*)+|(\nOn .* wrote:[\s\S]*$)|(\n-{2,}\s*Original Message\s*-{2,}[\s\S]*$)/g;

function senderDomainOf(message: CommunicationMessage): string | null {
  const recipients = Array.isArray(message.toRecipients) ? message.toRecipients : [];
  if (message.direction === 'INBOUND') {
    const fromActor = message.fromActor || '';
    const at = fromActor.indexOf('@');
    return at >= 0 ? fromActor.substring(at + 1).toLowerCase() : null;
  }
  if (message.direction === 'OUTBOUND') {
    const first = recipients[0];
    if (typeof first === 'string') {
      const at = first.indexOf('@');
      return at >= 0 ? first.substring(at + 1).toLowerCase() : null;
    }
    if (first && typeof first === 'object' && 'email' in (first as Record<string, unknown>)) {
      const email = (first as { email?: string }).email || '';
      const at = email.indexOf('@');
      return at >= 0 ? email.substring(at + 1).toLowerCase() : null;
    }
  }
  return null;
}

/**
 * Heuristic role inference from the sender domain or channel.  Intentionally
 * conservative — anything we cannot confidently classify falls back to
 * 'unknown'.  Better signals (CommunicationParticipant.contactRole) get
 * layered in by `extractThreadAnalyses` when present.
 */
function inferSenderRole(message: CommunicationMessage, domain: string | null): SenderRole {
  if (message.direction === 'OUTBOUND' && message.fromActor === 'SYSTEM') return 'internal';
  if (message.direction === 'OUTBOUND') return 'underwriter';
  if (!domain) return 'unknown';
  if (/(repair|garage|bodyshop|workshop)/i.test(domain)) return 'repairer';
  if (/(broker)/i.test(domain)) return 'broker';
  if (/(adjuster|loss|assessor)/i.test(domain)) return 'adjuster';
  return 'unknown';
}

function stripQuotedChains(body: string): string {
  if (!body) return '';
  return body.replace(QUOTE_BLOCK_REGEX, '').trim();
}

function toAttachments(raw: unknown): NormalizedAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const e = entry as Record<string, unknown>;
    const fileName = (e.fileName || e.filename || e.name) as string | undefined;
    if (!fileName) return [];
    const mimeType = (e.mimeType || e.contentType) as string | undefined;
    const documentId = (e.documentId || e.id) as string | undefined;
    return [{ fileName, mimeType, documentId }];
  });
}

export function normalizeThreads(
  threads: Array<CommunicationThread & { messages: CommunicationMessage[] }>,
): NormalizedThread[] {
  return threads.map((thread) => {
    const messages = thread.messages.map<NormalizedMessage>((message) => {
      const domain = senderDomainOf(message);
      const directionLower: Direction =
        message.direction === 'INBOUND' ? 'inbound' : message.direction === 'OUTBOUND' ? 'outbound' : 'internal';
      return {
        threadId: thread.id,
        messageId: message.id,
        sentAt: (message.sentAt ?? message.createdAt).toISOString(),
        direction: directionLower,
        senderDomain: domain,
        senderRole: inferSenderRole(message, domain),
        subject: message.subject ?? null,
        bodyText: stripQuotedChains(message.body ?? ''),
        attachments: toAttachments(message.attachments),
      };
    });

    const firstActivity = messages[0]?.sentAt ?? thread.createdAt.toISOString();
    const lastActivity = messages[messages.length - 1]?.sentAt ?? thread.lastActivityAt.toISOString();

    return {
      threadId: thread.id,
      entityType: thread.entityType,
      entityId: thread.entityId,
      firstActivityAt: firstActivity,
      lastActivityAt: lastActivity,
      messages,
    };
  });
}
