import { resolveLifecycleStatus, type LifecycleStatus } from './status.js';

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};

const asSnapshot = (value: unknown): UnknownRecord => {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return asRecord(value);
};

export type BOStatus =
  | 'DRAFT'
  | 'INTAKE'
  | 'QUOTED'
  | 'AWAITING_PAYMENT'
  | 'AWAITING_EXTERNAL_ISSUANCE'
  | 'REFERRAL'
  | 'INFO_REQUIRED'
  | 'ISSUED'
  | 'ACTIVE'
  | 'ENDORSEMENT_IN_PROGRESS'
  | 'RENEWAL_IN_PROGRESS'
  | 'CANCELLATION_REQUESTED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'CANCELLED';

export type AcuteStatus = 'NONE' | 'CUSTOMER_ACTION_REQUIRED' | 'UW_ACTION_REQUIRED' | 'OPS_ACTION_REQUIRED';
export type OperationRunning = 'NONE' | 'CANCELLATION' | 'ENDORSEMENT' | 'RENEWAL' | 'PAYMENT';

export type PolicyState = {
  lifecycleStatus: LifecycleStatus;
  boStatus: BOStatus;
  acuteStatus: AcuteStatus;
  operationRunning: OperationRunning;
  boStatusSortRank: number;
  isPolicy: boolean;
  isActive: boolean;
  isIssued: boolean;
  isBindable: boolean;
  hasPendingTransactions: boolean;
  hasEndorsementDraft: boolean;
  hasCancellationRequest: boolean;
  hasRenewalInProgress: boolean;
  hasOpenClaims: boolean;
};

export type PolicyStateInput = {
  status?: unknown;
  inceptionDate?: Date | string | null;
  expiryDate?: Date | string | null;
  isLocked?: unknown;
  stateCurrentSnapshot?: unknown;
  riskTransactions?: Array<{ status?: unknown; transactionType?: unknown }>;
  claims?: Array<{ status?: unknown }>;
  issueReadiness?: { canIssue?: boolean } | null;
};

const OPEN_CLAIM_STATUSES = new Set(['OPEN', 'PENDING', 'QUERIED', 'REFERRED', 'IN_LITIGATION', 'AWAITING_SETTLEMENT']);
const PENDING_TX_STATUSES = new Set(['DRAFT', 'REFERRED', 'APPROVED', 'PENDING_DOCS']);

function toUpper(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function boolFromLoose(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const s = String(value || '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

export function boStatusSortRankFor(value: unknown): number {
  const status = toUpper(value);
  if (status === 'CANCELLATION_REQUESTED') return 10;
  if (status === 'ENDORSEMENT_IN_PROGRESS') return 20;
  if (status === 'RENEWAL_IN_PROGRESS') return 30;
  if (status === 'INFO_REQUIRED') return 40;
  if (status === 'REFERRAL') return 50;
  if (status === 'AWAITING_PAYMENT') return 60;
  if (status === 'AWAITING_EXTERNAL_ISSUANCE') return 55;
  if (status === 'QUOTED') return 70;
  if (status === 'INTAKE') return 80;
  if (status === 'DRAFT') return 90;
  if (status === 'ISSUED') return 100;
  if (status === 'ACTIVE') return 110;
  if (status === 'EXPIRED') return 120;
  if (status === 'DECLINED') return 130;
  if (status === 'CANCELLED' || status === 'CANCELED') return 140;
  return 999;
}

export function derivePolicyState(input: PolicyStateInput): PolicyState {
  const lifecycleStatus = resolveLifecycleStatus(input.status, {
    inceptionDate: input.inceptionDate ?? null,
    expiryDate: input.expiryDate ?? null,
  });

  const snapshot = asSnapshot(input.stateCurrentSnapshot);
  const cancellationRequest = asRecord(snapshot.cancellationRequest);
  const cancellationRequestStatus = toUpper(cancellationRequest.status);
  const renewal = asRecord(snapshot.renewal);
  const renewalStatus = toUpper(renewal.status);
  const workspace = asRecord(snapshot.endorsementWorkspace);
  const workspaceTransactionType = toUpper(workspace.transactionType);

  const hasEndorsementDraftFromSnapshot = Boolean(workspace.reasonCode) && workspaceTransactionType !== 'RENEWAL';
  const hasEndorsementDraftFromTx = (input.riskTransactions || []).some(
    (tx) => toUpper(tx.transactionType) === 'ENDORSEMENT' && toUpper(tx.status) === 'DRAFT'
  );
  const hasEndorsementDraft = hasEndorsementDraftFromSnapshot || hasEndorsementDraftFromTx;

  const hasPendingTransactions = (input.riskTransactions || []).some((tx) => PENDING_TX_STATUSES.has(toUpper(tx.status)));
  const hasRenewalInProgress =
    workspaceTransactionType === 'RENEWAL' ||
    ['DRAFT', 'PENDING', 'IN_PROGRESS', 'PAYMENT_PENDING', 'QUOTED'].includes(renewalStatus);
  const hasCancellationRequest =
    lifecycleStatus === 'CANCELLATION_REQUESTED' || ['RECEIVED', 'PROCESSING'].includes(cancellationRequestStatus);
  const hasOpenClaims = (input.claims || []).some((claim) => OPEN_CLAIM_STATUSES.has(toUpper(claim.status)));

  let boStatus: BOStatus = 'DRAFT';
  if (lifecycleStatus === 'CANCELLED') boStatus = 'CANCELLED';
  else if (lifecycleStatus === 'EXPIRED') boStatus = 'EXPIRED';
  else if (hasCancellationRequest) boStatus = 'CANCELLATION_REQUESTED';
  else if (hasEndorsementDraft) boStatus = 'ENDORSEMENT_IN_PROGRESS';
  else if (hasRenewalInProgress) boStatus = 'RENEWAL_IN_PROGRESS';
  else if (lifecycleStatus === 'REFERRAL') boStatus = 'REFERRAL';
  else if (lifecycleStatus === 'INFO_REQUIRED') boStatus = 'INFO_REQUIRED';
  else if (lifecycleStatus === 'AWAITING_PAYMENT') boStatus = 'AWAITING_PAYMENT';
  else if (lifecycleStatus === 'AWAITING_EXTERNAL_ISSUANCE') boStatus = 'AWAITING_EXTERNAL_ISSUANCE';
  else if (lifecycleStatus === 'DECLINED') boStatus = 'DECLINED';
  else if (lifecycleStatus === 'ACTIVE') boStatus = 'ACTIVE';
  else if (lifecycleStatus === 'ISSUED' || lifecycleStatus === 'BOUND' || lifecycleStatus === 'BOUND_DRAFT_ISSUED') boStatus = 'ISSUED';
  else if (lifecycleStatus === 'QUOTED') boStatus = 'QUOTED';
  else if (lifecycleStatus === 'INTAKE') boStatus = 'INTAKE';

  let acuteStatus: AcuteStatus = 'NONE';
  if (boStatus === 'INFO_REQUIRED' || boStatus === 'AWAITING_PAYMENT') acuteStatus = 'CUSTOMER_ACTION_REQUIRED';
  else if (boStatus === 'REFERRAL') acuteStatus = 'UW_ACTION_REQUIRED';
  else if (boStatus === 'AWAITING_EXTERNAL_ISSUANCE') acuteStatus = 'OPS_ACTION_REQUIRED';
  else if (boStatus === 'CANCELLATION_REQUESTED' || boStatus === 'ENDORSEMENT_IN_PROGRESS' || hasOpenClaims) acuteStatus = 'OPS_ACTION_REQUIRED';

  let operationRunning: OperationRunning = 'NONE';
  if (hasCancellationRequest) operationRunning = 'CANCELLATION';
  else if (hasEndorsementDraft) operationRunning = 'ENDORSEMENT';
  else if (hasRenewalInProgress) operationRunning = 'RENEWAL';
  else if (lifecycleStatus === 'AWAITING_PAYMENT') operationRunning = 'PAYMENT';

  const isIssued = ['ISSUED', 'ACTIVE', 'BOUND', 'BOUND_DRAFT_ISSUED'].includes(lifecycleStatus);
  const isActive = lifecycleStatus === 'ACTIVE';
  const issueReady = Boolean(input.issueReadiness?.canIssue);
  const blockedForBind = ['CANCELLED', 'EXPIRED', 'DECLINED'].includes(lifecycleStatus) || hasCancellationRequest || boolFromLoose(input.isLocked);
  const isBindable = issueReady || (!blockedForBind && ['QUOTED', 'AWAITING_PAYMENT', 'REFERRAL', 'INFO_REQUIRED'].includes(lifecycleStatus));

  return {
    lifecycleStatus,
    boStatus,
    acuteStatus,
    operationRunning,
    boStatusSortRank: boStatusSortRankFor(boStatus),
    isPolicy: lifecycleStatus !== 'DRAFT' || hasPendingTransactions || hasEndorsementDraft || hasOpenClaims,
    isActive,
    isIssued,
    isBindable,
    hasPendingTransactions,
    hasEndorsementDraft,
    hasCancellationRequest,
    hasRenewalInProgress,
    hasOpenClaims,
  };
}

export function isIssuedLifecycleByPolicyState(input: PolicyStateInput): boolean {
  return derivePolicyState(input).isIssued;
}
