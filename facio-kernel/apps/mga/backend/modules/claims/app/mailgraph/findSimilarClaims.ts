/**
 * findSimilarClaims — pipeline step 9 (ADR-0041).
 *
 * Runs the three named V1 Cypher queries and merges their results into
 * a single ranked `SimilarClaim[]` + flattened `GraphSignals`.  All
 * three are READ queries — they never write to Neo4j; only step 8
 * (`upsertClaimGraph`) writes.
 *
 * Scoring: simple additive — each shared entity, missing-doc match, or
 * escalation match adds 1.0 to the candidate's score; the max score
 * across queries wins.  Top-5 returned.  This is intentionally coarse
 * for V1; future PRs can swap in a weighted scorer behind the same
 * `SimilarClaim` shape without UI changes.
 *
 * Graceful degradation: if Neo4j is unreachable, returns empty arrays
 * with `graphAvailable=false` so the orchestrator can preserve the
 * previous projection enrichment (see `refreshClaimMemoryUseCase`).
 */

import type { GraphSignals } from '../../domain/mailgraph/graphSignals.js';
import type { SimilarClaim, SimilarClaimReason } from '../../domain/mailgraph/similarClaim.js';
import {
  executeClaimsWithEscalationPattern,
  executeClaimsWithMissingDocPattern,
  executeSimilarClaimsByEntity,
} from '../../infra/mailgraph/neo4jClaimGraphRepository.js';

export interface FindSimilarClaimsInput {
  tenantId: string;
  claimId: string;
}

export interface FindSimilarClaimsOutput {
  similarClaims: SimilarClaim[];
  graphSignals: GraphSignals;
  graphAvailable: boolean;
}

interface Candidate {
  claimId: string;
  score: number;
  reasons: SimilarClaimReason[];
}

function mergeReason(map: Map<string, Candidate>, claimId: string, reason: SimilarClaimReason, scoreDelta: number): void {
  const existing = map.get(claimId);
  if (existing) {
    existing.score += scoreDelta;
    existing.reasons.push(reason);
  } else {
    map.set(claimId, { claimId, score: scoreDelta, reasons: [reason] });
  }
}

export async function findSimilarClaims(input: FindSimilarClaimsInput): Promise<FindSimilarClaimsOutput> {
  const [entityRes, missingDocRes, escalationRes] = await Promise.all([
    executeSimilarClaimsByEntity(input),
    executeClaimsWithMissingDocPattern(input),
    executeClaimsWithEscalationPattern(input),
  ]);

  // If the FIRST query reports the driver is disabled, treat the whole
  // run as unavailable — the orchestrator will preserve the prior
  // enrichment.  We do not partially-degrade across queries.
  if (!entityRes.ok && (entityRes.reason === 'neo4j_disabled' || entityRes.reason === 'neo4j_unavailable')) {
    return { similarClaims: [], graphSignals: {}, graphAvailable: false };
  }

  const candidates = new Map<string, Candidate>();
  const sharedRepairers = new Map<string, number>();
  const sharedBrokers = new Map<string, number>();
  const sharedMissingDocs = new Map<string, number>();
  const escalationPatterns = new Map<string, number>();

  if (entityRes.ok) {
    for (const row of entityRes.data) {
      mergeReason(
        candidates,
        row.claimId,
        { code: 'SHARED_REPAIRER', detail: row.sharedSignals.join(', ') },
        row.signalCount,
      );
      for (const signal of row.sharedSignals) {
        const [labelRaw, name] = signal.split(':');
        const label = labelRaw?.toLowerCase();
        if (!name) continue;
        if (label === 'repairer') sharedRepairers.set(name, (sharedRepairers.get(name) ?? 0) + 1);
        if (label === 'broker') sharedBrokers.set(name, (sharedBrokers.get(name) ?? 0) + 1);
      }
    }
  }

  if (missingDocRes.ok) {
    for (const row of missingDocRes.data) {
      mergeReason(
        candidates,
        row.claimId,
        { code: 'SAME_MISSING_DOC_PATTERN', detail: row.sharedMissingDocs.join(', ') },
        1,
      );
      for (const doc of row.sharedMissingDocs) {
        sharedMissingDocs.set(doc, (sharedMissingDocs.get(doc) ?? 0) + 1);
      }
    }
  }

  if (escalationRes.ok) {
    for (const row of escalationRes.data) {
      mergeReason(
        candidates,
        row.claimId,
        { code: 'SAME_AUTHORITY_ESCALATION_PATTERN', detail: row.reasonCode },
        1,
      );
      escalationPatterns.set(row.reasonCode, (escalationPatterns.get(row.reasonCode) ?? 0) + 1);
    }
  }

  const generatedAt = new Date().toISOString();
  const similarClaims: SimilarClaim[] = Array.from(candidates.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((candidate) => ({
      claimId: candidate.claimId,
      score: candidate.score,
      reasons: candidate.reasons,
      evidenceCitationIds: [], // populated by analyze_claim_memory tool in Week 3
      generatedAt,
    }));

  const graphSignals: GraphSignals = {
    sharedRepairers: Array.from(sharedRepairers.entries()).map(([normalizedName, coClaimCount]) => ({ normalizedName, coClaimCount })),
    sharedBrokers: Array.from(sharedBrokers.entries()).map(([normalizedName, coClaimCount]) => ({ normalizedName, coClaimCount })),
    sharedMissingDocPatterns: Array.from(sharedMissingDocs.entries()).map(([documentType, coClaimCount]) => ({ documentType, coClaimCount })),
    escalationPatterns: Array.from(escalationPatterns.entries()).map(([reasonCode, coClaimCount]) => ({ reasonCode, coClaimCount })),
    refreshedAt: generatedAt,
  };

  return {
    similarClaims,
    graphSignals,
    graphAvailable: entityRes.ok,
  };
}
