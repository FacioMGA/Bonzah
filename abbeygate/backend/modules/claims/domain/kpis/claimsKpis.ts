import { buildClaimWorksheetProjection } from '../worksheetProjection.js';

type ClaimEvent = {
  id: string;
  eventType: string;
  occurredAt: Date;
  payload: unknown;
};

type ClaimForKpi = {
  id: string;
  claimNumber: string;
  reportedDate: Date;
  events: ClaimEvent[];
};

type ExaminerKpiInput = {
  fullTimeExaminers: number;
  averageCaseloadPerExaminer: number;
  examinersLeftInPeriod: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toIso(date: Date): string {
  return new Date(date).toISOString();
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function businessDaysBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);
  let days = 0;
  while (cursor < endDay) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    if (!isWeekend(cursor)) days += 1;
  }
  return days;
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / DAY_MS));
}

function firstEvent(events: ClaimEvent[], eventType: string): ClaimEvent | undefined {
  return events.find((ev) => ev.eventType === eventType);
}

function eventInPeriod(ev: ClaimEvent, periodStart: Date, periodEnd: Date): boolean {
  return ev.occurredAt >= periodStart && ev.occurredAt <= periodEnd;
}

export function computeClaimsKpis(args: {
  claims: ClaimForKpi[];
  periodStart: Date;
  periodEnd: Date;
  examiners: ExaminerKpiInput;
}) {
  const { claims, periodStart, periodEnd, examiners } = args;

  let volumeNewClaims = 0;
  let volumeClosedClaims = 0;
  let volumeReopenedClaims = 0;
  let volumeOpenClaims = 0;
  let valueOpenClaims = 0;
  let volumeFilesOpenRecovery = 0;
  let volumeNilReserveOlderThan6Months = 0;

  let referralRequiredCount = 0;
  let outsideAuthoritySlaBreaches = 0;
  let settledOutsideAuthority = 0;

  let peerReviewedOpenClaims = 0;

  let ack35 = 0;
  let ack69 = 0;
  let ack10p = 0;
  let ackLt2 = 0;
  let ackGt6 = 0;

  let firstPartyLt2 = 0;
  let firstParty35 = 0;
  let firstPartyGt6 = 0;

  let thirdPartyLt2 = 0;
  let thirdParty35 = 0;
  let thirdPartyGt6 = 0;

  let payFromAgreementLt2 = 0;
  let payFromAgreement35 = 0;
  let payFromAgreementGt6 = 0;

  let firstPaymentLt30 = 0;
  let firstPayment31to60 = 0;
  let firstPayment61to120 = 0;
  let firstPayment121p = 0;

  let closeLt6m = 0;
  let close6to12m = 0;
  let close12p = 0;

  let reserveLt56 = 0;
  let reserve57to90 = 0;
  let reserve90p = 0;

  let overdueDiaryLt14 = 0;
  let overdueDiary14to31 = 0;
  let overdueDiary31p = 0;

  let adjusterInstructionsTotal = 0;
  let adjusterInstructionsNonAffiliated = 0;
  let adjusterInstructionsOutside5d = 0;
  let adjusterInitialReportsOver30d = 0;

  let complaintsReceived = 0;
  let complaintsResolvedWithinSla = 0;
  let complaintsEscalatedToLondon = 0;

  let tcfNotCompletedPct: number | null = null;
  let customerSatisfactionScore: number | null = null;

  const referredClaimIds = new Set<string>();
  const activeClaimIds = new Set<string>();

  for (const claim of claims) {
    const events = [...claim.events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    if (!events.length) continue;

    const projection = buildClaimWorksheetProjection({
      claimId: claim.id,
      claimReference: claim.claimNumber,
      certificateReference: '',
      events,
      reportPeriodEnd: periodEnd,
    });

    const isOpenAtPeriodEnd = !['CLOSED', 'CLOSED_THIS_MONTH', 'WITHDRAWN', 'CLOSED_RECOVERY_PURSUED'].includes(projection.status);
    if (isOpenAtPeriodEnd) {
      volumeOpenClaims += 1;
      valueOpenClaims += projection.totalOutstanding;
      activeClaimIds.add(claim.id);
      if (projection.recoveriesExpected > 0 || projection.salvageExpected > 0) volumeFilesOpenRecovery += 1;
      const ageDays = daysBetween(new Date(projection.firstNotifiedAt || claim.reportedDate), periodEnd);
      if (projection.totalOutstanding === 0 && ageDays > 183) {
        volumeNilReserveOlderThan6Months += 1;
      }
    }

    const openEvent = firstEvent(events, 'CLAIM_OPENED');
    if (openEvent && eventInPeriod(openEvent, periodStart, periodEnd)) volumeNewClaims += 1;

    for (const ev of events) {
      if (!eventInPeriod(ev, periodStart, periodEnd)) continue;
      if (ev.eventType === 'CLAIM_CLOSED') volumeClosedClaims += 1;
      if (ev.eventType === 'CLAIM_REOPENED') volumeReopenedClaims += 1;
      if (ev.eventType === 'REFERRAL_REQUIRED') {
        referralRequiredCount += 1;
        referredClaimIds.add(claim.id);
      }
      if (ev.eventType === 'COMPLAINT_RECEIVED') complaintsReceived += 1;
      if (ev.eventType === 'COMPLAINT_ESCALATED_TO_LONDON') complaintsEscalatedToLondon += 1;
      if (ev.eventType === 'FIELD_ADJUSTER_INSTRUCTED') {
        adjusterInstructionsTotal += 1;
        const payload = (ev.payload || {}) as Record<string, unknown>;
        if (payload.affiliated === false) adjusterInstructionsNonAffiliated += 1;
        const instructedAt = new Date(String(payload.instructedAt || ev.occurredAt.toISOString()));
        const firstNotified = new Date(projection.firstNotifiedAt || claim.reportedDate);
        if (daysBetween(firstNotified, instructedAt) > 5) adjusterInstructionsOutside5d += 1;
      }
    }

    const firstAck = firstEvent(events, 'CLAIM_ACKNOWLEDGED');
    const firstNotified = new Date(projection.firstNotifiedAt || claim.reportedDate);
    if (firstAck) {
      const wd = businessDaysBetween(firstNotified, firstAck.occurredAt);
      if (wd < 2) ackLt2 += 1;
      else if (wd <= 5) {
        ack35 += 1;
      } else if (wd <= 9) {
        ack69 += 1;
      } else {
        ack10p += 1;
        ackGt6 += 1;
      }
    }

    const firstIndemnityPayment = events.find((ev) => {
      if (ev.eventType === 'PAYMENT_INDEMNITY') return true;
      if (ev.eventType !== 'PAYMENT_ADDED') return false;
      const payload = (ev.payload || {}) as Record<string, unknown>;
      return String(payload.bucket || '').toUpperCase() === 'INDEMNITY' && Number(payload.amount || 0) > 0;
    });
    if (firstIndemnityPayment) {
      const d = daysBetween(firstNotified, firstIndemnityPayment.occurredAt);
      if (d < 30) firstPaymentLt30 += 1;
      else if (d <= 60) firstPayment31to60 += 1;
      else if (d <= 120) firstPayment61to120 += 1;
      else firstPayment121p += 1;
    }

    const firstReserve = events.find((ev) => {
      if (ev.eventType !== 'RESERVE_SET') return false;
      const payload = (ev.payload || {}) as Record<string, unknown>;
      return String(payload.bucket || '').toUpperCase() === 'INDEMNITY' && Number(payload.newOutstandingAmount || payload.amount || 0) > 0;
    });
    if (firstReserve) {
      const d = daysBetween(firstNotified, firstReserve.occurredAt);
      if (d < 56) reserveLt56 += 1;
      else if (d <= 90) reserve57to90 += 1;
      else reserve90p += 1;
    }

    const closeEvent = firstEvent(events, 'CLAIM_CLOSED');
    if (closeEvent) {
      const d = daysBetween(firstNotified, closeEvent.occurredAt);
      if (d < 183) closeLt6m += 1;
      else if (d <= 365) close6to12m += 1;
      else close12p += 1;
    }

    const approvedRefAt = firstEvent(events, 'REFERRAL_APPROVED')?.occurredAt;
    const referralReqAt = firstEvent(events, 'REFERRAL_REQUIRED')?.occurredAt;
    if (referralReqAt) {
      const approvedWithin5Days = approvedRefAt && daysBetween(referralReqAt, approvedRefAt) <= 5;
      if (!approvedWithin5Days) outsideAuthoritySlaBreaches += 1;
    }

    for (const ev of events.filter((e) => e.eventType === 'PAYMENT_ADDED' || e.eventType === 'PAYMENT_INDEMNITY')) {
      if (!eventInPeriod(ev, periodStart, periodEnd)) continue;
      if (referralReqAt && (!approvedRefAt || approvedRefAt > ev.occurredAt)) {
        settledOutsideAuthority += 1;
      }
      const payload = (ev.payload || {}) as Record<string, unknown>;
      const agreementRaw = payload.agreementDate;
      if (agreementRaw) {
        const agreementDate = new Date(String(agreementRaw));
        const wd = businessDaysBetween(agreementDate, ev.occurredAt);
        if (wd < 2) payFromAgreementLt2 += 1;
        else if (wd <= 5) payFromAgreement35 += 1;
        else payFromAgreementGt6 += 1;
      }
    }

    const diaryCreated = events.filter((e) => e.eventType === 'DIARY_CREATED');
    const diaryCompleted = new Map<string, Date>();
    for (const ev of events.filter((e) => e.eventType === 'DIARY_COMPLETED')) {
      const payload = (ev.payload || {}) as Record<string, unknown>;
      const diaryId = String(payload.diaryId || '');
      if (diaryId) diaryCompleted.set(diaryId, ev.occurredAt);
    }
    for (const ev of diaryCreated) {
      const payload = (ev.payload || {}) as Record<string, unknown>;
      const dueDate = new Date(String(payload.dueDate || ev.occurredAt.toISOString()));
      const diaryId = String(payload.diaryId || '');
      const completedAt = diaryCompleted.get(diaryId);
      const isOverdueAtPeriodEnd = dueDate < periodEnd && (!completedAt || completedAt > periodEnd);
      if (!isOverdueAtPeriodEnd) continue;
      const age = daysBetween(dueDate, periodEnd);
      if (age < 14) overdueDiaryLt14 += 1;
      else if (age <= 31) overdueDiary14to31 += 1;
      else overdueDiary31p += 1;
    }

    const reviewed = events.some((ev) => ev.eventType === 'PEER_REVIEW_RECORDED' && ev.occurredAt <= periodEnd);
    if (reviewed && isOpenAtPeriodEnd) peerReviewedOpenClaims += 1;

    const commSentFirstParty = events.find((ev) => {
      if (ev.eventType !== 'COMMUNICATION_SENT') return false;
      const payload = (ev.payload || {}) as Record<string, unknown>;
      return String(payload.partyType || '').toUpperCase() === 'FIRST_PARTY';
    });
    if (commSentFirstParty) {
      const wd = businessDaysBetween(firstNotified, commSentFirstParty.occurredAt);
      if (wd < 2) firstPartyLt2 += 1;
      else if (wd <= 5) firstParty35 += 1;
      else firstPartyGt6 += 1;
    }
    const commSentThirdParty = events.find((ev) => {
      if (ev.eventType !== 'COMMUNICATION_SENT') return false;
      const payload = (ev.payload || {}) as Record<string, unknown>;
      return String(payload.partyType || '').toUpperCase() === 'THIRD_PARTY';
    });
    if (commSentThirdParty) {
      const wd = businessDaysBetween(firstNotified, commSentThirdParty.occurredAt);
      if (wd < 2) thirdPartyLt2 += 1;
      else if (wd <= 5) thirdParty35 += 1;
      else thirdPartyGt6 += 1;
    }

    const instructions = events.filter((ev) => ev.eventType === 'FIELD_ADJUSTER_INSTRUCTED');
    const reports = events.filter((ev) => ev.eventType === 'ADJUSTER_REPORT_RECEIVED');
    const reportByInstruction = new Map<string, Date>();
    for (const report of reports) {
      const payload = (report.payload || {}) as Record<string, unknown>;
      const instructionId = String(payload.instructionId || '');
      if (instructionId) reportByInstruction.set(instructionId, report.occurredAt);
    }
    for (const instruction of instructions) {
      const payload = (instruction.payload || {}) as Record<string, unknown>;
      const instructionId = String(payload.instructionId || '');
      if (!instructionId) continue;
      const reportAt = reportByInstruction.get(instructionId);
      if (!reportAt || daysBetween(instruction.occurredAt, reportAt) > 30) {
        adjusterInitialReportsOver30d += 1;
      }
    }

    const complaintsOpened = events.filter((ev) => ev.eventType === 'COMPLAINT_RECEIVED');
    const complaintsClosed = events.filter((ev) => ev.eventType === 'COMPLAINT_RESOLVED');
    const complaintResolvedById = new Map<string, Date>();
    for (const resolved of complaintsClosed) {
      const payload = (resolved.payload || {}) as Record<string, unknown>;
      const complaintId = String(payload.complaintId || '');
      if (complaintId) complaintResolvedById.set(complaintId, resolved.occurredAt);
    }
    for (const opened of complaintsOpened) {
      const payload = (opened.payload || {}) as Record<string, unknown>;
      const complaintId = String(payload.complaintId || '');
      const slaDays = Number(payload.slaDays || 8);
      const resolvedAt = complaintResolvedById.get(complaintId);
      if (resolvedAt && daysBetween(opened.occurredAt, resolvedAt) <= slaDays) {
        complaintsResolvedWithinSla += 1;
      }
    }
  }

  const percentReferredToLondon = claims.length ? (referralRequiredCount / claims.length) * 100 : 0;
  const percentPeerReviewedOpenClaims = volumeOpenClaims ? (peerReviewedOpenClaims / volumeOpenClaims) * 100 : 0;

  return {
    reportingPeriod: {
      start: toIso(periodStart),
      end: toIso(periodEnd),
    },
    claimsCounts: {
      volumeOpenClaims,
      volumeClosedClaims,
      volumeReopenedClaims,
      volumeNewClaims,
      valueOpenClaims: Math.round(valueOpenClaims * 100) / 100,
      percentWorkReferredToLondon: Math.round(percentReferredToLondon * 100) / 100,
      volumeFilesHeldOpenRecovery: volumeFilesOpenRecovery,
    },
    performance: {
      openClaimsOutsideAuthorityReferredOutside5DaySla: outsideAuthoritySlaBreaches,
      notAcknowledgedWithin2WorkingDays: {
        days3to5: ack35,
        days6to9: ack69,
        moreThan10: ack10p,
      },
      overdueDiaryItems: {
        lessThan14Days: overdueDiaryLt14,
        days14to31: overdueDiary14to31,
        moreThan31Days: overdueDiary31p,
      },
      percentOpenClaimsPeerReviewed: Math.round(percentPeerReviewedOpenClaims * 100) / 100,
      daysFromFirstNotificationToFirstIndemnityPayment: {
        lessThan30: firstPaymentLt30,
        days31to60: firstPayment31to60,
        days61to120: firstPayment61to120,
        moreThan121: firstPayment121p,
      },
      daysFromFirstNotificationToClose: {
        lessThan6Months: closeLt6m,
        months6to12: close6to12m,
        moreThan12Months: close12p,
      },
      daysToInitialReserveFromNotice: {
        lessThan56: reserveLt56,
        days57to90: reserve57to90,
        moreThan90: reserve90p,
      },
      volumeNilReserveClaimsOlderThan6Months: volumeNilReserveOlderThan6Months,
      volumeClaimsSettledOutsideAuthority: settledOutsideAuthority,
    },
    communication: {
      responseTimeAcknowledgingNewClaims: {
        lessThan2WorkingDays: ackLt2,
        days3to5WorkingDays: ack35,
        moreThan6WorkingDays: ackGt6,
      },
      responseTimeFirstPartyCorrespondence: {
        lessThan2WorkingDays: firstPartyLt2,
        days3to5WorkingDays: firstParty35,
        moreThan6WorkingDays: firstPartyGt6,
      },
      responseTimeThirdPartyCorrespondence: {
        lessThan2WorkingDays: thirdPartyLt2,
        days3to5WorkingDays: thirdParty35,
        moreThan6WorkingDays: thirdPartyGt6,
      },
      paymentIssueTimeFromAgreementDate: {
        lessThan2Days: payFromAgreementLt2,
        days3to5: payFromAgreement35,
        moreThan6Days: payFromAgreementGt6,
      },
    },
    thirdPartyAdjusterUsage: {
      totalInstructionsInPeriod: adjusterInstructionsTotal,
      instructionsToNonAffiliatedCompanies: adjusterInstructionsNonAffiliated,
      instructionsOutside5DaySla: adjusterInstructionsOutside5d,
      initialReportsNotIssuedWithin30Days: adjusterInitialReportsOver30d,
    },
    complaintsAndTcf: {
      volumeClaimComplaintsReceived: complaintsReceived,
      volumeClaimComplaintsResolvedWithinSla: complaintsResolvedWithinSla,
      volumeClaimComplaintsNotifiedToLondon: complaintsEscalatedToLondon,
      percentStaffWithoutTcfInLast12Months: tcfNotCompletedPct,
      customerSatisfactionOrNps: customerSatisfactionScore,
    },
    staffing: {
      fullTimeClaimsExaminers: examiners.fullTimeExaminers,
      averageCaseloadPerExaminer: Math.round(examiners.averageCaseloadPerExaminer * 100) / 100,
      claimsExaminersLeftInReportingPeriod: examiners.examinersLeftInPeriod,
    },
    dataQuality: {
      notes: [
        'TCF/NPS values are null until staff-training and survey event streams are connected.',
        'Payment-from-agreement KPI requires payment events to include payload.agreementDate.',
      ],
      requiredEventCoverage: [
        'CLAIM_OPENED',
        'POLICY_LINKED',
        'FNOL_CONFIRMED',
        'CLAIM_CLOSED',
        'CLAIM_REOPENED',
        'REFERRAL_REQUIRED',
        'REFERRAL_APPROVED',
        'CLAIM_ACKNOWLEDGED',
        'RESERVE_SET',
        'PAYMENT_ADDED',
        'DIARY_CREATED',
        'DIARY_COMPLETED',
        'COMMUNICATION_SENT',
        'COMMUNICATION_RECEIVED',
        'FIELD_ADJUSTER_INSTRUCTED',
        'ADJUSTER_REPORT_RECEIVED',
        'COMPLAINT_RECEIVED',
        'COMPLAINT_RESOLVED',
        'PEER_REVIEW_RECORDED',
        'ASSIGNED_TO',
      ],
    },
  };
}

