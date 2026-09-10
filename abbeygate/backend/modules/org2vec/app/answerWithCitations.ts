/**
 * answerWithCitations — retrieval-grounded, read-only Q&A over Org2Vec
 * memory (ADR-0044).
 *
 * Used by the claims + submission "ask" endpoints. The pipeline:
 *   1. hybrid-retrieve cited passages for the scope,
 *   2. answer ONLY from those passages.
 *
 * Hard constraints (patent-relevant):
 *   - The LLM may PHRASE the retrieved evidence; it may never mutate state,
 *     decide a gate, or answer beyond the supplied passages.
 *   - Every answer is grounded in citations. With no passages, the helper
 *     refuses rather than guessing.
 *   - With no LLM configured it degrades to an extractive answer (the top
 *     passages verbatim) — still cited, still read-only.
 */

import { logger } from '../../../platform/utils/logger.js';
import { hybridRetrieve } from '../infra/hybridRetriever.js';
import type { MemoryCitation } from '../domain/memoryObject.js';

export interface AskInput {
  scopeType: 'CLAIM' | 'SUBMISSION';
  scopeId: string;
  question: string;
  graphNeighborIds?: string[];
  k?: number;
}

export interface AskResult {
  answer: string;
  citations: MemoryCitation[];
  mode: 'llm' | 'extractive' | 'no_evidence';
  channelsUsed: string[];
  passageCount: number;
}

const MODEL = process.env.CLAIM_MEMORY_LLM_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = Number(process.env.CLAIM_MEMORY_LLM_TIMEOUT_MS || 20_000);

const SYSTEM_PROMPT = [
  'You are an operational-memory assistant for an insurance back office.',
  'Answer the question ONLY using the supplied evidence passages.',
  'Cite the messageId(s) you used. If the passages do not contain the answer,',
  'say you do not have enough evidence. Never invent facts, never decide',
  'authority/coverage/gates, never propose sending anything externally.',
  'Be concise (2-4 sentences).',
].join(' ');

async function llmAnswer(question: string, passages: Array<{ messageId: string; snippet: string }>): Promise<string | null> {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const context = passages
      .map((p, i) => `[#${i + 1} messageId=${p.messageId}] ${p.snippet}`)
      .join('\n');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Question: ${question}\n\nEvidence passages:\n${context}` },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn({ event: 'org2vec.ask.llm_http', status: response.status }, 'org2vec.ask.llm_http');
      return null;
    }
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json?.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (err) {
    logger.warn({ event: 'org2vec.ask.llm_failed', err: err instanceof Error ? err.message : String(err) }, 'org2vec.ask.llm_failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractiveAnswer(passages: Array<{ snippet: string }>): string {
  const top = passages.slice(0, 3).map((p, i) => `(${i + 1}) ${p.snippet}`);
  return `Based on the operational memory:\n${top.join('\n')}`;
}

export async function answerWithCitations(input: AskInput): Promise<AskResult> {
  const retrieval = await hybridRetrieve({
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    query: input.question,
    graphNeighborIds: input.graphNeighborIds,
    k: input.k ?? 6,
  });

  if (retrieval.passages.length === 0) {
    return {
      answer:
        'I do not have evidence in the operational memory for this item yet. Ingest the relevant emails or refresh the memory, then ask again.',
      citations: [],
      mode: 'no_evidence',
      channelsUsed: retrieval.channelsUsed,
      passageCount: 0,
    };
  }

  const citations = retrieval.passages.map((p) => p.citation);
  const llm = await llmAnswer(
    input.question,
    retrieval.passages.map((p) => ({ messageId: p.messageId, snippet: p.snippet })),
  );

  return {
    answer: llm ?? extractiveAnswer(retrieval.passages),
    citations,
    mode: llm ? 'llm' : 'extractive',
    channelsUsed: retrieval.channelsUsed,
    passageCount: retrieval.passages.length,
  };
}
