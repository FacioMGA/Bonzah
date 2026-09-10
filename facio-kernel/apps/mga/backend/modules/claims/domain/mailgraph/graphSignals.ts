/**
 * GraphSignals — Week-2 aggregated graph-derived signals (ADR-0041).
 *
 * Stored at `claim_memory_projections.graphSignals` (JSONB).  Built by
 * `findSimilarClaims` (pipeline step 9) from the same Neo4j queries that
 * populate `similarClaims`, but flattened for fast UI rendering ("this
 * claim shares repairer X with Y other claims").
 *
 * Empty defaults — `{}` — when Neo4j is unavailable or before Week 2
 * lands.  Readers MUST tolerate missing arrays.
 */

export interface GraphSignals {
  sharedRepairers?: Array<{
    normalizedName: string;
    coClaimCount: number;
  }>;
  sharedBrokers?: Array<{
    normalizedName: string;
    coClaimCount: number;
  }>;
  sharedMissingDocPatterns?: Array<{
    documentType: string;
    coClaimCount: number;
  }>;
  escalationPatterns?: Array<{
    reasonCode: string;
    coClaimCount: number;
  }>;
  refreshedAt?: string;
}
