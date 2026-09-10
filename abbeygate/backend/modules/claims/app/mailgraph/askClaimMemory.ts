/**
 * askClaimMemory — retrieval-grounded, read-only Q&A over a claim's
 * Org2Vec memory (ADR-0044).
 *
 * Feeds the projection's graph-derived similar claims into the hybrid
 * retriever as the graph channel, then answers strictly from cited
 * passages. The LLM never mutates state or decides a gate.
 */

import { answerWithCitations, type AskResult } from '../../../org2vec/index.js';
import { getClaimMemory } from './getClaimMemory.js';

export async function askClaimMemory(input: { claimId: string; question: string }): Promise<AskResult> {
  const memory = await getClaimMemory({ claimId: input.claimId });
  const graphNeighborIds = (memory?.projection.similarClaims ?? [])
    .map((s) => (s as { claimId?: string }).claimId)
    .filter((id): id is string => Boolean(id));

  return answerWithCitations({
    scopeType: 'CLAIM',
    scopeId: input.claimId,
    question: input.question,
    graphNeighborIds,
  });
}
