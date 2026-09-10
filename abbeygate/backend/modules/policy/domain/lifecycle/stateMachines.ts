export type PolicyLifecycleStatus =
  | 'DRAFT'
  | 'INTAKE'
  | 'REFERRAL'
  | 'INFO_REQUIRED'
  | 'QUOTED'
  | 'AWAITING_PAYMENT'
  | 'BOUND'
  | 'BOUND_DRAFT_ISSUED'
  | 'ISSUING'
  | 'ISSUED'
  | 'ACTIVE'
  | 'DECLINED'
  | 'CANCELLATION_REQUESTED'
  | 'CANCELLED'
  | 'EXPIRED';

export type UwWorkflowStatus =
  | 'NOT_STARTED'
  | 'CUSTOMER_STARTED'
  | 'UW_STARTED'
  | 'QUESTIONNAIRE_SENT'
  | 'FOLLOWUPS_OPEN'
  | 'QUOTE_READY';

export type RiskTransactionStatus = 'DRAFT' | 'REFERRED' | 'APPROVED' | 'BOUND' | 'PENDING_DOCS';
export type PaymentGatewayStatus = 'INITIATED' | 'REDIRECTED' | 'AUTHORIZED' | 'CAPTURED' | 'PAID' | 'FAILED' | 'CANCELLED';
export type DocumentSetStatus = 'PENDING' | 'ISSUED' | 'FAILED' | 'SUPERSEDED';

const POLICY_TRANSITIONS: Record<PolicyLifecycleStatus, PolicyLifecycleStatus[]> = {
  DRAFT: ['INTAKE', 'QUOTED'],
  INTAKE: ['DRAFT', 'QUOTED', 'REFERRAL', 'INFO_REQUIRED', 'DECLINED'],
  REFERRAL: ['DRAFT', 'QUOTED', 'DECLINED', 'INFO_REQUIRED'],
  INFO_REQUIRED: ['DRAFT', 'INTAKE', 'QUOTED', 'DECLINED'],
  QUOTED: ['DRAFT', 'AWAITING_PAYMENT', 'BOUND', 'ISSUING', 'ISSUED', 'ACTIVE', 'DECLINED', 'INFO_REQUIRED', 'CANCELLATION_REQUESTED'],
  AWAITING_PAYMENT: ['DRAFT', 'BOUND', 'ISSUED', 'ACTIVE', 'DECLINED', 'QUOTED', 'CANCELLATION_REQUESTED'],
  BOUND: ['BOUND_DRAFT_ISSUED', 'ISSUING', 'ISSUED', 'CANCELLATION_REQUESTED'],
  BOUND_DRAFT_ISSUED: ['ISSUED', 'CANCELLATION_REQUESTED'],
  ISSUING: ['ISSUED', 'ACTIVE', 'CANCELLATION_REQUESTED'],
  ISSUED: ['ACTIVE', 'CANCELLATION_REQUESTED'],
  ACTIVE: ['EXPIRED', 'CANCELLATION_REQUESTED'],
  CANCELLATION_REQUESTED: ['CANCELLED', 'ACTIVE'],
  CANCELLED: [],
  EXPIRED: [],
  DECLINED: ['DRAFT'],
};

const UW_TRANSITIONS: Record<UwWorkflowStatus, UwWorkflowStatus[]> = {
  NOT_STARTED: ['CUSTOMER_STARTED', 'UW_STARTED', 'QUESTIONNAIRE_SENT'],
  CUSTOMER_STARTED: ['QUESTIONNAIRE_SENT', 'QUOTE_READY', 'FOLLOWUPS_OPEN'],
  UW_STARTED: ['QUESTIONNAIRE_SENT', 'QUOTE_READY', 'FOLLOWUPS_OPEN'],
  QUESTIONNAIRE_SENT: ['FOLLOWUPS_OPEN', 'QUOTE_READY'],
  FOLLOWUPS_OPEN: ['QUOTE_READY'],
  QUOTE_READY: ['FOLLOWUPS_OPEN'],
};

const RISK_TRANSITIONS: Record<RiskTransactionStatus, RiskTransactionStatus[]> = {
  DRAFT: ['REFERRED', 'APPROVED'],
  REFERRED: ['APPROVED', 'DRAFT'],
  APPROVED: ['BOUND'],
  BOUND: ['PENDING_DOCS', 'DRAFT'],
  PENDING_DOCS: ['BOUND'],
};

const PAYMENT_TRANSITIONS: Record<PaymentGatewayStatus, PaymentGatewayStatus[]> = {
  INITIATED: ['REDIRECTED', 'FAILED', 'CANCELLED'],
  REDIRECTED: ['AUTHORIZED', 'FAILED', 'CANCELLED'],
  AUTHORIZED: ['CAPTURED', 'PAID', 'FAILED', 'CANCELLED'],
  CAPTURED: ['PAID'],
  PAID: [],
  FAILED: [],
  CANCELLED: [],
};

const DOCSET_TRANSITIONS: Record<DocumentSetStatus, DocumentSetStatus[]> = {
  PENDING: ['ISSUED', 'FAILED', 'SUPERSEDED'],
  ISSUED: ['SUPERSEDED'],
  FAILED: [],
  SUPERSEDED: [],
};

function normalize(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
}

function assertGenericTransition(from: string, to: string, table: Record<string, string[]>, domain: string): void {
  if (from === to) return;
  const allowed = table[from] || [];
  if (!allowed.includes(to)) {
    throw new Error(`${domain} transition not allowed: ${from} -> ${to}`);
  }
}

export function assertPolicyTransitionAllowed(fromRaw: unknown, toRaw: unknown): void {
  const from = normalize(fromRaw) as PolicyLifecycleStatus;
  const to = normalize(toRaw) as PolicyLifecycleStatus;
  assertGenericTransition(from, to, POLICY_TRANSITIONS, 'PolicyLifecycle');
}

export function assertUwTransitionAllowed(fromRaw: unknown, toRaw: unknown): void {
  const from = normalize(fromRaw) as UwWorkflowStatus;
  const to = normalize(toRaw) as UwWorkflowStatus;
  assertGenericTransition(from, to, UW_TRANSITIONS, 'UwWorkflow');
}

export function assertRiskTransactionTransitionAllowed(fromRaw: unknown, toRaw: unknown): void {
  const from = normalize(fromRaw) as RiskTransactionStatus;
  const to = normalize(toRaw) as RiskTransactionStatus;
  assertGenericTransition(from, to, RISK_TRANSITIONS, 'RiskTransaction');
}

export function assertPaymentTransitionAllowed(fromRaw: unknown, toRaw: unknown): void {
  const from = normalize(fromRaw) as PaymentGatewayStatus;
  const to = normalize(toRaw) as PaymentGatewayStatus;
  assertGenericTransition(from, to, PAYMENT_TRANSITIONS, 'Payment');
}

export function assertDocumentSetTransitionAllowed(fromRaw: unknown, toRaw: unknown): void {
  const from = normalize(fromRaw) as DocumentSetStatus;
  const to = normalize(toRaw) as DocumentSetStatus;
  assertGenericTransition(from, to, DOCSET_TRANSITIONS, 'DocumentSet');
}

