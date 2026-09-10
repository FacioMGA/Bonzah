/**
 * buildClaimMemoryObject.test — Week 1 aggregation coverage (ADR-0041 §7).
 *
 * Pins the aggregation rules (missing-info dedupe, authority flag
 * thresholding, liability "latest wins", recommended-action derivation).
 */

import { describe, expect, it } from 'vitest';
import type { Claim, ClaimReserveTransaction } from '@prisma/client';
import { buildClaimMemoryObject } from '../buildClaimMemoryObject.js';
import type { ThreadAnalysis } from '../../../domain/mailgraph/threadAnalysis.js';

function baseClaim(overrides: Partial<Claim> = {}): Claim {
  const claim = {
    id: 'claim-1',
    operatingTenantId: 'tenant-1',
    policyId: null,
    firstNotifiedAt: new Date('2026-05-10T00:00:00Z'),
    policyLinkedAt: null,
    claimNumber: 'CY-MTR-017',
    incidentDate: new Date('2026-05-09T00:00:00Z'),
    reportedDate: new Date('2026-05-10T00:00:00Z'),
    status: 'OPEN',
    claimType: 'MOTOR',
    description: null,
    data: null,
    certificateReference: null,
    originalCurrency: null,
    lossCountry: null,
    causeOfLossCode: null,
    lossDescription: null,
    dateOfLossFrom: null,
    dateOfLossTo: null,
    amountReserved: 0,
    amountPaid: 0,
    documents: null,
    updatedAt: new Date(),
    ...overrides,
  };
  return claim as unknown as Claim;
}

function emptyAnalysis(events: ThreadAnalysis['events']): ThreadAnalysis {
  return {
    threadId: 'thread-1',
    messageCount: events.length,
    firstMessageAt: '2026-05-10T00:00:00Z',
    lastMessageAt: '2026-05-15T00:00:00Z',
    events,
    entities: [],
    citationsConsidered: [],
  };
}

describe('buildClaimMemoryObject', () => {
  it('always emits a FNOL event from canonical claim data', () => {
    const memory = buildClaimMemoryObject({ claim: baseClaim(), reserves: [], threadAnalyses: [] });
    expect(memory.timeline[0]?.type).toBe('fnol');
    expect(memory.timeline[0]?.derivedFrom).toBe('canonical');
  });

  it('rolls reserve transactions into timeline as canonical events', () => {
    const reserves = [
      {
        id: 'r1',
        operatingTenantId: 'tenant-1',
        claimId: 'claim-1',
        type: 'CASE_RESERVE',
        amount: 10000,
        currency: 'EUR',
        occurredAt: new Date('2026-05-12T00:00:00Z'),
        notes: 'Initial reserve',
        externalRef: null,
        createdAt: new Date(),
        createdByUserId: null,
      },
    ] as unknown as ClaimReserveTransaction[];
    const memory = buildClaimMemoryObject({ claim: baseClaim(), reserves, threadAnalyses: [] });
    const reserveEvent = memory.timeline.find((e) => e.type === 'reserve_change');
    expect(reserveEvent?.amount).toBe(10000);
  });

  it('builds a missing_information row when doc_request has no later doc_received', () => {
    const memory = buildClaimMemoryObject({
      claim: baseClaim(),
      reserves: [],
      threadAnalyses: [
        emptyAnalysis([
          {
            type: 'doc_request',
            date: '2026-05-13T10:00:00Z',
            documentType: 'police_report',
            citation: { threadId: 'thread-1', messageId: 'm1', quote: 'please send the police report' },
            derivedFrom: 'regex',
          },
        ]),
      ],
    });
    expect(memory.missingInformation).toHaveLength(1);
    expect(memory.missingInformation[0].documentType).toBe('police_report');
    expect(memory.missingInformation[0].received).toBe(false);
  });

  it('marks missing-info as received when a later doc_received matches the documentType', () => {
    const memory = buildClaimMemoryObject({
      claim: baseClaim(),
      reserves: [],
      threadAnalyses: [
        emptyAnalysis([
          { type: 'doc_request', date: '2026-05-13T10:00:00Z', documentType: 'estimate', derivedFrom: 'regex' },
          { type: 'doc_received', date: '2026-05-14T10:00:00Z', documentType: 'estimate', derivedFrom: 'regex' },
        ]),
      ],
    });
    expect(memory.missingInformation[0].received).toBe(true);
    expect(memory.missingInformation[0].receivedAt).toBe('2026-05-14T10:00:00Z');
  });

  it('raises an ESTIMATE_EXCEEDS_AUTHORITY flag above the threshold', () => {
    const memory = buildClaimMemoryObject({
      claim: baseClaim(),
      reserves: [],
      threadAnalyses: [
        emptyAnalysis([
          { type: 'estimate_received', date: '2026-05-13T10:00:00Z', amount: 30000, currency: 'EUR', derivedFrom: 'regex' },
        ]),
      ],
    });
    expect(memory.authorityFlags[0].code).toBe('ESTIMATE_EXCEEDS_AUTHORITY');
    expect(memory.authorityFlags[0].amount).toBe(30000);
    expect(memory.authorityFlags[0].threshold).toBe(25000);
  });

  it('respects a per-call authorityThresholdEur override', () => {
    const memory = buildClaimMemoryObject({
      claim: baseClaim(),
      reserves: [],
      authorityThresholdEur: 50000,
      threadAnalyses: [
        emptyAnalysis([{ type: 'estimate_received', date: '2026-05-13T10:00:00Z', amount: 30000, currency: 'EUR', derivedFrom: 'regex' }]),
      ],
    });
    expect(memory.authorityFlags).toHaveLength(0);
  });

  it('keeps liability positions in chronological order', () => {
    const memory = buildClaimMemoryObject({
      claim: baseClaim(),
      reserves: [],
      threadAnalyses: [
        emptyAnalysis([
          { type: 'liability_position', date: '2026-05-13T10:00:00Z', position: 'accepted', derivedFrom: 'regex' },
          { type: 'liability_position', date: '2026-05-15T10:00:00Z', position: 'reserved', derivedFrom: 'regex' },
        ]),
      ],
    });
    expect(memory.liabilityPositions.map((p) => p.position)).toEqual(['accepted', 'reserved']);
  });

  it('recommends CONFIRM_LIABILITY_POSITION when claim is OPEN and latest position is reserved', () => {
    const memory = buildClaimMemoryObject({
      claim: baseClaim({ status: 'OPEN' }),
      reserves: [],
      threadAnalyses: [
        emptyAnalysis([{ type: 'liability_position', date: '2026-05-13T10:00:00Z', position: 'reserved', derivedFrom: 'regex' }]),
      ],
    });
    expect(memory.recommendedActions.some((a) => a.code === 'CONFIRM_LIABILITY_POSITION')).toBe(true);
  });

  it('does not duplicate missing-info rows when the same document is requested twice', () => {
    const memory = buildClaimMemoryObject({
      claim: baseClaim(),
      reserves: [],
      threadAnalyses: [
        emptyAnalysis([
          { type: 'doc_request', date: '2026-05-13T10:00:00Z', documentType: 'photographs', derivedFrom: 'regex' },
          { type: 'doc_request', date: '2026-05-14T10:00:00Z', documentType: 'photographs', derivedFrom: 'regex' },
        ]),
      ],
    });
    expect(memory.missingInformation).toHaveLength(1);
    expect(memory.missingInformation[0].requestedAt).toBe('2026-05-13T10:00:00Z');
  });
});
