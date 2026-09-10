/**
 * analyzeClaimMemory — read-only LLM synthesis over the cached
 * ClaimMemoryProjection (ADR-0041 §7).
 *
 * "LLM synthesis over projection signals + similar claims; citation
 *  verifier (flag-and-return); operator sees `citation_warning: true`
 *  for uncited claims."
 *
 * Implementation:
 *   1. Load the cached projection via `getClaimMemory`.
 *   2. Collect every citation referenced by the projection +
 *      similar-claim evidence.
 *   3. Run the citation verifier against the canonical CommunicationMessage
 *      rows for this claim.
 *   4. If any citations fail to verify, set `citation_warning: true`
 *      (flag-and-return; the consumer keeps the analysis).
 *   5. Compose a short structured narrative + recommended next steps.
 *      (V1 produces a deterministic narrative from the projection signals
 *      to avoid a second LLM round-trip per analyze call.  A future
 *      enhancement can swap in a LLM summarizer behind the same shape.)
 *   6. Emit a CLAIM_MEMORY.CITATION_WARNING audit row when warnings fire.
 */

import { AuditLogger } from '../../../../platform/audit/logger.js';
import type {
  ClaimMemoryCitation,
  ClaimMemoryObject,
} from '../../domain/mailgraph/claimMemoryObject.js';
import type { SimilarClaim } from '../../domain/mailgraph/similarClaim.js';
import { verifyCitations, type VerificationReport } from '../../infra/mailgraph/citationVerifier.js';
import { getClaimMemory } from './getClaimMemory.js';

export interface AnalyzeClaimMemoryInput {
  claimId: string;
  question?: string;
  maxRecommendations?: number;
}

export interface AnalyzeClaimMemoryOutput {
  ok: true;
  status: 'completed' | 'absent';
  claimId: string;
  citationWarning: boolean;
  verification?: {
    totalChecked: number;
    supportedCount: number;
    unsupportedReasons: Array<{ messageId: string; reason: string }>;
    rate: number;
  };
  narrative: string;
  highlights: {
    missingInformation: ClaimMemoryObject['missingInformation'];
    authorityFlags: ClaimMemoryObject['authorityFlags'];
    recommendedActions: ClaimMemoryObject['recommendedActions'];
    similarClaims: SimilarClaim[];
  } | null;
  stalenessWarning: boolean;
  lastRefreshedAt: string | null;
}

function collectCitations(memory: ClaimMemoryObject, similar: SimilarClaim[]): ClaimMemoryCitation[] {
  const accumulator: ClaimMemoryCitation[] = [];
  for (const event of memory.timeline) {
    if (event.citation) accumulator.push(event.citation);
  }
  for (const flag of memory.authorityFlags) {
    if (flag.citation) accumulator.push(flag.citation);
  }
  for (const row of memory.missingInformation) {
    if (row.requestCitation) accumulator.push(row.requestCitation);
    if (row.receivedCitation) accumulator.push(row.receivedCitation);
  }
  for (const action of memory.recommendedActions) {
    for (const c of action.basedOnCitations) accumulator.push(c);
  }
  // similarClaims carry evidenceCitationIds (string ids back to projection citations);
  // V1 does not re-verify those — the underlying citations are already covered
  // by the projection's own timeline / flags / actions.
  void similar;
  return accumulator;
}

function buildNarrative(memory: ClaimMemoryObject, similar: SimilarClaim[], question?: string): string {
  const lines: string[] = [];
  if (question) lines.push(`Question: ${question}`);

  const lastLiability = memory.liabilityPositions[memory.liabilityPositions.length - 1];
  if (lastLiability) {
    lines.push(`Latest liability position: ${lastLiability.position} (${lastLiability.date.slice(0, 10)}).`);
  }

  if (memory.authorityFlags.length > 0) {
    const codes = memory.authorityFlags.map((f) => f.code.replace(/_/g, ' ').toLowerCase()).join('; ');
    lines.push(`Authority flags: ${codes}.`);
  }

  if (memory.missingInformation.length > 0) {
    const outstanding = memory.missingInformation.filter((r) => !r.received).map((r) => r.documentType.replace(/_/g, ' '));
    if (outstanding.length > 0) {
      lines.push(`Outstanding documents: ${outstanding.join(', ')}.`);
    }
  }

  if (similar.length > 0) {
    const top = similar[0];
    const reasons = top.reasons.map((r) => r.code.replace(/_/g, ' ').toLowerCase()).join(', ');
    lines.push(`Closest similar claim: ${top.claimId} (score ${top.score}; reasons: ${reasons}).`);
  }

  if (lines.length === 0) {
    lines.push('No structured signals available yet \u2014 consider refreshing the projection.');
  }

  return lines.join(' ');
}

export async function analyzeClaimMemory(input: AnalyzeClaimMemoryInput): Promise<AnalyzeClaimMemoryOutput> {
  const memory = await getClaimMemory({ claimId: input.claimId });
  if (!memory) {
    return {
      ok: true,
      status: 'absent',
      claimId: input.claimId,
      citationWarning: false,
      narrative: `Claim memory has not been computed for ${input.claimId} yet. Run operator.refresh_claim_memory to populate it.`,
      highlights: null,
      stalenessWarning: false,
      lastRefreshedAt: null,
    };
  }

  const memoryObject = memory.projection.memoryObject;
  const similar = memory.projection.similarClaims;

  const citations = collectCitations(memoryObject, similar);
  let verification: VerificationReport | undefined;
  let citationWarning = false;
  if (citations.length > 0) {
    verification = await verifyCitations({ claimId: input.claimId, citations });
    citationWarning = verification.unsupported.length > 0;
    if (citationWarning) {
      void AuditLogger.log(
        input.claimId,
        'CLAIM',
        'CLAIM_MEMORY.CITATION_WARNING',
        'claim-memory-analyzer',
        'SYSTEM',
        {
          unsupportedCount: verification.unsupported.length,
          totalChecked: verification.totalChecked,
          rate: verification.rate,
        },
      );
    }
  }

  const maxRecs = input.maxRecommendations ?? 5;

  return {
    ok: true,
    status: 'completed',
    claimId: input.claimId,
    citationWarning,
    verification: verification
      ? {
          totalChecked: verification.totalChecked,
          supportedCount: verification.supportedCount,
          rate: verification.rate,
          unsupportedReasons: verification.unsupported.map((u) => ({
            messageId: u.citation.messageId,
            reason: u.reason ?? 'unknown',
          })),
        }
      : undefined,
    narrative: buildNarrative(memoryObject, similar, input.question),
    highlights: {
      missingInformation: memoryObject.missingInformation,
      authorityFlags: memoryObject.authorityFlags,
      recommendedActions: memoryObject.recommendedActions.slice(0, maxRecs),
      similarClaims: similar,
    },
    stalenessWarning: memory.stalenessWarning,
    lastRefreshedAt: memory.projection.lastRefreshedAt ? memory.projection.lastRefreshedAt.toISOString() : null,
  };
}
