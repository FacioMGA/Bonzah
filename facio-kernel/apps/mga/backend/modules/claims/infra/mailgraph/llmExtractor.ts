/**
 * llmExtractor.ts — Week 2 LLM extraction layer (ADR-0041 §5).
 *
 * Sends redacted thread bodies to OpenAI chat completions with a
 * strict Zod-validated JSON response schema.  Returns events + entities
 * with citation pointers back to the canonical CommunicationMessage.
 *
 * Implementation notes:
 *   - Uses `fetch` directly (matches `openaiEmbedder.ts`); no SDK
 *     dependency.
 *   - Reads `OPENAI_API_KEY` lazily.  If missing, the extractor returns
 *     `{ ok: false, reason: 'llm_disabled' }` so deterministic extraction
 *     still runs.
 *   - The redacted prompt NEVER contains raw PII; pseudonyms are stable
 *     per thread (see `redactPii.ts`).
 *   - Response validation is strict: any field outside the schema fails
 *     parsing and the layer returns `{ ok: false, reason: 'schema_invalid' }`.
 *   - On HTTP / timeout / 5xx failures we degrade silently to the
 *     deterministic-only output; the projection is still written with
 *     a `partialExtraction` warning.
 */

import { z } from 'zod';
import { logger } from '../../../../platform/utils/logger.js';
import type {
  ClaimMemoryEntityRef,
  ClaimMemoryEvent,
  ClaimMemoryEventType,
} from '../../domain/mailgraph/claimMemoryObject.js';
import type { RedactedThread } from '../../app/mailgraph/redactPii.js';

const MODEL = process.env.CLAIM_MEMORY_LLM_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = Number(process.env.CLAIM_MEMORY_LLM_TIMEOUT_MS || 20_000);

const CitationSchema = z.object({
  threadId: z.string().min(1),
  messageId: z.string().min(1),
  quote: z.string().min(1).max(500),
});

const EventSchema = z
  .object({
    type: z.enum([
      'fnol',
      'estimate_received',
      'estimate_revised',
      'doc_request',
      'doc_received',
      'liability_position',
      'reserve_change',
      'payment_made',
      'recovery_received',
      'escalation',
      'closure',
      'reopen',
      'note',
      'communication',
    ]),
    date: z.string().min(1),
    amount: z.number().optional(),
    currency: z.string().max(8).optional(),
    documentType: z.string().max(64).optional(),
    position: z.enum(['accepted', 'denied', 'reserved', 'partial']).optional(),
    reasonCode: z.string().max(64).optional(),
    summary: z.string().max(300).optional(),
    citation: CitationSchema,
  })
  .strict();

const EntitySchema = z
  .object({
    type: z.enum(['repairer', 'broker', 'vehicle', 'third_party', 'witness', 'lawyer', 'adjuster']),
    normalizedName: z.string().max(120).optional(),
    vehicleRegHash: z.string().max(120).optional(),
    citation: CitationSchema,
  })
  .strict();

const ResponseSchema = z
  .object({
    events: z.array(EventSchema).max(50).default([]),
    entities: z.array(EntitySchema).max(50).default([]),
  })
  .strict();

export type ExtractedEvent = z.infer<typeof EventSchema>;
export type ExtractedEntity = z.infer<typeof EntitySchema>;
export type LlmExtractionResult =
  | { ok: true; events: ClaimMemoryEvent[]; entities: ClaimMemoryEntityRef[] }
  | { ok: false; reason: 'llm_disabled' | 'http_error' | 'schema_invalid' | 'timeout'; message?: string };

const SYSTEM_PROMPT = [
  'You are an insurance claims-extraction assistant for a Lloyd\'s MGA back office.',
  'You receive ONE email thread that belongs to a specific claim.  The PII has',
  'already been replaced with stable pseudonyms (for example [PERSON_01],',
  '[EMAIL_01], [VEHICLE_REG_01]).  Treat pseudonyms as opaque identifiers.',
  '',
  'Extract events + entities according to the JSON schema you receive.',
  'Every event and entity MUST carry a `citation` referencing the source message',
  'by its messageId from the thread payload, with a verbatim `quote` that appears',
  'in that message\'s redacted body.  Do not invent events.  Do not include any',
  'event you cannot cite.  Return an empty array rather than guess.',
  '',
  'Response MUST be JSON matching the supplied schema exactly — no commentary,',
  'no markdown, no extra fields.  If no events are present, return `{"events":[],"entities":[]}`.',
].join(' ');

interface ExtractInput {
  thread: RedactedThread;
}

function buildUserPrompt(thread: RedactedThread): string {
  const messages = thread.messages.map((m) => ({
    messageId: m.messageId,
    threadId: m.threadId,
    sentAt: m.sentAt,
    direction: m.direction,
    senderRole: m.senderRole,
    subject: m.redactedSubject,
    body: m.redactedBodyText,
  }));
  return JSON.stringify({ threadId: thread.threadId, messages });
}

function asMemoryEvent(extracted: ExtractedEvent): ClaimMemoryEvent {
  return {
    type: extracted.type as ClaimMemoryEventType,
    date: extracted.date,
    amount: extracted.amount,
    currency: extracted.currency,
    documentType: extracted.documentType,
    position: extracted.position,
    reasonCode: extracted.reasonCode,
    summary: extracted.summary,
    citation: extracted.citation,
    derivedFrom: 'llm',
  };
}

function asMemoryEntity(extracted: ExtractedEntity): ClaimMemoryEntityRef {
  return {
    type: extracted.type,
    normalizedName: extracted.normalizedName,
    vehicleRegHash: extracted.vehicleRegHash,
    citations: [extracted.citation],
    derivedFrom: 'llm',
  };
}

export async function extractFromThreadWithLlm(input: ExtractInput): Promise<LlmExtractionResult> {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return { ok: false, reason: 'llm_disabled' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(input.thread) },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { ok: false, reason: 'http_error', message: `HTTP ${response.status} ${text.slice(0, 200)}` };
    }

    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json?.choices?.[0]?.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return { ok: false, reason: 'schema_invalid', message: err instanceof Error ? err.message : 'parse_error' };
    }
    const validated = ResponseSchema.safeParse(parsed);
    if (!validated.success) {
      return { ok: false, reason: 'schema_invalid', message: validated.error.issues.slice(0, 3).map((i) => i.message).join('; ') };
    }
    return {
      ok: true,
      events: validated.data.events.map(asMemoryEvent),
      entities: validated.data.entities.map(asMemoryEntity),
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: `timeout_${TIMEOUT_MS}ms` };
    }
    logger.warn(
      { event: 'claim_memory.llm_extract_failed', err: err instanceof Error ? err.message : String(err) },
      'claim_memory.llm_extract_failed',
    );
    return { ok: false, reason: 'http_error', message: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
