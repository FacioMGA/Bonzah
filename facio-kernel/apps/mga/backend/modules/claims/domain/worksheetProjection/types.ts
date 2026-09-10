// Claim worksheet projection — types only.
// Extracted from `../worksheetProjection.ts` in sprint follow-up F4a.

export type ClaimEvent = {
  id: string;
  eventType: string;
  occurredAt: Date;
  payload: unknown;
  actorType?: string | null;
  actorId?: string | null;
  actorName?: string | null;
};

export type ClaimWorksheetStatus =
  | 'PENDING'
  | 'OPEN'
  | 'DENIED'
  | 'CLOSED'
  | 'CLOSED_THIS_MONTH'
  | 'REOPENED'
  | 'WITHDRAWN'
  | 'OPEN_CLAIM_PAID_FEES_OUTSTANDING'
  | 'OPEN_FEES_PAID_CLAIMS_OUTSTANDING'
  | 'OPEN_CLAIM_AND_FEES_PAID'
  | 'CLOSED_RECOVERY_PURSUED';

export type ClaimBucket =
  | 'INDEMNITY'
  | 'DEFENCE_COSTS'
  | 'ADJUSTER_FEES'
  | 'LEGAL_FEES'
  | 'OTHER';

export type Money = number;

export type BucketState = {
  paid: Money;
  outstanding: Money;
  recovered: Money;
  recoveryExpected: Money;
  salvageRealized: Money;
  salvageExpected: Money;
};

export type ActorRef = { actorType?: string; actorId?: string; actorName?: string };

export type IntakeGate = { key: string; label: string; status: 'PASS' | 'FAIL'; reason?: string };

export type RequiredAction = {
  id: string;
  title: string;
  severity: 'BLOCKING' | 'IMPORTANT' | 'INFO';
  cta?: { label: string; commandType: string };
  reason?: string;
};

export type IntakeProjection = {
  status: 'NONE' | 'FNOL_SUBMITTED' | 'AWAITING_CLARIFICATION' | 'FNOL_CONFIRMED';
  currentVersion?: number;
  confirmedVersion?: number;
  fnol?: Record<string, unknown>;
  submittedAt?: string;
  submittedBy?: ActorRef;
  confirmedAt?: string;
  confirmedBy?: ActorRef;
  clarificationOpen: boolean;
  clarificationHistory: Array<{
    requestId: string;
    sentAt: string;
    sentBy?: ActorRef;
    fieldsRequested: string[];
    message?: string;
    receivedAt?: string;
    receivedBy?: ActorRef;
    responseMessage?: string;
  }>;
  amendments: Array<{
    fromVersion: number;
    toVersion: number;
    amendedAt: string;
    amendedBy?: ActorRef;
    changes?: Array<{ path: string; from: unknown; to: unknown }>;
  }>;
  changedFields: Array<{
    path: string;
    changedAt: string;
    changedBy?: ActorRef;
  }>;
  gates: IntakeGate[];
  requiredActions: RequiredAction[];
};

export type LedgerState = {
  firstNotifiedAt?: string;
  policyLinkedAt?: string;
  referredToUw: boolean;
  denied: boolean;
  deniedAt?: string;
  denialReason?: string;
  closedAt?: string;
  reopenedAt?: string;
  withdrawnAt?: string;
  firstReserveEstablishedAt?: string;
  latestActivityAt?: string;
  latestActorName?: string;
  fnolCurrentVersion?: number;
  fnolConfirmedVersion?: number;
  fnolSnapshot?: Record<string, unknown>;
  fnolSubmittedAt?: string;
  fnolConfirmedAt?: string;
  fnolSubmittedBy?: ActorRef;
  fnolConfirmedBy?: ActorRef;
  clarificationOpen: boolean;
  clarificationHistory: IntakeProjection['clarificationHistory'];
  amendments: IntakeProjection['amendments'];
  referralRequired: boolean;
  referralApprovedAt?: string;
  largeLossIndicator: boolean;
  largeLossNotifiedAt?: string;
  lockedDeductible?: number;
  buckets: Record<ClaimBucket, BucketState>;
  paidIndemnity: Money;
  paidFees: Money;
  reserveIndemnity: Money;
  reserveFees: Money;
  recoveriesReceived: Money;
  recoveriesExpected: Money;
  salvageRealized: Money;
  salvageExpected: Money;
  totalPaid: Money;
  totalOutstanding: Money;
  totalIncurred: Money;
  totalRecovered: Money;
  netIncurred: Money;
};

export type ClaimWorksheetProjection = LedgerState & {
  claimId: string;
  claimReference: string;
  certificateReference: string;
  status: ClaimWorksheetStatus;
  cr0106ReferredToUnderwriters: 'Y' | 'N';
  cr0107Denial: 'Y' | 'N';
  totalIncurredIndemnity: Money;
  totalIncurredFees: Money;
  totalIncurredOverall: Money;
  phase: 'INTAKE' | 'INVESTIGATION' | 'DECISION' | 'SETTLEMENT' | 'CLOSED';
  intake: IntakeProjection;
  timeline: Array<{
    id: string;
    eventType: string;
    occurredAt: string;
    actorName?: string;
    payload: Record<string, unknown>;
  }>;
};
