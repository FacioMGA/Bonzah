/**
 * citationVerifier — TS port of `experiments/org2vec-mailgraph/src/org2vec/rag/verify.py`
 * adapted to the Abbeygate Claim Memory contract (ADR-0041).
 *
 * Spec contract:
 *   "Citations that fail the verifier (the quote substring does not
 *    appear in the cited message) are FLAGGED in the projection, not
 *    silently dropped — the UI surfaces `citation_warning: true` on
 *    affected rows."
 *
 * The verifier is therefore intentionally non-destructive at V1.  It
 * returns a `VerificationReport` that the consumer (`analyze_claim_memory`
 * MCP tool) uses to:
 *   - set `citation_warning: true` on responses with any unsupported
 *     citations,
 *   - emit a `CLAIM_MEMORY.CITATION_WARNING` audit row when warnings
 *     fire,
 *   - drop OR keep individual claims at the consumer's discretion (the
 *     analyze tool keeps them; future preview_claim_reply will drop them).
 */

import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import type { ClaimMemoryCitation } from '../../domain/mailgraph/claimMemoryObject.js';

export interface VerifyCitationInput {
  claimId: string;
  citations: ClaimMemoryCitation[];
}

export interface CitationCheck {
  citation: ClaimMemoryCitation;
  supported: boolean;
  reason?: 'message_not_found' | 'thread_mismatch' | 'quote_not_in_body' | 'empty_body';
}

export interface VerificationReport {
  totalChecked: number;
  supportedCount: number;
  unsupported: CitationCheck[];
  rate: number;
}

function normaliseQuote(quote: string): string {
  return quote.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normaliseBody(body: string | null | undefined): string {
  return String(body || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function verifyCitations(input: VerifyCitationInput): Promise<VerificationReport> {
  const unique = new Map<string, ClaimMemoryCitation>();
  for (const c of input.citations) {
    if (!c?.messageId || !c?.threadId) continue;
    const key = `${c.messageId}|${c.threadId}|${c.quote}`;
    if (!unique.has(key)) unique.set(key, c);
  }
  const distinct = Array.from(unique.values());
  if (distinct.length === 0) {
    return { totalChecked: 0, supportedCount: 0, unsupported: [], rate: 1 };
  }

  const messageIds = Array.from(new Set(distinct.map((c) => c.messageId)));
  const messages = await tenantScopedPrisma.communicationMessage.findMany({
    where: {
      id: { in: messageIds },
      thread: { entityType: 'CLAIM', entityId: input.claimId },
    },
    select: { id: true, threadId: true, body: true },
  });
  const byMessageId = new Map(messages.map((m) => [m.id, m]));

  const unsupported: CitationCheck[] = [];
  let supportedCount = 0;
  for (const citation of distinct) {
    const message = byMessageId.get(citation.messageId);
    if (!message) {
      unsupported.push({ citation, supported: false, reason: 'message_not_found' });
      continue;
    }
    if (message.threadId !== citation.threadId) {
      unsupported.push({ citation, supported: false, reason: 'thread_mismatch' });
      continue;
    }
    const body = normaliseBody(message.body);
    if (!body) {
      unsupported.push({ citation, supported: false, reason: 'empty_body' });
      continue;
    }
    const quote = normaliseQuote(citation.quote);
    if (!quote || !body.includes(quote)) {
      unsupported.push({ citation, supported: false, reason: 'quote_not_in_body' });
      continue;
    }
    supportedCount += 1;
  }

  return {
    totalChecked: distinct.length,
    supportedCount,
    unsupported,
    rate: distinct.length === 0 ? 1 : supportedCount / distinct.length,
  };
}
