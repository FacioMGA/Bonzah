// Event ledger parser: replays the claim's event stream into a
// `LedgerState`. Extracted from `../worksheetProjection.ts` in
// sprint follow-up F4a.

import type { ClaimEvent, LedgerState } from './types.js';
import {
  asNumber,
  asRecord,
  emptyBuckets,
  normalizeBucket,
  recomputeTotals,
} from './internal/helpers.js';

export function parseLedger(events: ClaimEvent[]): LedgerState {
  const state: LedgerState = {
    referredToUw: false,
    denied: false,
    clarificationOpen: false,
    clarificationHistory: [],
    amendments: [],
    referralRequired: false,
    largeLossIndicator: false,
    buckets: emptyBuckets(),
    paidIndemnity: 0,
    paidFees: 0,
    reserveIndemnity: 0,
    reserveFees: 0,
    recoveriesReceived: 0,
    recoveriesExpected: 0,
    salvageRealized: 0,
    salvageExpected: 0,
    totalPaid: 0,
    totalOutstanding: 0,
    totalIncurred: 0,
    totalRecovered: 0,
    netIncurred: 0,
  };

  for (const ev of events) {
    const payload = asRecord(ev.payload);
    state.latestActivityAt = ev.occurredAt.toISOString();
    state.latestActorName = ev.actorName || state.latestActorName;
    switch (ev.eventType) {
      case 'REFERRED_SET':
        state.referredToUw = Boolean(payload.referred ?? true);
        break;
      case 'CLAIM_OPENED':
        if (!state.firstNotifiedAt) state.firstNotifiedAt = ev.occurredAt.toISOString();
        break;
      case 'POLICY_LINKED':
        state.policyLinkedAt = String(payload.linkedAt || ev.occurredAt.toISOString());
        break;
      case 'REFERRAL_REQUIRED':
        state.referralRequired = true;
        state.referralApprovedAt = undefined;
        break;
      case 'REFERRAL_APPROVED':
        state.referralRequired = false;
        state.referralApprovedAt = String(payload.approvedAt || ev.occurredAt.toISOString());
        break;
      case 'DENIAL_SET':
      case 'CLAIM_DENIED':
        state.denied = true;
        state.deniedAt = String(payload.deniedAt || ev.occurredAt.toISOString());
        state.denialReason = String(payload.summary || payload.reason || payload.reasonCode || '');
        break;
      case 'CLAIM_CLOSED':
        state.closedAt = String(payload.closedAt || ev.occurredAt.toISOString());
        break;
      case 'CLAIM_REOPENED':
        state.reopenedAt = String(payload.reopenedAt || ev.occurredAt.toISOString());
        state.closedAt = undefined;
        state.withdrawnAt = undefined;
        state.denied = false;
        state.deniedAt = undefined;
        state.denialReason = undefined;
        break;
      case 'CLAIM_WITHDRAWN':
        state.withdrawnAt = String(payload.withdrawnAt || ev.occurredAt.toISOString());
        break;
      case 'RESERVE_SET':
      case 'RESERVE_ADJ': {
        const bucket = normalizeBucket(payload.bucket);
        const amount = asNumber(payload.newOutstandingAmount ?? payload.amount);
        state.buckets[bucket].outstanding = Math.max(0, amount);
        if (!state.firstReserveEstablishedAt) state.firstReserveEstablishedAt = ev.occurredAt.toISOString();
        break;
      }
      case 'PAYMENT_ADDED': {
        const bucket = normalizeBucket(payload.bucket);
        const amount = Math.max(0, asNumber(payload.amount));
        state.buckets[bucket].paid += amount;
        if (payload.autoReduceReserve !== false) {
          state.buckets[bucket].outstanding = Math.max(0, state.buckets[bucket].outstanding - amount);
        }
        break;
      }
      case 'PAYMENT_INDEMNITY':
        state.buckets.INDEMNITY.paid += Math.max(0, asNumber(payload.amount));
        break;
      case 'PAYMENT_FEES':
        state.buckets.LEGAL_FEES.paid += Math.max(0, asNumber(payload.amount));
        break;
      case 'RECOVERY_RECEIVED': {
        const bucket = normalizeBucket(payload.bucket, 'INDEMNITY');
        const amount = Math.max(0, asNumber(payload.amount));
        if (String(payload.recoveryType || '').toUpperCase() === 'SALVAGE') {
          state.buckets[bucket].salvageRealized += amount;
        } else {
          state.buckets[bucket].recovered += amount;
        }
        break;
      }
      case 'RECOVERY_EXPECTED': {
        const bucket = normalizeBucket(payload.bucket, 'INDEMNITY');
        const amount = Math.max(0, asNumber(payload.amount));
        if (String(payload.recoveryType || '').toUpperCase() === 'SALVAGE') {
          state.buckets[bucket].salvageExpected = amount;
        } else {
          state.buckets[bucket].recoveryExpected = amount;
        }
        break;
      }
      case 'FNOL_SUBMITTED': {
        const fromPayload = Number(payload.version);
        const nextVersion = Number.isFinite(fromPayload) && fromPayload > 0 ? fromPayload : (state.fnolCurrentVersion || 0) + 1;
        state.fnolCurrentVersion = nextVersion;
        state.fnolSnapshot = asRecord(payload.fnol);
        state.fnolSubmittedAt = String(payload.submittedAt || ev.occurredAt.toISOString());
        state.fnolSubmittedBy = { actorType: ev.actorType || undefined, actorId: ev.actorId || undefined, actorName: ev.actorName || undefined };
        state.clarificationOpen = false;
        break;
      }
      case 'FNOL_CONFIRMED':
        state.fnolConfirmedVersion = Number(payload.confirmedVersion || state.fnolCurrentVersion || 0) || undefined;
        state.fnolConfirmedAt = String(payload.confirmedAt || ev.occurredAt.toISOString());
        state.fnolConfirmedBy = { actorType: ev.actorType || undefined, actorId: ev.actorId || undefined, actorName: ev.actorName || undefined };
        break;
      case 'FNOL_CLARIFICATION_REQUESTED':
        state.clarificationOpen = true;
        state.clarificationHistory.push({
          requestId: String(payload.requestId || `clar-${state.clarificationHistory.length + 1}`),
          sentAt: String(payload.requestedAt || ev.occurredAt.toISOString()),
          sentBy: { actorType: ev.actorType || undefined, actorId: ev.actorId || undefined, actorName: ev.actorName || undefined },
          fieldsRequested: Array.isArray(payload.fieldsRequested) ? payload.fieldsRequested.map((v) => String(v)) : [],
          message: String(payload.message || ''),
        });
        break;
      case 'FNOL_CLARIFICATION_RECEIVED':
        state.clarificationOpen = false;
        {
          const requestId = String(payload.requestId || '');
          const target = requestId
            ? [...state.clarificationHistory].reverse().find((item) => item.requestId === requestId)
            : [...state.clarificationHistory].reverse().find((item) => !item.receivedAt);
          if (target) {
            target.receivedAt = String(payload.receivedAt || ev.occurredAt.toISOString());
            target.receivedBy = { actorType: ev.actorType || undefined, actorId: ev.actorId || undefined, actorName: ev.actorName || undefined };
            target.responseMessage = String(payload.message || '');
          }
        }
        break;
      case 'FNOL_AMENDED': {
        const fromVersion = Number(payload.fromVersion || state.fnolCurrentVersion || 0);
        const toVersion = Number(payload.toVersion || fromVersion + 1);
        state.fnolCurrentVersion = toVersion;
        state.fnolSnapshot = asRecord(payload.fnol);
        state.fnolSubmittedAt = String(payload.amendedAt || ev.occurredAt.toISOString());
        state.fnolSubmittedBy = { actorType: ev.actorType || undefined, actorId: ev.actorId || undefined, actorName: ev.actorName || undefined };
        state.clarificationOpen = false;
        state.amendments.push({
          fromVersion,
          toVersion,
          amendedAt: String(payload.amendedAt || ev.occurredAt.toISOString()),
          amendedBy: { actorType: ev.actorType || undefined, actorId: ev.actorId || undefined, actorName: ev.actorName || undefined },
          changes: Array.isArray(payload.changes) ? (payload.changes as Array<{ path: string; from: unknown; to: unknown }>) : undefined,
        });
        if (state.fnolConfirmedVersion && state.fnolConfirmedVersion < toVersion) {
          state.fnolConfirmedVersion = undefined;
          state.fnolConfirmedAt = undefined;
          state.fnolConfirmedBy = undefined;
        }
        break;
      }
      case 'LARGE_LOSS_FLAGGED':
        state.largeLossIndicator = true;
        state.largeLossNotifiedAt = String(payload.flaggedAt || ev.occurredAt.toISOString());
        break;
      case 'DEDUCTIBLE_LOCKED':
        state.lockedDeductible = asNumber(payload.deductibleAmount);
        break;
      default:
        break;
    }
    recomputeTotals(state);
  }
  return state;
}

