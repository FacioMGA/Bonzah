type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

export type AbandonCardcorpCheckoutInput = {
  policyId: string;
  actor: { id?: string; role?: string; name?: string };
  paymentId: string;
  checkoutId: string;
};

export type AbandonCardcorpCheckoutRepoPort = {
  findPaymentAttempt(args: { policyId: string; paymentId: string; checkoutId: string }): Promise<{
    id: string;
    status: string;
    paymentId: string | null;
    checkoutId: string | null;
    responsePayload: unknown;
    raw: unknown;
  } | null>;
  cancelPaymentAttempt(args: {
    paymentId: string;
    responsePayload: unknown;
    raw: unknown;
  }): Promise<{ id: string; status: string }>;
  createCancelEvent(paymentId: string): Promise<void>;
  enqueuePolicyListUpdate(policyId: string): Promise<void>;
};

export type AbandonCardcorpCheckoutAuditPort = {
  logAuditEvent(policyId: string, eventType: string, actor: { id?: string; role?: string; name?: string }, payload: Record<string, unknown>): void;
};

export async function abandonCardcorpCheckoutUseCase(
  input: AbandonCardcorpCheckoutInput,
  deps: {
    repo: AbandonCardcorpCheckoutRepoPort;
    audit: AbandonCardcorpCheckoutAuditPort;
    nowIso: () => string;
  }
): Promise<UseCaseResult> {
  if (!input.paymentId && !input.checkoutId) {
    return {
      status: 400,
      body: { success: false, error: { code: 'BAD_REQUEST', message: 'paymentId or checkoutId is required' } },
    };
  }

  const payment = await deps.repo.findPaymentAttempt({
    policyId: input.policyId,
    paymentId: input.paymentId,
    checkoutId: input.checkoutId,
  });
  if (!payment) {
    return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'Payment attempt not found' } } };
  }

  const st = String(payment.status || '').toUpperCase();
  const hasProviderPaymentId = Boolean(String(payment.paymentId || '').trim());
  if (hasProviderPaymentId || st === 'PAID' || st === 'CAPTURED' || st === 'AUTHORIZED') {
    return { status: 200, body: { success: true, data: { ignored: true, status: st } } };
  }

  const abandonedAt = deps.nowIso();
  const updated = await deps.repo.cancelPaymentAttempt({
    paymentId: payment.id,
    responsePayload: { ...((payment.responsePayload as Record<string, unknown>) || {}), abandoned: true, abandonedAt },
    raw: { ...((payment.raw as Record<string, unknown>) || {}), abandoned: true, abandonedAt },
  });
  await deps.repo.enqueuePolicyListUpdate(input.policyId);
  await deps.repo.createCancelEvent(payment.id);

  deps.audit.logAuditEvent(input.policyId, 'PAYMENT.CHECKOUT_ABANDONED', input.actor, {
    paymentId: payment.id,
    checkoutId: payment.checkoutId || '',
  });

  return { status: 200, body: { success: true, data: { paymentId: updated.id, status: updated.status } } };
}
