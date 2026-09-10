/**
 * upsertClaimGraph.test — Week 2 graph-upsert mapping coverage (ADR-0041 §8).
 *
 * Mocks the Neo4j repository to verify the param shape we hand to the
 * Cypher executor.  Live Cypher behaviour is verified separately
 * (Week 3 chaos test).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const repoMocks = vi.hoisted(() => ({
  executeUpsertClaimGraph: vi.fn(),
}));

vi.mock('../../../infra/mailgraph/neo4jClaimGraphRepository.js', () => ({
  executeUpsertClaimGraph: repoMocks.executeUpsertClaimGraph,
}));

import { upsertClaimGraph } from '../upsertClaimGraph.js';

const sampleMemoryObject = {
  claimId: 'claim-1',
  operatingTenantId: 'tenant-1',
  generatedAt: '2026-05-29T10:00:00Z',
  timeline: [
    {
      type: 'estimate_received' as const,
      date: '2026-05-12T10:00:00Z',
      amount: 30000,
      currency: 'EUR',
      citation: { threadId: 'thr-1', messageId: 'msg-1', quote: 'estimate of EUR 30,000' },
      derivedFrom: 'regex' as const,
    },
  ],
  missingInformation: [],
  authorityFlags: [],
  liabilityPositions: [],
  recommendedActions: [],
  entities: [
    { type: 'repairer' as const, normalizedName: 'big-garage.example', citations: [], derivedFrom: 'regex' as const },
    { type: 'broker' as const, normalizedName: 'broker.example', citations: [], derivedFrom: 'regex' as const },
  ],
};

const sampleThreads = [
  {
    threadId: 'thr-1',
    messages: [{ messageId: 'msg-1', sentAt: '2026-05-12T10:00:00Z', senderDomain: 'big-garage.example', channel: 'EMAIL' }],
  },
];

describe('upsertClaimGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes tenantId, claimId, and derived repairer/broker/event lists to the executor', async () => {
    repoMocks.executeUpsertClaimGraph.mockResolvedValue({ ok: true, data: { nodes: 5, edges: 4 } });
    await upsertClaimGraph({
      tenantId: 'tenant-1',
      claimId: 'claim-1',
      memoryObject: sampleMemoryObject,
      product: 'MOTOR',
      jurisdiction: 'CY',
      status: 'OPEN',
      threads: sampleThreads,
    });
    expect(repoMocks.executeUpsertClaimGraph).toHaveBeenCalledTimes(1);
    const params = repoMocks.executeUpsertClaimGraph.mock.calls[0][0];
    expect(params.tenantId).toBe('tenant-1');
    expect(params.claimId).toBe('claim-1');
    expect(params.product).toBe('MOTOR');
    expect(params.jurisdiction).toBe('CY');
    expect(params.repairers).toHaveLength(1);
    expect(params.repairers[0].normalizedName).toBe('big-garage.example');
    expect(params.brokers).toHaveLength(1);
    expect(params.events).toHaveLength(1);
    expect(params.events[0].type).toBe('estimate_received');
    expect(params.events[0].citation?.messageId).toBe('msg-1');
    expect(params.threads).toEqual([
      {
        threadId: 'thr-1',
        messages: [
          {
            messageId: 'msg-1',
            sentAt: '2026-05-12T10:00:00Z',
            senderDomain: 'big-garage.example',
            messageType: 'EMAIL',
          },
        ],
      },
    ]);
  });

  it('reports neo4j_disabled gracefully', async () => {
    repoMocks.executeUpsertClaimGraph.mockResolvedValue({ ok: false, reason: 'neo4j_disabled' });
    const result = await upsertClaimGraph({
      tenantId: 'tenant-1',
      claimId: 'claim-1',
      memoryObject: sampleMemoryObject,
      threads: sampleThreads,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('neo4j_disabled');
    }
  });

  it('produces deterministic repairer ids so re-runs are idempotent', async () => {
    repoMocks.executeUpsertClaimGraph.mockResolvedValue({ ok: true, data: { nodes: 1, edges: 0 } });
    await upsertClaimGraph({ tenantId: 'tenant-1', claimId: 'claim-1', memoryObject: sampleMemoryObject, threads: [] });
    await upsertClaimGraph({ tenantId: 'tenant-1', claimId: 'claim-1', memoryObject: sampleMemoryObject, threads: [] });
    const first = repoMocks.executeUpsertClaimGraph.mock.calls[0][0];
    const second = repoMocks.executeUpsertClaimGraph.mock.calls[1][0];
    expect(first.repairers[0].repairerId).toBe(second.repairers[0].repairerId);
    expect(first.brokers[0].brokerId).toBe(second.brokers[0].brokerId);
    expect(first.events[0].eventId).toBe(second.events[0].eventId);
  });
});
