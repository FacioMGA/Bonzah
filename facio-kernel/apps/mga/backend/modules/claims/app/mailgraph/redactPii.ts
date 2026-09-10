/**
 * redactPii — pipeline step 4 (ADR-0041).
 *
 * Redacts personally identifying tokens before any LLM call.  Per
 * ADR-0041 §4 the model NEVER sees raw PII; only the citation
 * (`{ threadId, messageId, quote }`) is persisted, and the original
 * message is fetched through `tenantScopedPrisma` with normal
 * claim-view permissions when the operator UI renders it.
 *
 * In V1 (Week 1) this layer applies deterministic patterns and emits a
 * stable pseudonym map so downstream extraction can refer back to
 * canonical message offsets.  The map is in-memory only — it is NOT
 * persisted, NOT logged, and NOT included in the projection.
 *
 * Coverage is intentionally conservative.  False negatives (raw PII
 * leaks past redaction) are surfaced to the operator via the
 * `citation_warning` flag; false positives (over-redaction) are
 * preferred over leaks.  The redaction map lets us reverse pseudonyms
 * when authorised users view the source citation.
 */

import type { NormalizedMessage, NormalizedThread } from './normalizeThreads.js';

export type PiiTokenType = 'PERSON' | 'EMAIL' | 'PHONE' | 'ADDRESS' | 'VEHICLE_REG' | 'IBAN' | 'POLICY_REF';

export interface PiiToken {
  pseudonym: string;
  type: PiiTokenType;
  original: string;
}

export interface RedactedMessage extends NormalizedMessage {
  redactedBodyText: string;
  redactedSubject: string | null;
  piiTokens: PiiToken[];
}

export interface RedactedThread extends Omit<NormalizedThread, 'messages'> {
  messages: RedactedMessage[];
}

// Patterns intentionally conservative — better to over-redact than leak.
// `EMAIL` must come BEFORE `PERSON` because emails contain a username
// that the person pattern would match.
// Pattern order matters: more-specific patterns must run before greedier ones
// so a specific token (IBAN, VEHICLE_REG) is not partially consumed by the
// generic phone matcher (which absorbs digit-run sequences).
const PATTERNS: Array<{ type: PiiTokenType; pattern: RegExp }> = [
  { type: 'EMAIL', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: 'IBAN', pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
  { type: 'POLICY_REF', pattern: /\b(?:POL|POLICY|CERT|CR)[\s-]?[A-Z0-9-]{4,}\b/gi },
  { type: 'VEHICLE_REG', pattern: /\b[A-Z]{2,3}[\s-]?\d{3,4}[\s-]?[A-Z]?\b/g },
  { type: 'PHONE', pattern: /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}\b/g },
];

/**
 * Person-name heuristic — matches "First Last" / "First Middle Last" where
 * each token starts with an upper-case letter and is at least 2 letters.
 * Run LAST so emails / vehicle regs are already pseudonymised and won't
 * be re-matched.
 */
const PERSON_PATTERN = /\b([A-Z][a-z]{1,15}(?:\s+[A-Z][a-z]{1,15}){1,3})\b/g;

function makePseudonym(type: PiiTokenType, index: number): string {
  return `[${type}_${String(index).padStart(2, '0')}]`;
}

function redactString(input: string, accumulator: Map<string, PiiToken>, counters: Map<PiiTokenType, number>): string {
  if (!input) return input;
  let working = input;

  for (const { type, pattern } of PATTERNS) {
    working = working.replace(pattern, (match) => {
      const existing = accumulator.get(`${type}:${match.toLowerCase()}`);
      if (existing) return existing.pseudonym;
      const nextIndex = (counters.get(type) ?? 0) + 1;
      counters.set(type, nextIndex);
      const pseudonym = makePseudonym(type, nextIndex);
      accumulator.set(`${type}:${match.toLowerCase()}`, { pseudonym, type, original: match });
      return pseudonym;
    });
  }

  // Person names last so other tokens are already pseudonymised.
  working = working.replace(PERSON_PATTERN, (match) => {
    // Skip if the candidate is already inside a pseudonym (e.g. [EMAIL_01]).
    if (/^\[.*_\d+\]$/.test(match)) return match;
    const existing = accumulator.get(`PERSON:${match.toLowerCase()}`);
    if (existing) return existing.pseudonym;
    const nextIndex = (counters.get('PERSON') ?? 0) + 1;
    counters.set('PERSON', nextIndex);
    const pseudonym = makePseudonym('PERSON', nextIndex);
    accumulator.set(`PERSON:${match.toLowerCase()}`, { pseudonym, type: 'PERSON', original: match });
    return pseudonym;
  });

  return working;
}

export function redactThreads(threads: NormalizedThread[]): RedactedThread[] {
  return threads.map((thread) => {
    // One redaction map PER thread so pseudonym indices remain stable inside
    // a thread (helps the LLM keep characters consistent across messages).
    const accumulator = new Map<string, PiiToken>();
    const counters = new Map<PiiTokenType, number>();

    const messages = thread.messages.map<RedactedMessage>((message) => {
      const redactedSubject = message.subject ? redactString(message.subject, accumulator, counters) : null;
      const redactedBodyText = redactString(message.bodyText, accumulator, counters);
      return {
        ...message,
        redactedBodyText,
        redactedSubject,
        piiTokens: Array.from(accumulator.values()),
      };
    });

    return {
      threadId: thread.threadId,
      entityType: thread.entityType,
      entityId: thread.entityId,
      firstActivityAt: thread.firstActivityAt,
      lastActivityAt: thread.lastActivityAt,
      messages,
    };
  });
}
