/**
 * findSimilarClaims.test — Week 2 graph-derivation coverage (ADR-0041 §6/§9).
 *
 * Mocks the Neo4j repository helpers so the merging + scoring logic can
 * be pinned without an actual Neo4j instance.  Live Cypher behaviour is
 * verified separately in the integration harness (Week 3 chaos test).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const repoMocks = vi.hoisted(() => ({
  executeSimilarClaimsByEntity: vi.fn(),
  executeClaimsWithMissingDocPattern: vi.fn(),
  executeClaimsWithEscalationPattern: vi.fn(),
}));

vi.mock('../../../infra/mailgraph/neo4jClaimGraphRepository.js', () => ({
  executeSimilarClaimsByEntity: repoMocks.executeSimilarClaimsByEntity,
  executeClaimsWithMissingDocPattern: repoMocks.executeClaimsWithMissingDocPattern,
  executeClaimsWithEscalationPattern: repoMocks.executeClaimsWithEscalationPattern,
}));

import { findSimilarClaims } from '../findSimilarClaims.js';

describe('findSimilarClaims', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns graphAvailable=false when Neo4j is disabled', async () => {
    repoMocks.executeSimilarClaimsByEntity.mockResolvedValue({ ok: false, reason: 'neo4j_disabled' });
    repoMocks.executeClaimsWithMissingDocPattern.mockResolvedValue({ ok: false, reason: 'neo4j_disabled' });
    repoMocks.executeClaimsWithEscalationPattern.mockResolvedValue({ ok: false, reason: 'neo4j_disabled' });
    const result = await findSimilarClaims({ tenantId: 't1', claimId: 'c1' });
    expect(result.graphAvailable).toBe(false);
    expect(result.similarClaims).toEqual([]);
    expect(result.graphSignals).toEqual({});
  });

  it('returns graphAvailable=false when Neo4j is unreachable', async () => {
    repoMocks.executeSimilarClaimsByEntity.mockResolvedValue({ ok: false, reason: 'neo4j_unavailable', message: 'ServiceUnavailable' });
    repoMocks.executeClaimsWithMissingDocPattern.mockResolvedValue({ ok: true, data: [] });
    repoMocks.executeClaimsWithEscalationPattern.mockResolvedValue({ ok: true, data: [] });
    const result = await findSimilarClaims({ tenantId: 't1', claimId: 'c1' });
    expect(result.graphAvailable).toBe(false);
  });

  it('aggregates shared-entity hits into a single ranked SimilarClaim row', async () => {
    repoMocks.executeSimilarClaimsByEntity.mockResolvedValue({
      ok: true,
      data: [
        { claimId: 'other-1', sharedSignals: ['Repairer:Garage Y', 'Broker:Acme'], signalCount: 2 },
        { claimId: 'other-2', sharedSignals: ['Repairer:Garage Y'], signalCount: 1 },
      ],
    });
    repoMocks.executeClaimsWithMissingDocPattern.mockResolvedValue({ ok: true, data: [] });
    repoMocks.executeClaimsWithEscalationPattern.mockResolvedValue({ ok: true, data: [] });
    const result = await findSimilarClaims({ tenantId: 't1', claimId: 'c1' });
    expect(result.graphAvailable).toBe(true);
    expect(result.similarClaims[0].claimId).toBe('other-1');
    expect(result.similarClaims[0].score).toBeGreaterThanOrEqual(result.similarClaims[1].score);
    expect(result.graphSignals.sharedRepairers?.find((r) => r.normalizedName === 'Garage Y')?.coClaimCount).toBe(2);
  });

  it('merges multiple reason codes onto the same claimId', async () => {
    repoMocks.executeSimilarClaimsByEntity.mockResolvedValue({
      ok: true,
      data: [{ claimId: 'other-1', sharedSignals: ['Repairer:Garage Y'], signalCount: 1 }],
    });
    repoMocks.executeClaimsWithMissingDocPattern.mockResolvedValue({
      ok: true,
      data: [{ claimId: 'other-1', sharedMissingDocs: ['police_report'] }],
    });
    repoMocks.executeClaimsWithEscalationPattern.mockResolvedValue({
      ok: true,
      data: [{ claimId: 'other-1', reasonCode: 'BODILY_INJURY_PRESENT', date: '2026-05-12' }],
    });
    const result = await findSimilarClaims({ tenantId: 't1', claimId: 'c1' });
    expect(result.similarClaims).toHaveLength(1);
    const codes = result.similarClaims[0].reasons.map((r) => r.code).sort();
    expect(codes).toEqual(['SAME_AUTHORITY_ESCALATION_PATTERN', 'SAME_MISSING_DOC_PATTERN', 'SHARED_REPAIRER']);
  });

  it('caps results at 5', async () => {
    repoMocks.executeSimilarClaimsByEntity.mockResolvedValue({
      ok: true,
      data: Array.from({ length: 10 }, (_, i) => ({ claimId: `other-${i}`, sharedSignals: ['Repairer:G'], signalCount: 10 - i })),
    });
    repoMocks.executeClaimsWithMissingDocPattern.mockResolvedValue({ ok: true, data: [] });
    repoMocks.executeClaimsWithEscalationPattern.mockResolvedValue({ ok: true, data: [] });
    const result = await findSimilarClaims({ tenantId: 't1', claimId: 'c1' });
    expect(result.similarClaims).toHaveLength(5);
    expect(result.similarClaims[0].claimId).toBe('other-0');
  });
});
