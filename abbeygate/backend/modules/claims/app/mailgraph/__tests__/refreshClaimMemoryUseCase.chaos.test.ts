/**
 * refreshClaimMemoryUseCase.chaos.test — failure-mode hardening (ADR-0041 §8).
 *
 * The hard rule we pin: "no claim lifecycle action is ever blocked
 * solely by Neo4j or the projection layer."
 *
 * Specifically:
 *   - When Neo4j is unreachable, the projection MUST still be written
 *     with refreshStatus='failed' + refreshError='neo4j_unavailable',
 *     and previously-computed `similarClaims` MUST be preserved.
 *   - When the LLM is unavailable, deterministic extraction MUST still
 *     populate the projection (covered by Week 1 + Week 2 unit tests
 *     transitively).
 *   - When loadClaimContext fails (e.g. claim deleted mid-flight), the
 *     orchestrator MUST emit refreshStatus='failed' rather than throw.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const repoMocks = vi.hoisted(() => ({
  findClaimMemory: vi.fn(),
  markRefreshing: vi.fn().mockResolvedValue(undefined),
  markRefreshFailed: vi.fn().mockResolvedValue(undefined),
  saveClaimMemoryProjection: vi.fn().mockResolvedValue({}),
}));
const linkageMock = vi.hoisted(() => ({ resolveClaimLinkage: vi.fn() }));
const contextMock = vi.hoisted(() => ({ loadClaimContext: vi.fn() }));
const upsertMock = vi.hoisted(() => ({ upsertClaimGraph: vi.fn() }));
const similarMock = vi.hoisted(() => ({ findSimilarClaims: vi.fn() }));
const auditMock = vi.hoisted(() => ({ log: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../../../infra/mailgraph/claimMemoryProjectionRepo.js', () => repoMocks);
vi.mock('../resolveClaimLinkage.js', () => linkageMock);
vi.mock('../loadClaimContext.js', () => contextMock);
vi.mock('../upsertClaimGraph.js', () => upsertMock);
vi.mock('../findSimilarClaims.js', () => similarMock);
vi.mock('../../../../../platform/audit/logger.js', () => ({ AuditLogger: auditMock }));

import { refreshClaimMemoryUseCase } from '../refreshClaimMemoryUseCase.js';
import type { ClaimMemoryObject } from '../../../domain/mailgraph/claimMemoryObject.js';

const emptyMemoryObject: ClaimMemoryObject = {
  claimId: 'claim-1',
  operatingTenantId: 'tenant-1',
  generatedAt: '2026-05-28T00:00:00Z',
  timeline: [],
  missingInformation: [],
  authorityFlags: [],
  liabilityPositions: [],
  recommendedActions: [],
  entities: [],
};

const stubClaim = {
  id: 'claim-1',
  operatingTenantId: 'tenant-1',
  policyId: null,
  claimNumber: 'CY-MTR-001',
  firstNotifiedAt: new Date('2026-05-10T00:00:00Z'),
  status: 'OPEN',
  claimType: 'MOTOR',
  lossCountry: 'CY',
  data: null,
  policyLinkedAt: null,
  incidentDate: new Date('2026-05-09T00:00:00Z'),
  reportedDate: new Date('2026-05-10T00:00:00Z'),
  description: null,
  certificateReference: null,
  originalCurrency: null,
  causeOfLossCode: null,
  lossDescription: null,
  dateOfLossFrom: null,
  dateOfLossTo: null,
  amountReserved: 0,
  amountPaid: 0,
  documents: null,
  updatedAt: new Date(),
};

const baseContext = {
  ok: true as const,
  context: {
    claim: stubClaim,
    policy: null,
    policyHolder: null,
    events: [],
    reserves: [],
    counterparties: [],
    threads: [],
  },
};

describe('refreshClaimMemoryUseCase — chaos / failure modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    linkageMock.resolveClaimLinkage.mockResolvedValue({ ok: true, claimId: 'claim-1', matchedBy: 'explicit_trigger' });
    contextMock.loadClaimContext.mockResolvedValue(baseContext);
  });

  it('returns CLAIM_NOT_FOUND when resolveClaimLinkage rejects', async () => {
    linkageMock.resolveClaimLinkage.mockResolvedValueOnce({ ok: false, code: 'CLAIM_NOT_FOUND', claimId: 'claim-x' });
    const result = await refreshClaimMemoryUseCase({ claimId: 'claim-x', reason: 'mcp_tool' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CLAIM_NOT_FOUND');
    expect(repoMocks.saveClaimMemoryProjection).not.toHaveBeenCalled();
  });

  it('marks projection as failed (not throws) when context load fails', async () => {
    contextMock.loadClaimContext.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND', claimId: 'claim-1' });
    const result = await refreshClaimMemoryUseCase({ claimId: 'claim-1', reason: 'mcp_tool' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CONTEXT_LOAD_FAILED');
    expect(repoMocks.markRefreshFailed).toHaveBeenCalledTimes(1);
  });

  it('preserves previous similarClaims when Neo4j is unavailable', async () => {
    upsertMock.upsertClaimGraph.mockResolvedValue({ ok: false, reason: 'neo4j_unavailable' });
    similarMock.findSimilarClaims.mockResolvedValue({ similarClaims: [], graphSignals: {}, graphAvailable: false });
    const previous = {
      id: 'p1',
      operatingTenantId: 'tenant-1',
      claimId: 'claim-1',
      summary: null,
      summaryCitations: [],
      memoryObject: emptyMemoryObject,
      similarClaims: [{ claimId: 'older-similar', score: 9, reasons: [], evidenceCitationIds: [], generatedAt: '2026-05-28T00:00:00Z' }],
      graphSignals: { sharedRepairers: [{ normalizedName: 'Garage Y', coClaimCount: 1 }] },
      lastRefreshedAt: new Date('2026-05-28T00:00:00Z'),
      refreshStatus: 'fresh' as const,
      refreshError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    repoMocks.findClaimMemory.mockResolvedValue(previous);

    const result = await refreshClaimMemoryUseCase({ claimId: 'claim-1', reason: 'mcp_tool' });

    expect(result.ok).toBe(true);
    expect(repoMocks.saveClaimMemoryProjection).toHaveBeenCalledTimes(1);
    const saved = repoMocks.saveClaimMemoryProjection.mock.calls[0][0];
    expect(saved.refreshStatus).toBe('failed');
    expect(saved.refreshError).toBe('neo4j_unavailable');
    // Previous similarClaims preserved — UI still shows yesterday's data.
    expect(saved.similarClaims[0].claimId).toBe('older-similar');
    expect(saved.graphSignals.sharedRepairers[0].normalizedName).toBe('Garage Y');
  });

  it('writes refreshStatus=fresh when Neo4j is intentionally disabled (graph is optional)', async () => {
    // A deployment without Neo4j is a supported topology, not a failure:
    // the Postgres memory is fully computed, so the projection is fresh.
    upsertMock.upsertClaimGraph.mockResolvedValue({ ok: false, reason: 'neo4j_disabled' });
    similarMock.findSimilarClaims.mockResolvedValue({ similarClaims: [], graphSignals: {}, graphAvailable: false });
    const result = await refreshClaimMemoryUseCase({ claimId: 'claim-1', reason: 'manual_refresh' });
    expect(result.ok).toBe(true);
    const saved = repoMocks.saveClaimMemoryProjection.mock.calls[0][0];
    expect(saved.refreshStatus).toBe('fresh');
    expect(saved.refreshError).toBeNull();
  });

  it('writes refreshStatus=fresh when Neo4j is reachable', async () => {
    upsertMock.upsertClaimGraph.mockResolvedValue({ ok: true, nodesUpserted: 5, edgesUpserted: 4 });
    similarMock.findSimilarClaims.mockResolvedValue({
      similarClaims: [{ claimId: 'other-1', score: 3, reasons: [], evidenceCitationIds: [], generatedAt: '2026-05-29T00:00:00Z' }],
      graphSignals: {},
      graphAvailable: true,
    });
    const result = await refreshClaimMemoryUseCase({ claimId: 'claim-1', reason: 'mcp_tool' });
    expect(result.ok).toBe(true);
    const saved = repoMocks.saveClaimMemoryProjection.mock.calls[0][0];
    expect(saved.refreshStatus).toBe('fresh');
    expect(saved.refreshError).toBeNull();
    expect(saved.similarClaims[0].claimId).toBe('other-1');
  });
});
