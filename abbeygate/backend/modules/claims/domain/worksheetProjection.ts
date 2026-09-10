// Claim worksheet projection. Composer / public surface.
//
// The implementation lives in `./worksheetProjection/` (split in
// sprint follow-up F4a so each concern stays under the file-size cap):
//
//   types.ts                    - public types (Claim*, LedgerState, etc.)
//   ledger.ts                   - parseLedger event-stream replayer
//   intake.ts                   - deriveIntake (FNOL/clarification surface)
//   status.ts                   - deriveCr0105Status + derivePhase
//   internal/helpers.ts         - small helpers + bucket constants (NOT re-exported)
//
// All existing consumers (claims app, reporting BDX fetcher, claims
// router, kpi calculator, payment classifier, request handlers) import
// from this file unchanged.

import type {
  PrismaClaimProjectionSnapshotUncheckedCreateInput,
  PrismaInputJsonValue,
  PrismaTransactionClient,
} from '../../../platform/types/prisma.js';
import {
  ALL_BUCKETS,
  asNumber,
  asRecord,
  emptyBuckets,
  FEE_BUCKETS,
  INDEMNITY_BUCKETS,
  normalizeBucket,
} from './worksheetProjection/internal/helpers.js';
import { parseLedger } from './worksheetProjection/ledger.js';
import { deriveIntake } from './worksheetProjection/intake.js';
import { deriveCr0105Status, derivePhase } from './worksheetProjection/status.js';
import type {
  ClaimBucket,
  ClaimEvent,
  ClaimWorksheetProjection,
} from './worksheetProjection/types.js';

export type {
  ClaimBucket,
  ClaimEvent,
  ClaimWorksheetProjection,
  ClaimWorksheetStatus,
  IntakeProjection,
  LedgerState,
  Money,
} from './worksheetProjection/types.js';
export { deriveCr0105Status } from './worksheetProjection/status.js';

type WorksheetProjectionTx = {
  claimProjectionSnapshot: PrismaTransactionClient['claimProjectionSnapshot'];
};

export function buildClaimWorksheetProjection(args: {
  claimId: string;
  claimReference: string;
  certificateReference: string;
  events: ClaimEvent[];
  reportPeriodEnd?: Date;
}): ClaimWorksheetProjection {
  const sorted = [...args.events].sort((a, b) => {
    const diff = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (diff !== 0) return diff;
    return String(a.id).localeCompare(String(b.id));
  });
  const ledger = parseLedger(sorted);
  const largeLossThreshold = Math.max(0, Number(process.env.CLAIM_LARGE_LOSS_THRESHOLD || 0));
  if (largeLossThreshold > 0 && ledger.totalIncurred >= largeLossThreshold) {
    ledger.largeLossIndicator = true;
  }
  const status = deriveCr0105Status(ledger, args.reportPeriodEnd);
  const totalIncurredIndemnity = ledger.paidIndemnity + ledger.reserveIndemnity;
  const totalIncurredFees = ledger.paidFees + ledger.reserveFees;
  return {
    claimId: args.claimId,
    claimReference: args.claimReference,
    certificateReference: args.certificateReference,
    ...ledger,
    status,
    cr0106ReferredToUnderwriters: ledger.referredToUw ? 'Y' : 'N',
    cr0107Denial: ledger.denied ? 'Y' : 'N',
    totalIncurredIndemnity,
    totalIncurredFees,
    totalIncurredOverall: totalIncurredIndemnity + totalIncurredFees,
    phase: derivePhase(ledger),
    intake: deriveIntake(ledger),
    timeline: sorted.map((ev) => ({
      id: ev.id,
      eventType: ev.eventType,
      occurredAt: ev.occurredAt.toISOString(),
      actorName: ev.actorName || undefined,
      payload: asRecord(ev.payload),
    })),
  };
}

export function periodFinancialProjection(args: {
  events: ClaimEvent[];
  startDate: Date;
  endDate: Date;
}) {
  const sorted = [...args.events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const buckets = emptyBuckets();
  const paidThisPeriodByBucket: Record<ClaimBucket, number> = {
    INDEMNITY: 0,
    DEFENCE_COSTS: 0,
    ADJUSTER_FEES: 0,
    LEGAL_FEES: 0,
    OTHER: 0,
  };

  for (const ev of sorted) {
    const payload = asRecord(ev.payload);
    const occurred = ev.occurredAt.getTime();
    if (occurred > args.endDate.getTime()) continue;
    const inPeriod = occurred >= args.startDate.getTime() && occurred <= args.endDate.getTime();

    if (ev.eventType === 'RESERVE_SET' || ev.eventType === 'RESERVE_ADJ') {
      const bucket = normalizeBucket(payload.bucket);
      buckets[bucket].outstanding = Math.max(0, asNumber(payload.newOutstandingAmount ?? payload.amount));
      continue;
    }
    if (ev.eventType === 'PAYMENT_ADDED') {
      const bucket = normalizeBucket(payload.bucket);
      const amount = Math.max(0, asNumber(payload.amount));
      buckets[bucket].paid += amount;
      if (payload.autoReduceReserve !== false) {
        buckets[bucket].outstanding = Math.max(0, buckets[bucket].outstanding - amount);
      }
      if (inPeriod) paidThisPeriodByBucket[bucket] += amount;
      continue;
    }
    if (ev.eventType === 'PAYMENT_INDEMNITY') {
      const amount = Math.max(0, asNumber(payload.amount));
      buckets.INDEMNITY.paid += amount;
      if (inPeriod) paidThisPeriodByBucket.INDEMNITY += amount;
      continue;
    }
    if (ev.eventType === 'PAYMENT_FEES') {
      const amount = Math.max(0, asNumber(payload.amount));
      buckets.LEGAL_FEES.paid += amount;
      if (inPeriod) paidThisPeriodByBucket.LEGAL_FEES += amount;
      continue;
    }
    if (ev.eventType === 'RECOVERY_RECEIVED') {
      const bucket = normalizeBucket(payload.bucket, 'INDEMNITY');
      const amount = Math.max(0, asNumber(payload.amount));
      if (String(payload.recoveryType || '').toUpperCase() === 'SALVAGE') {
        buckets[bucket].salvageRealized += amount;
      } else {
        buckets[bucket].recovered += amount;
      }
      continue;
    }
    if (ev.eventType === 'RECOVERY_EXPECTED') {
      const bucket = normalizeBucket(payload.bucket, 'INDEMNITY');
      const amount = Math.max(0, asNumber(payload.amount));
      if (String(payload.recoveryType || '').toUpperCase() === 'SALVAGE') {
        buckets[bucket].salvageExpected = amount;
      } else {
        buckets[bucket].recoveryExpected = amount;
      }
      continue;
    }
  }

  const paidToDateIndemnity = INDEMNITY_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket].paid, 0);
  const paidToDateFees = FEE_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket].paid, 0);
  const paidThisPeriodIndemnity = INDEMNITY_BUCKETS.reduce((sum, bucket) => sum + paidThisPeriodByBucket[bucket], 0);
  const paidThisPeriodFees = FEE_BUCKETS.reduce((sum, bucket) => sum + paidThisPeriodByBucket[bucket], 0);
  const reserveIndemnityAtEnd = INDEMNITY_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket].outstanding, 0);
  const reserveFeesAtEnd = FEE_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket].outstanding, 0);
  const recoveriesReceivedToDate = ALL_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket].recovered, 0);
  const recoveriesExpectedAtEnd = ALL_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket].recoveryExpected, 0);
  const salvageRealizedToDate = ALL_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket].salvageRealized, 0);
  const salvageExpectedAtEnd = ALL_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket].salvageExpected, 0);

  const previouslyPaidIndemnity = paidToDateIndemnity - paidThisPeriodIndemnity;
  const previouslyPaidFees = paidToDateFees - paidThisPeriodFees;
  const totalIncurredIndemnity = paidToDateIndemnity + reserveIndemnityAtEnd;
  const totalIncurredFees = paidToDateFees + reserveFeesAtEnd;
  return {
    paidThisPeriodIndemnity,
    paidThisPeriodFees,
    previouslyPaidIndemnity,
    previouslyPaidFees,
    reserveIndemnityAtEnd,
    reserveFeesAtEnd,
    totalIncurredIndemnity,
    totalIncurredFees,
    totalIncurredOverall: totalIncurredIndemnity + totalIncurredFees,
    recoveriesReceivedToDate,
    recoveriesExpectedAtEnd,
    salvageRealizedToDate,
    salvageExpectedAtEnd,
  };
}

export async function persistClaimProjectionSnapshot(args: {
  tx: WorksheetProjectionTx;
  claimId: string;
  projection: ClaimWorksheetProjection;
}) {
  const snapshotData: Record<string, unknown> = {
    buckets: args.projection.buckets,
    totalPaid: args.projection.totalPaid,
    totalOutstanding: args.projection.totalOutstanding,
    totalIncurred: args.projection.totalIncurred,
    totalRecovered: args.projection.totalRecovered,
    netIncurred: args.projection.netIncurred,
    totalIncurredIndemnity: args.projection.totalIncurredIndemnity,
    totalIncurredFees: args.projection.totalIncurredFees,
    totalIncurredOverall: args.projection.totalIncurredOverall,
    recoveriesReceived: args.projection.recoveriesReceived,
    salvageRealized: args.projection.salvageRealized,
    recoveriesExpected: args.projection.recoveriesExpected,
    salvageExpected: args.projection.salvageExpected,
    phase: args.projection.phase,
    intake: args.projection.intake,
    referralRequired: args.projection.referralRequired,
    referralApprovedAt: args.projection.referralApprovedAt || null,
    largeLossIndicator: args.projection.largeLossIndicator,
    largeLossNotifiedAt: args.projection.largeLossNotifiedAt || null,
    lockedDeductible: args.projection.lockedDeductible ?? null,
  };
  await args.tx.claimProjectionSnapshot.create({
    data: {
      claimId: args.claimId,
      asOf: new Date(),
      status: args.projection.status,
      paidIndemnity: args.projection.paidIndemnity,
      paidFees: args.projection.paidFees,
      reserveIndemnity: args.projection.reserveIndemnity,
      reserveFees: args.projection.reserveFees,
      recoveriesReceived: args.projection.recoveriesReceived + args.projection.salvageRealized,
      recoveriesExpected: args.projection.recoveriesExpected + args.projection.salvageExpected,
      referredToUw: args.projection.referredToUw,
      denied: args.projection.denied,
      deniedAt: args.projection.deniedAt ? new Date(args.projection.deniedAt) : undefined,
      closedAt: args.projection.closedAt ? new Date(args.projection.closedAt) : undefined,
      reopenedAt: args.projection.reopenedAt ? new Date(args.projection.reopenedAt) : undefined,
      withdrawnAt: args.projection.withdrawnAt ? new Date(args.projection.withdrawnAt) : undefined,
      data: snapshotData as PrismaInputJsonValue,
    } as unknown as PrismaClaimProjectionSnapshotUncheckedCreateInput,
  });
}
