/**
 * getClaimMemory — read-only fetch of the cached projection (ADR-0041).
 *
 * Returns the row exactly as stored.  Computes a derived
 * `staleness_warning` flag when `lastRefreshedAt` is older than the
 * configured TTL (default: 6 hours, override per call) so the Claim
 * Workspace card and the `operator.find_similar_claims` MCP tool can
 * surface stale-data banners without duplicating the rule.
 */

import type { ClaimMemoryProjectionRow } from '../../infra/mailgraph/claimMemoryProjectionRepo.js';
import { findClaimMemory } from '../../infra/mailgraph/claimMemoryProjectionRepo.js';

export interface GetClaimMemoryInput {
  claimId: string;
  /** Maximum freshness window in ms; older projections set `staleness_warning=true`. Default 6h. */
  ttlMs?: number;
}

export interface GetClaimMemoryOutput {
  projection: ClaimMemoryProjectionRow;
  stalenessWarning: boolean;
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

export async function getClaimMemory(input: GetClaimMemoryInput): Promise<GetClaimMemoryOutput | null> {
  const row = await findClaimMemory(input.claimId);
  if (!row) return null;
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const lastRefreshedAt = row.lastRefreshedAt?.getTime() ?? 0;
  const stalenessWarning = row.refreshStatus !== 'fresh' || Date.now() - lastRefreshedAt > ttlMs;
  return { projection: row, stalenessWarning };
}
