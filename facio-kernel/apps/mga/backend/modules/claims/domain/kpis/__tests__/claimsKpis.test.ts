import { describe, expect, it } from 'vitest';
import type { ClaimEvent } from '@prisma/client';
import { computeClaimsKpis } from '../claimsKpis.js';

function ev(id: string, eventType: string, occurredAt: string, payload: Record<string, unknown> = {}): ClaimEvent {
  return {
    id,
    claimId: 'claim-x',
    eventType,
    aggregateType: 'CLAIM',
    aggregateId: 'claim-x',
    aggregateVersion: 1,
    payload,
    occurredAt: new Date(occurredAt),
    recordedAt: new Date(occurredAt),
    actorType: 'USER',
    actorId: 'u-1',
    actorName: 'Tester',
    correlationId: null,
    causationId: null,
    idempotencyKey: null,
  };
}

describe('computeClaimsKpis', () => {
  it('derives KPI buckets from event stream deterministically', () => {
    const claims = [
      {
        id: 'c1',
        claimNumber: 'CLM-1',
        reportedDate: new Date('2026-01-01T08:00:00.000Z'),
        events: [
          ev('1', 'CLAIM_OPENED', '2026-01-01T08:00:00.000Z'),
          ev('2', 'REFERRAL_REQUIRED', '2026-01-02T09:00:00.000Z'),
          ev('3', 'CLAIM_ACKNOWLEDGED', '2026-01-08T09:00:00.000Z'),
          ev('4', 'RESERVE_SET', '2026-01-05T09:00:00.000Z', { bucket: 'INDEMNITY', newOutstandingAmount: 23000 }),
          ev('5', 'PAYMENT_ADDED', '2026-01-07T09:00:00.000Z', { bucket: 'INDEMNITY', amount: 1000 }),
          ev('6', 'RECOVERY_EXPECTED', '2026-01-08T09:00:00.000Z', { bucket: 'INDEMNITY', amount: 300 }),
          ev('7', 'COMMUNICATION_SENT', '2026-01-06T09:00:00.000Z', { partyType: 'FIRST_PARTY' }),
          ev('8', 'DIARY_CREATED', '2026-01-02T09:00:00.000Z', { diaryId: 'd1', dueDate: '2026-01-10T00:00:00.000Z' }),
          ev('9', 'FIELD_ADJUSTER_INSTRUCTED', '2026-01-03T09:00:00.000Z', { instructionId: 'adj-1', affiliated: false }),
          ev('10', 'ADJUSTER_REPORT_RECEIVED', '2026-02-10T09:00:00.000Z', { instructionId: 'adj-1' }),
          ev('11', 'COMPLAINT_RECEIVED', '2026-01-06T09:00:00.000Z', { complaintId: 'cmp-1', slaDays: 8 }),
          ev('12', 'COMPLAINT_RESOLVED', '2026-01-10T09:00:00.000Z', { complaintId: 'cmp-1' }),
          ev('13', 'PEER_REVIEW_RECORDED', '2026-01-20T09:00:00.000Z'),
        ],
      },
      {
        id: 'c2',
        claimNumber: 'CLM-2',
        reportedDate: new Date('2026-01-05T08:00:00.000Z'),
        events: [
          ev('21', 'CLAIM_OPENED', '2026-01-05T08:00:00.000Z'),
          ev('22', 'CLAIM_CLOSED', '2026-01-20T08:00:00.000Z'),
          ev('23', 'CLAIM_REOPENED', '2026-01-25T08:00:00.000Z'),
        ],
      },
    ];

    const result = computeClaimsKpis({
      claims,
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-01-31T23:59:59.999Z'),
      examiners: {
        fullTimeExaminers: 2,
        averageCaseloadPerExaminer: 1,
        examinersLeftInPeriod: null,
      },
    });

    expect(result.claimsCounts.volumeNewClaims).toBe(2);
    expect(result.claimsCounts.volumeClosedClaims).toBe(1);
    expect(result.claimsCounts.volumeReopenedClaims).toBe(1);
    expect(result.claimsCounts.volumeOpenClaims).toBe(2);
    expect(result.claimsCounts.volumeFilesHeldOpenRecovery).toBe(1);
    expect(result.performance.openClaimsOutsideAuthorityReferredOutside5DaySla).toBe(1);
    expect(result.performance.volumeClaimsSettledOutsideAuthority).toBe(1);
    expect(result.performance.notAcknowledgedWithin2WorkingDays.days3to5).toBe(1);
    expect(result.performance.daysFromFirstNotificationToFirstIndemnityPayment.lessThan30).toBe(1);
    expect(result.performance.daysToInitialReserveFromNotice.lessThan56).toBe(1);
    expect(result.performance.overdueDiaryItems.days14to31).toBe(1);
    expect(result.thirdPartyAdjusterUsage.totalInstructionsInPeriod).toBe(1);
    expect(result.thirdPartyAdjusterUsage.instructionsToNonAffiliatedCompanies).toBe(1);
    expect(result.thirdPartyAdjusterUsage.initialReportsNotIssuedWithin30Days).toBe(1);
    expect(result.complaintsAndTcf.volumeClaimComplaintsReceived).toBe(1);
    expect(result.complaintsAndTcf.volumeClaimComplaintsResolvedWithinSla).toBe(1);
  });
});

