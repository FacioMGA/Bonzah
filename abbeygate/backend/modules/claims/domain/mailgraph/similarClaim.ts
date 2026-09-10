/**
 * SimilarClaim — Week-2 graph-derived output (ADR-0041).
 *
 * Populated by `findSimilarClaims` (pipeline step 9) after Neo4j upsert
 * and the three named Cypher similarity queries.  Persisted in
 * `claim_memory_projections.similarClaims` (JSONB array).  The Claim
 * Workspace co-pilot card renders this directly; the
 * `operator.find_similar_claims` MCP tool returns it verbatim.
 *
 * `evidenceCitationIds` references citations attached to events inside
 * the same projection's `memoryObject` — the UI dereferences these to
 * show the cited email line for each "reason".
 */

export type SimilarClaimReasonCode =
  | 'SHARED_REPAIRER'
  | 'SHARED_BROKER'
  | 'SHARED_VEHICLE'
  | 'SAME_MISSING_DOC_PATTERN'
  | 'SAME_AUTHORITY_ESCALATION_PATTERN'
  | 'SAME_LIABILITY_POSITION_TRAJECTORY';

export interface SimilarClaimReason {
  code: SimilarClaimReasonCode;
  detail?: string;
}

export interface SimilarClaim {
  claimId: string;
  score: number;
  reasons: SimilarClaimReason[];
  evidenceCitationIds: string[];
  generatedAt: string;
}
