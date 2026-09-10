/**
 * extractThreadAnalyses — pipeline steps 5 + 6 (ADR-0041).
 *
 * Week 1 ships the deterministic regex-only path.  Each NormalizedMessage
 * is scanned for: money amounts, doc requests, doc-received signals,
 * liability positions, bodily-injury cues, repairer/broker references in
 * the sender domain.  Every event/entity carries a citation back to the
 * canonical `CommunicationMessage` row.
 *
 * Week 2 will add the LLM extractor (`llmExtractor.ts`) under a strict
 * Zod-validated JSON schema; this orchestrator merges deterministic +
 * LLM outputs and tags each event/entity with `derivedFrom`.
 */

import type {
  ClaimMemoryCitation,
  ClaimMemoryEntityRef,
  ClaimMemoryEvent,
} from '../../domain/mailgraph/claimMemoryObject.js';
import type { ThreadAnalysis } from '../../domain/mailgraph/threadAnalysis.js';
import type { RedactedMessage, RedactedThread } from './redactPii.js';
import { extractFromThreadWithLlm } from '../../infra/mailgraph/llmExtractor.js';

interface ExtractInput {
  threads: RedactedThread[];
  /** Pass `false` to bypass the LLM layer entirely (used by Week-1 tests). */
  enableLlm?: boolean;
}

// "EUR 30,000", "30,000 EUR", "€ 30,000", "30000 euros"
const AMOUNT_REGEX = /(?:(EUR|GBP|USD|€|£|\$)\s?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?))|((\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s?(EUR|GBP|USD|euros|euro|pounds|dollars))/i;

const DOC_REQUEST_PATTERNS: Array<{ regex: RegExp; documentType: string }> = [
  { regex: /\b(?:please\s+(?:send|provide|forward|share|attach)|kindly\s+(?:send|provide|forward))\b[^.\n]*\bpolice\s+report\b/i, documentType: 'police_report' },
  { regex: /\b(?:please\s+(?:send|provide|forward|share|attach)|kindly\s+(?:send|provide|forward))\b[^.\n]*\bestimate\b/i, documentType: 'estimate' },
  { regex: /\b(?:please\s+(?:send|provide|forward|share|attach)|kindly\s+(?:send|provide|forward))\b[^.\n]*\bphoto(?:graph)?s?\b/i, documentType: 'photographs' },
  { regex: /\b(?:please\s+(?:send|provide|forward|share|attach)|kindly\s+(?:send|provide|forward))\b[^.\n]*\bwitness\s+statement\b/i, documentType: 'witness_statement' },
  { regex: /\b(?:please\s+(?:send|provide|forward|share|attach)|kindly\s+(?:send|provide|forward))\b[^.\n]*\binvoice\b/i, documentType: 'invoice' },
  { regex: /\b(?:please\s+(?:send|provide|forward|share|attach)|kindly\s+(?:send|provide|forward))\b[^.\n]*\bmedical\s+(?:report|certificate|records?)\b/i, documentType: 'medical_report' },
];

const DOC_RECEIVED_PATTERNS: Array<{ regex: RegExp; documentType: string }> = [
  { regex: /\battach(?:ed|ing)\b[^.\n]*\bpolice\s+report\b/i, documentType: 'police_report' },
  { regex: /\battach(?:ed|ing)\b[^.\n]*\bestimate\b/i, documentType: 'estimate' },
  { regex: /\battach(?:ed|ing)\b[^.\n]*\bphoto(?:graph)?s?\b/i, documentType: 'photographs' },
  { regex: /\battach(?:ed|ing)\b[^.\n]*\bwitness\s+statement\b/i, documentType: 'witness_statement' },
  { regex: /\battach(?:ed|ing)\b[^.\n]*\binvoice\b/i, documentType: 'invoice' },
  { regex: /\battach(?:ed|ing)\b[^.\n]*\bmedical\b/i, documentType: 'medical_report' },
  { regex: /\bplease\s+find\s+(?:attached|enclosed)\b[^.\n]*\bestimate\b/i, documentType: 'estimate' },
  { regex: /\bplease\s+find\s+(?:attached|enclosed)\b[^.\n]*\bpolice\s+report\b/i, documentType: 'police_report' },
];

const LIABILITY_PATTERNS: Array<{ regex: RegExp; position: 'accepted' | 'denied' | 'reserved' | 'partial' }> = [
  { regex: /\bwe\s+(?:reserve|reserved)\s+(?:our|the)?\s*position\s+(?:on|regarding)\s+liability\b/i, position: 'reserved' },
  { regex: /\bliability\s+(?:is\s+)?(?:reserved|under\s+investigation)\b/i, position: 'reserved' },
  { regex: /\bwe\s+(?:hereby\s+)?(?:accept|admit)\s+(?:full\s+)?liability\b/i, position: 'accepted' },
  { regex: /\bliability\s+(?:is\s+)?(?:accepted|admitted)\b/i, position: 'accepted' },
  { regex: /\bwe\s+(?:hereby\s+)?(?:deny|reject|repudiate)\s+liability\b/i, position: 'denied' },
  { regex: /\bliability\s+(?:is\s+)?denied\b/i, position: 'denied' },
  { regex: /\bpartial\s+liability\b/i, position: 'partial' },
];

const BODILY_INJURY_PATTERN = /\b(?:bodily\s+injury|personal\s+injury|whiplash|hospital\s+admission|injuries?\s+sustained)\b/i;

const ESCALATION_PATTERNS: Array<{ regex: RegExp; reasonCode: string }> = [
  { regex: /\bexceeds?\s+(?:our\s+)?(?:authority|delegated\s+authority|binder\s+authority)\b/i, reasonCode: 'EXCEEDS_AUTHORITY' },
  { regex: /\brefer(?:red|ral)?\s+to\s+(?:lloyd'?s|capacity\s+provider|underwriter)\b/i, reasonCode: 'REFERRED_TO_CARRIER' },
  { regex: /\bclaim\s+(?:to\s+be\s+)?(?:escalated|escalation)\b/i, reasonCode: 'GENERAL_ESCALATION' },
  { regex: /\blitigation\s+(?:indicated|threatened|proceedings)\b/i, reasonCode: 'LITIGATION' },
];

function citationFor(message: RedactedMessage, snippet: string): ClaimMemoryCitation {
  const start = message.redactedBodyText.indexOf(snippet);
  return {
    threadId: message.threadId,
    messageId: message.messageId,
    quote: snippet.length > 240 ? `${snippet.slice(0, 237)}...` : snippet,
    charOffsetStart: start >= 0 ? start : undefined,
    charOffsetEnd: start >= 0 ? start + snippet.length : undefined,
  };
}

function lineAround(text: string, idx: number, length: number): string {
  if (idx < 0) return '';
  const lineStart = text.lastIndexOf('\n', idx) + 1;
  const lineEnd = text.indexOf('\n', idx + length);
  return text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
}

function parseAmount(message: RedactedMessage): { amount: number; currency: string; line: string } | null {
  const match = AMOUNT_REGEX.exec(message.redactedBodyText);
  if (!match) return null;
  const [whole, prefixCurrency, prefixNumber, , suffixNumber, suffixCurrency] = match;
  const rawAmount = (prefixNumber ?? suffixNumber ?? '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.');
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount)) return null;
  const currencyRaw = (prefixCurrency ?? suffixCurrency ?? '').toUpperCase();
  const currency = currencyRaw === '€' ? 'EUR' : currencyRaw === '£' ? 'GBP' : currencyRaw === '$' ? 'USD' : currencyRaw.startsWith('EURO') ? 'EUR' : currencyRaw.startsWith('POUND') ? 'GBP' : currencyRaw.startsWith('DOLLAR') ? 'USD' : currencyRaw;
  const line = lineAround(message.redactedBodyText, match.index, whole.length);
  return { amount, currency: currency || 'EUR', line };
}

function extractFromMessage(message: RedactedMessage): { events: ClaimMemoryEvent[]; entities: ClaimMemoryEntityRef[] } {
  const events: ClaimMemoryEvent[] = [];
  const entities: ClaimMemoryEntityRef[] = [];

  const amount = parseAmount(message);
  if (amount && /\bestimate\b/i.test(message.redactedBodyText)) {
    events.push({
      type: 'estimate_received',
      date: message.sentAt,
      amount: amount.amount,
      currency: amount.currency,
      summary: amount.line,
      citation: citationFor(message, amount.line),
      derivedFrom: 'regex',
    });
  }

  for (const { regex, documentType } of DOC_REQUEST_PATTERNS) {
    const match = regex.exec(message.redactedBodyText);
    if (match) {
      const line = lineAround(message.redactedBodyText, match.index, match[0].length);
      events.push({
        type: 'doc_request',
        date: message.sentAt,
        documentType,
        summary: line,
        citation: citationFor(message, line),
        derivedFrom: 'regex',
      });
    }
  }

  for (const { regex, documentType } of DOC_RECEIVED_PATTERNS) {
    const match = regex.exec(message.redactedBodyText);
    if (match) {
      const line = lineAround(message.redactedBodyText, match.index, match[0].length);
      events.push({
        type: 'doc_received',
        date: message.sentAt,
        documentType,
        summary: line,
        citation: citationFor(message, line),
        derivedFrom: 'regex',
      });
    }
  }

  for (const { regex, position } of LIABILITY_PATTERNS) {
    const match = regex.exec(message.redactedBodyText);
    if (match) {
      const line = lineAround(message.redactedBodyText, match.index, match[0].length);
      events.push({
        type: 'liability_position',
        date: message.sentAt,
        position,
        summary: line,
        citation: citationFor(message, line),
        derivedFrom: 'regex',
      });
    }
  }

  for (const { regex, reasonCode } of ESCALATION_PATTERNS) {
    const match = regex.exec(message.redactedBodyText);
    if (match) {
      const line = lineAround(message.redactedBodyText, match.index, match[0].length);
      events.push({
        type: 'escalation',
        date: message.sentAt,
        reasonCode,
        summary: line,
        citation: citationFor(message, line),
        derivedFrom: 'regex',
      });
    }
  }

  if (BODILY_INJURY_PATTERN.test(message.redactedBodyText)) {
    const match = BODILY_INJURY_PATTERN.exec(message.redactedBodyText);
    if (match) {
      const line = lineAround(message.redactedBodyText, match.index, match[0].length);
      events.push({
        type: 'escalation',
        date: message.sentAt,
        reasonCode: 'BODILY_INJURY_PRESENT',
        summary: line,
        citation: citationFor(message, line),
        derivedFrom: 'regex',
      });
    }
  }

  // Repairer / broker hint from sender domain (low signal but free).
  if (message.senderRole === 'repairer' && message.senderDomain) {
    entities.push({
      type: 'repairer',
      normalizedName: message.senderDomain,
      citations: [citationFor(message, message.redactedSubject || message.senderDomain)],
      derivedFrom: 'regex',
    });
  }
  if (message.senderRole === 'broker' && message.senderDomain) {
    entities.push({
      type: 'broker',
      normalizedName: message.senderDomain,
      citations: [citationFor(message, message.redactedSubject || message.senderDomain)],
      derivedFrom: 'regex',
    });
  }

  return { events, entities };
}

export async function extractThreadAnalyses(input: ExtractInput): Promise<ThreadAnalysis[]> {
  const enableLlm = input.enableLlm !== false;

  return Promise.all(
    input.threads.map(async (thread) => {
      const deterministic = thread.messages.reduce<{ events: ClaimMemoryEvent[]; entities: ClaimMemoryEntityRef[] }>(
        (acc, message) => {
          const extracted = extractFromMessage(message);
          acc.events.push(...extracted.events);
          acc.entities.push(...extracted.entities);
          return acc;
        },
        { events: [], entities: [] },
      );

      let llmEvents: ClaimMemoryEvent[] = [];
      let llmEntities: ClaimMemoryEntityRef[] = [];
      let partial: ThreadAnalysis['partial'];

      if (enableLlm) {
        const llmResult = await extractFromThreadWithLlm({ thread });
        if (llmResult.ok) {
          llmEvents = llmResult.events;
          llmEntities = llmResult.entities;
        } else if (llmResult.reason !== 'llm_disabled') {
          partial = { llmFailed: true, failureCode: llmResult.reason };
        }
      }

      const events = [...deterministic.events, ...llmEvents];
      const entities = [...deterministic.entities, ...llmEntities];

      return {
        threadId: thread.threadId,
        messageCount: thread.messages.length,
        firstMessageAt: thread.firstActivityAt,
        lastMessageAt: thread.lastActivityAt,
        events,
        entities,
        citationsConsidered: events.flatMap((event) => (event.citation ? [event.citation] : [])),
        partial,
      };
    }),
  );
}
