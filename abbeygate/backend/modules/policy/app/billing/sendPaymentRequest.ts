export type SendPaymentRequestInput = {
  policyId: string;
  actor: { id?: string; role?: string; name?: string };
  amount: number;
  email?: string;
  ttlHours?: number;
  riskTransactionId: string | null;
  balanceSnapshot: number;
  appUrl: string;
};

type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

type PolicyContact = {
  policyId: string;
  policyNumber: string;
  publicSessionToken: string;
  quoteData: Record<string, unknown>;
  policyHolderName: string;
  policyHolderContact: Record<string, unknown>;
};

export type SendPaymentRequestRepoPort = {
  findPolicyContact(policyId: string): Promise<PolicyContact | null>;
  ensurePublicSessionToken(policyId: string, nextToken: string): Promise<void>;
  upsertPaymentRequestState(args: {
    policyId: string;
    token: string;
    amount: number;
    balanceSnapshot: number | null;
    requestedBy: string | null;
    expiresAtIso: string;
    email: string;
    riskTransactionId: string | null;
    paymentUrl: string;
  }): Promise<void>;
  enqueuePolicyListUpdate(policyId: string): Promise<void>;
};

export type SendPaymentRequestNotificationsPort = {
  sendPaymentRequestEmail(args: {
    toEmail: string;
    contactName: string;
    policyNumber: string;
    amount: number;
    paymentUrl: string;
    expiresAtIso: string;
    balanceSnapshot?: number;
    entityType?: 'POLICY' | 'CLAIM' | 'ACCOUNT' | 'QUOTE' | 'PARTY' | 'CASE' | 'INVOICE';
    entityId?: string;
  }): Promise<boolean>;
};

export type SendPaymentRequestFactoryPort = {
  createToken(): string;
  createPublicSessionToken(): string;
  now(): Date;
  defaultTtlHours(): number;
};

export type SendPaymentRequestAuditPort = {
  logAuditEvent(policyId: string, eventType: string, actor: { id?: string; role?: string; name?: string }, payload: Record<string, unknown>): void;
};

export async function sendPaymentRequestUseCase(
  input: SendPaymentRequestInput,
  deps: {
    repo: SendPaymentRequestRepoPort;
    notifications: SendPaymentRequestNotificationsPort;
    factory: SendPaymentRequestFactoryPort;
    audit: SendPaymentRequestAuditPort;
  }
): Promise<UseCaseResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { status: 400, body: { success: false, error: { code: 'BAD_REQUEST', message: 'amount must be positive' } } };
  }

  const policy = await deps.repo.findPolicyContact(input.policyId);
  if (!policy) {
    return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } } };
  }

  const to = String(input.email || policy.policyHolderContact.email || '').trim();
  if (!to) {
    return { status: 400, body: { success: false, error: { code: 'BAD_REQUEST', message: 'Policyholder email is required' } } };
  }

  const ttlHours = Math.max(1, Number(input.ttlHours || deps.factory.defaultTtlHours()));
  const expiresAt = new Date(deps.factory.now().getTime() + ttlHours * 3600 * 1000);
  const token = deps.factory.createToken();
  const publicSessionToken = String(policy.publicSessionToken || '').trim() || deps.factory.createPublicSessionToken();
  if (publicSessionToken !== String(policy.publicSessionToken || '').trim()) {
    await deps.repo.ensurePublicSessionToken(input.policyId, publicSessionToken);
  }

  const paymentUrlQuery = new URLSearchParams({
    step: 'payment',
    request: token,
    source: 'bo-billing',
    amount: input.amount.toFixed(2),
  });
  if (Number.isFinite(input.balanceSnapshot)) {
    paymentUrlQuery.set('balance', input.balanceSnapshot.toFixed(2));
  }
  const paymentUrl = `${input.appUrl.replace(/\/$/, '')}/quote/${encodeURIComponent(publicSessionToken)}?${paymentUrlQuery.toString()}`;
  const proposer =
    policy.quoteData?.proposer && typeof policy.quoteData.proposer === 'object'
      ? (policy.quoteData.proposer as Record<string, unknown>)
      : {};
  const customerName =
    String(policy.policyHolderName || '').trim() ||
    `${String(proposer.firstName || '')} ${String(proposer.lastName || '')}`.trim() ||
    'there';

  const emailOk = await deps.notifications.sendPaymentRequestEmail({
    toEmail: to,
    contactName: customerName,
    policyNumber: policy.policyNumber,
    amount: input.amount,
    paymentUrl,
    expiresAtIso: expiresAt.toISOString(),
    balanceSnapshot: Number.isFinite(input.balanceSnapshot) ? input.balanceSnapshot : undefined,
    entityType: 'POLICY',
    entityId: input.policyId,
  });
  if (!emailOk) {
    return {
      status: 500,
      body: {
        success: false,
        error: { code: 'EMAIL_SEND_FAILED', message: 'Failed to send payment request email' },
      },
    };
  }

  await deps.repo.upsertPaymentRequestState({
    policyId: input.policyId,
    token,
    amount: input.amount,
    balanceSnapshot: Number.isFinite(input.balanceSnapshot) ? input.balanceSnapshot : null,
    requestedBy: input.actor?.id || null,
    expiresAtIso: expiresAt.toISOString(),
    email: to,
    riskTransactionId: input.riskTransactionId,
    paymentUrl,
  });
  await deps.repo.enqueuePolicyListUpdate(input.policyId);
  deps.audit.logAuditEvent(input.policyId, 'PAYMENT.REQUEST_SENT', input.actor, {
    amount: input.amount,
    to,
    expiresAt: expiresAt.toISOString(),
  });

  return {
    status: 200,
    body: {
      success: true,
      data: {
        to,
        amount: input.amount,
        currency: 'EUR',
        paymentUrl,
        expiresAt: expiresAt.toISOString(),
      },
    },
  };
}
