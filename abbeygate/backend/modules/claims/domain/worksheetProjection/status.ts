// CR0105 status + phase derivation. Extracted from
// `../worksheetProjection.ts` in sprint follow-up F4a.

import type { ClaimWorksheetProjection, ClaimWorksheetStatus, LedgerState } from './types.js';

export function deriveCr0105Status(state: LedgerState, reportPeriodEnd?: Date): ClaimWorksheetStatus {
  if (state.withdrawnAt) return 'WITHDRAWN';
  if (state.denied) return 'DENIED';
  if (state.reopenedAt && !state.closedAt) return 'REOPENED';
  if (state.closedAt) {
    if (state.recoveriesExpected > 0 || state.salvageExpected > 0) return 'CLOSED_RECOVERY_PURSUED';
    if (reportPeriodEnd) {
      const closedDate = new Date(state.closedAt);
      if (closedDate.getUTCFullYear() === reportPeriodEnd.getUTCFullYear() && closedDate.getUTCMonth() === reportPeriodEnd.getUTCMonth()) {
        return 'CLOSED_THIS_MONTH';
      }
    }
    return 'CLOSED';
  }
  if (!state.firstNotifiedAt) return 'PENDING';

  const oi = state.reserveIndemnity;
  const of = state.reserveFees;
  const pi = state.paidIndemnity;
  const pf = state.paidFees;

  if (oi === 0 && pi > 0 && of > 0) return 'OPEN_CLAIM_PAID_FEES_OUTSTANDING';
  if (of === 0 && pf > 0 && oi > 0) return 'OPEN_FEES_PAID_CLAIMS_OUTSTANDING';
  if (oi === 0 && of === 0 && (pi > 0 || pf > 0)) return 'OPEN_CLAIM_AND_FEES_PAID';
  return 'OPEN';
}


export function derivePhase(state: LedgerState): ClaimWorksheetProjection["phase"] {
  if (!state.fnolCurrentVersion || state.fnolCurrentVersion !== state.fnolConfirmedVersion) return 'INTAKE';
  if (state.closedAt || state.withdrawnAt) return 'CLOSED';
  if (state.denied || state.totalOutstanding === 0) return 'DECISION';
  if (state.totalPaid > 0) return 'SETTLEMENT';
  if (state.firstReserveEstablishedAt) return 'INVESTIGATION';
  return 'INTAKE';
}
