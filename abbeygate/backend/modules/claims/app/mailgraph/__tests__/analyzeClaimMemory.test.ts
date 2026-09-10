/**
 * analyzeClaimMemory.test — Week 3 narrative + citation-flag coverage (ADR-0041 §7).
 *
 * Mocks `getClaimMemory` and `verifyCitations` so this is a pure unit
 * test of the synthesis + citation-warning logic.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const memoryMock = vi.hoisted(() => ({ getClaimMemory: vi.fn() }));
const verifierMock = vi.hoisted(() => ({ verifyCitations: vi.fn() }));
const auditMock = vi.hoisted(() => ({ log: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../getClaimMemory.js', () => ({ getClaimMemory: memoryMock.getClaimMemory }));
vi.mock('../../../infra/mailgraph/citationVerifier.js', () => ({ verifyCitations: verifierMock.verifyCitations }));
vi.mock('../../../../../platform/audit/logger.js', () => ({ AuditLogger: auditMock }));

import { analyzeClaimMemory } from '../analyzeClaimMemory.js';

function projection(overrides: Partial<{ stalenessWarning: boolean; refreshStatus: string }> = {}) {
  return {
    projection: {
      summary: null,
      summaryCitations: [],
      memoryObject: {
        claimId: 'claim-1',
        operatingTenantId: 't1',
        generatedAt: '2026-05-29T00:00:00Z',
        timeline: [
          {
            type: 'estimate_received',
            date: '2026-05-12T10:00:00Z',
            amount: 30000,
            currency: 'EUR',
            citation: { threadId: 'thr-1', messageId: 'msg-1', quote: 'estimate of EUR 30,000' },
            derivedFrom: 'regex',
          },
        ],
        missingInformation: [
          {
            documentType: 'police_report',
            requestedAt: '2026-05-13T10:00:00Z',
            received: false,
            requestCitation: { threadId: 'thr-1', messageId: 'msg-2', quote: 'please send the police report' },
          },
        ],
        authorityFlags: [
          { code: 'ESTIMATE_EXCEEDS_AUTHORITY', amount: 30000, threshold: 25000, citation: { threadId: 'thr-1', messageId: 'msg-1', quote: 'estimate of EUR 30,000' } },
        ],
        liabilityPositions: [{ position: 'reserved', date: '2026-05-13' }],
        recommendedActions: [],
        entities: [],
      },
      similarClaims: [
        {
          claimId: 'other-1',
          score: 3,
          reasons: [{ code: 'SHARED_REPAIRER', detail: 'Garage Y' }],
          evidenceCitationIds: [],
          generatedAt: '2026-05-29T00:00:00Z',
        },
      ],
      graphSignals: {},
      refreshStatus: overrides.refreshStatus ?? 'fresh',
      refreshError: null,
      lastRefreshedAt: new Date('2026-05-29T00:00:00Z'),
      updatedAt: new Date('2026-05-29T00:00:00Z'),
      createdAt: new Date('2026-05-29T00:00:00Z'),
      id: 'p1',
      operatingTenantId: 't1',
      claimId: 'claim-1',
    },
    stalenessWarning: overrides.stalenessWarning ?? false,
  } as unknown as Awaited<ReturnType<typeof memoryMock.getClaimMemory>>;
}

describe('analyzeClaimMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns status=absent when no projection row exists', async () => {
    memoryMock.getClaimMemory.mockResolvedValue(null);
    const result = await analyzeClaimMemory({ claimId: 'claim-x' });
    expect(result.status).toBe('absent');
    expect(result.highlights).toBeNull();
    expect(result.citationWarning).toBe(false);
  });

  it('runs the citation verifier and reports supportedCount + rate', async () => {
    memoryMock.getClaimMemory.mockResolvedValue(projection());
    verifierMock.verifyCitations.mockResolvedValue({
      totalChecked: 3,
      supportedCount: 3,
      unsupported: [],
      rate: 1,
    });
    const result = await analyzeClaimMemory({ claimId: 'claim-1' });
    expect(result.status).toBe('completed');
    expect(result.citationWarning).toBe(false);
    expect(result.verification?.supportedCount).toBe(3);
    expect(result.verification?.rate).toBe(1);
  });

  it('sets citation_warning=true and emits audit row when verifier finds unsupported citations', async () => {
    memoryMock.getClaimMemory.mockResolvedValue(projection());
    verifierMock.verifyCitations.mockResolvedValue({
      totalChecked: 3,
      supportedCount: 2,
      unsupported: [
        { citation: { threadId: 'thr-1', messageId: 'msg-fake', quote: 'invented quote' }, supported: false, reason: 'message_not_found' },
      ],
      rate: 2 / 3,
    });
    const result = await analyzeClaimMemory({ claimId: 'claim-1' });
    expect(result.citationWarning).toBe(true);
    expect(result.verification?.unsupportedReasons[0]).toEqual({ messageId: 'msg-fake', reason: 'message_not_found' });
    expect(auditMock.log).toHaveBeenCalledTimes(1);
    expect(auditMock.log.mock.calls[0][2]).toBe('CLAIM_MEMORY.CITATION_WARNING');
  });

  it('produces a narrative referencing the top similar claim + authority flags', async () => {
    memoryMock.getClaimMemory.mockResolvedValue(projection());
    verifierMock.verifyCitations.mockResolvedValue({ totalChecked: 3, supportedCount: 3, unsupported: [], rate: 1 });
    const result = await analyzeClaimMemory({ claimId: 'claim-1' });
    expect(result.narrative).toContain('liability position');
    expect(result.narrative).toContain('Authority flags');
    expect(result.narrative).toContain('other-1');
  });

  it('respects maxRecommendations cap', async () => {
    const proj = projection();
    proj.projection.memoryObject.recommendedActions = Array.from({ length: 8 }, (_, i) => ({
      code: 'CONFIRM_LIABILITY_POSITION',
      summary: `action ${i}`,
      basedOnCitations: [],
    }));
    memoryMock.getClaimMemory.mockResolvedValue(proj);
    verifierMock.verifyCitations.mockResolvedValue({ totalChecked: 3, supportedCount: 3, unsupported: [], rate: 1 });
    const result = await analyzeClaimMemory({ claimId: 'claim-1', maxRecommendations: 3 });
    expect(result.highlights?.recommendedActions).toHaveLength(3);
  });

  it('passes stalenessWarning through unchanged', async () => {
    memoryMock.getClaimMemory.mockResolvedValue(projection({ stalenessWarning: true, refreshStatus: 'stale' }));
    verifierMock.verifyCitations.mockResolvedValue({ totalChecked: 3, supportedCount: 3, unsupported: [], rate: 1 });
    const result = await analyzeClaimMemory({ claimId: 'claim-1' });
    expect(result.stalenessWarning).toBe(true);
  });
});
