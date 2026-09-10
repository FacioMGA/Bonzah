import { formatAmountEUR, safeMerchantTxId } from '../../../payments/app/cardcorpGateway.js';

export type CreateCardcorpCheckoutInput = {
  policyId: string;
  actor: { id?: string; role?: string; name?: string };
  amount: number;
  currency: string;
  riskTransactionId: string | null;
  baseUrl: string;
};

type CheckoutResult = {
  status: number;
  body: Record<string, unknown>;
};

export type CreateCardcorpCheckoutConfigPort = {
  getCardcorpConfig(): {
    entityId?: string;
    bearerToken?: string;
    baseUrl: string;
    testMode?: 'EXTERNAL' | 'INTERNAL';
  };
};

export type CreateCardcorpCheckoutRepoPort = {
  findPolicy(policyId: string): Promise<{ id: string; policyNumber: string | null } | null>;
  createPaymentAttempt(args: {
    policyId: string;
    riskTransactionId: string | null;
    entityId: string;
    checkoutId: string;
    integrity?: string;
    merchantTransactionId: string;
    amount: number;
    currency: string;
    raw: unknown;
  }): Promise<{ id: string }>;
  enqueuePolicyListUpdate(policyId: string): Promise<void>;
};

export type CreateCardcorpCheckoutGatewayPort = {
  createCheckout(args: {
    entityId: string;
    bearerToken: string;
    baseUrl: string;
    amount: string;
    currency: string;
    paymentType: 'DB';
    merchantTransactionId: string;
    testMode?: 'EXTERNAL' | 'INTERNAL';
    shopperResultUrl: string;
    customParameters: Record<string, string>;
  }): Promise<{ id: string; integrity?: string; raw: unknown }>;
};

export type CreateCardcorpCheckoutAuditPort = {
  logAuditEvent(policyId: string, eventType: string, actor: { id?: string; role?: string; name?: string }, payload: Record<string, unknown>): void;
};

export async function createCardcorpCheckoutUseCase(
  input: CreateCardcorpCheckoutInput,
  deps: {
    config: CreateCardcorpCheckoutConfigPort;
    repo: CreateCardcorpCheckoutRepoPort;
    gateway: CreateCardcorpCheckoutGatewayPort;
    audit: CreateCardcorpCheckoutAuditPort;
  }
): Promise<CheckoutResult> {
  const cfg = deps.config.getCardcorpConfig();
  if (!cfg.entityId || !cfg.bearerToken) {
    return {
      status: 501,
      body: { success: false, error: { code: 'NOT_CONFIGURED', message: 'CardCorp is not configured on the server' } },
    };
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return {
      status: 400,
      body: { success: false, error: { code: 'BAD_REQUEST', message: 'amount must be a positive number' } },
    };
  }

  const policy = await deps.repo.findPolicy(input.policyId);
  if (!policy) {
    return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } } };
  }

  const shopperResultUrl = `${String(input.baseUrl || '').replace(/\/$/, '')}/policies/${input.policyId}?tab=billing`;
  const amountFormatted = formatAmountEUR(input.amount);
  const merchantTransactionId = safeMerchantTxId(`BO-${String(policy.policyNumber || input.policyId).slice(0, 18)}`);

  const checkout = await deps.gateway.createCheckout({
    entityId: cfg.entityId,
    bearerToken: cfg.bearerToken,
    baseUrl: cfg.baseUrl,
    amount: amountFormatted,
    currency: input.currency,
    paymentType: 'DB',
    merchantTransactionId,
    testMode: cfg.testMode,
    shopperResultUrl,
    customParameters: {
      policyId: input.policyId,
      initiatedBy: 'BO',
    },
  });

  const payment = await deps.repo.createPaymentAttempt({
    policyId: input.policyId,
    riskTransactionId: input.riskTransactionId,
    entityId: cfg.entityId,
    checkoutId: checkout.id,
    integrity: checkout.integrity,
    merchantTransactionId,
    amount: input.amount,
    currency: input.currency,
    raw: checkout.raw,
  });
  await deps.repo.enqueuePolicyListUpdate(input.policyId);

  deps.audit.logAuditEvent(input.policyId, 'PAYMENT.CHECKOUT_CREATED', input.actor, {
    paymentId: payment.id,
    checkoutId: checkout.id,
    amount: input.amount,
    currency: input.currency,
  });

  return {
    status: 200,
    body: {
      success: true,
      data: {
        paymentId: payment.id,
        checkoutId: checkout.id,
        integrity: checkout.integrity,
        widgetScriptUrl: `${cfg.baseUrl}/v1/paymentWidgets.js?checkoutId=${encodeURIComponent(checkout.id)}`,
        shopperResultUrl,
        amount: amountFormatted,
        currency: input.currency,
        brands: 'VISA MASTER',
      },
    },
  };
}
