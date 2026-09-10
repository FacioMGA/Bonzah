/**
 * uploadAdapter — parse uploaded/pasted Outlook exports into normalized
 * messages (ADR-0044). Demo ingestion path (no OAuth required).
 *
 * Accepts either:
 *   - a JSON array of NormalizedOutlookMessage objects (preferred), or
 *   - raw `.eml` / `.txt` RFC-822 text (best-effort header + body parse).
 */

import crypto from 'node:crypto';
import {
  isNormalizedOutlookMessage,
  type NormalizedOutlookMessage,
  type OutlookContact,
} from '../../domain/providers/outlookMessage.js';

function stableId(seed: string): string {
  return `upload:${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
}

function parseContacts(value: string | undefined): OutlookContact[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(?:"?([^"<]*)"?\s*)?<?([^<>\s]+@[^<>\s]+)>?$/);
      if (match) {
        const name = (match[1] || '').trim();
        return name ? { name, email: match[2].toLowerCase() } : { email: match[2].toLowerCase() };
      }
      return { email: part.toLowerCase() };
    });
}

/** Best-effort RFC-822 parse. Sufficient for demo `.eml`/`.txt` exports. */
export function parseEml(text: string): NormalizedOutlookMessage {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const splitAt = normalized.indexOf('\n\n');
  const headerBlock = splitAt >= 0 ? normalized.slice(0, splitAt) : normalized;
  const body = splitAt >= 0 ? normalized.slice(splitAt + 2) : '';

  const headers = new Map<string, string>();
  let lastKey = '';
  for (const rawLine of headerBlock.split('\n')) {
    if (/^\s/.test(rawLine) && lastKey) {
      headers.set(lastKey, `${headers.get(lastKey) ?? ''} ${rawLine.trim()}`);
      continue;
    }
    const idx = rawLine.indexOf(':');
    if (idx > 0) {
      const key = rawLine.slice(0, idx).trim().toLowerCase();
      headers.set(key, rawLine.slice(idx + 1).trim());
      lastKey = key;
    }
  }

  const subject = headers.get('subject') ?? '';
  const fromContacts = parseContacts(headers.get('from'));
  const messageId = (headers.get('message-id') || '').replace(/[<>]/g, '').trim() || stableId(`${subject}|${headers.get('date') ?? ''}|${body.slice(0, 64)}`);
  const conversationId =
    (headers.get('thread-index') || headers.get('references') || headers.get('in-reply-to') || '')
      .replace(/[<>]/g, '')
      .split(/\s+/)[0]
      ?.trim() || messageId;
  const dateIso = (() => {
    const d = headers.get('date');
    if (!d) return new Date().toISOString();
    const ms = Date.parse(d);
    return Number.isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString();
  })();

  return {
    externalMessageId: messageId,
    conversationId,
    subject,
    from: fromContacts[0] ?? { email: 'unknown@unknown' },
    to: parseContacts(headers.get('to')),
    cc: parseContacts(headers.get('cc')),
    sentAt: dateIso,
    bodyText: body.trim(),
    attachments: [],
  };
}

export type UploadPayload =
  | { kind: 'json'; messages: unknown[] }
  | { kind: 'eml'; files: string[] };

/** Parse an upload payload into normalized messages. Throws on empty/invalid. */
export function parseUpload(payload: UploadPayload): NormalizedOutlookMessage[] {
  if (payload.kind === 'json') {
    const out = payload.messages.filter(isNormalizedOutlookMessage);
    if (out.length === 0) {
      throw new Error('upload contained no valid NormalizedOutlookMessage objects');
    }
    return out;
  }
  const parsed = payload.files.map(parseEml).filter((m) => m.bodyText || m.subject);
  if (parsed.length === 0) {
    throw new Error('upload contained no parseable .eml/.txt messages');
  }
  return parsed;
}
