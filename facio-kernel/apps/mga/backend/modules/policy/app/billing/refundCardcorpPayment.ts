import { formatAmountEUR, safeMerchantTxId } from '../../../payments/app/cardcorpGateway.js';
import { evaluateRefundAllowance } from '../../domain/billing/refundPolicy.js';
import { ProductRegistry } from '../../domain/ProductRegistry.js';

export type BillingActor = { id?: string; role?: string; name?: string };

type RefundResult = {
  status: number;
  body: Record<string, unknown>;
};

export type RefundCardcorpPaymentInput = {
  policyId: string;
  actor: BillingActor;
  referencePaymentId: string;
  amount: number;
  currency: string;
  riskTransactionId: string | null;
};

export type RefundCardcorpRepoPort = {
  findReferencePayment(args: { policyId: string; referencePaymentId: string }): Promise<{
    id: string;
    amount: number | null;
    paymentId: string | null;
    merchantTransactionId: string | null;
  } | null>;
  sumPreviousRefunds(args: { policyId: string; referencePaymentId: string }): Promise<number>;
  getPolicySnapshotForRefund(args: { policyId: string }): Promise<{ productType: string; snapshot: unknown } | null>;
  createRefundPayment(args: {
    policyId: string;
    riskTransactionId: string | null;
    entityId: string;
    amount: number;
    currency: string;
    paymentId: string | null;
    merchantTransactionId: string;
    referencePaymentId: string;
    referenceProviderPaymentId: string;
    raw: unknown;
  }): Promise<{ id: string }>;
  createPaymentEvent(args: {
    paymentId: string;
    eventType: 'REFUND';
    providerEventId: string | null;
    verified: boolean;
    payload: unknown;
  }): Promise<void>;
  enqueuePolicyListUpdate(policyId: string): Promise<void>;
};

export type RefundCardcorpGatewayPort = {
  refundPayment(args: {
    baseUrl: string;
    entityId: string;
    bearerToken: string;
    referencePaymentId: string;
    amount: string;
    currency: string;
    merchantTransactionId: string;
    testMode?: 'EXTERNAL' | 'INTERNAL';
  }): Promise<{
    ok: boolean;
    paymentId?: string;
    description?: string;
    raw: unknown;
  }>;
};

export type RefundCardcorpRulesPort = {
  getRoadsideRegistryFallbackPrice(): Promise<number>;
};

export type RefundCardcorpConfigPort = {
  getCardcorpConfig(): {
    entityId?: string;
    bearerToken?: string;
    baseUrl: string;
    testMode?: 'EXTERNAL' | 'INTERNAL';
  };
};

export type RefundCardcorpAuditPort = {
  logAuditEvent(policyId: string, eventType: string, actor: BillingActor, payload: Record<string, unknown>): void;
};

export async function refundCardcorpPaymentUseCase(
  input: RefundCardcorpPaymentInput,
  deps: {
    repo: RefundCardcorpRepoPort;
    gateway: RefundCardcorpGatewayPort;
    rules: RefundCardcorpRulesPort;
    config: RefundCardcorpConfigPort;
    audit: RefundCardcorpAuditPort;
  }
): Promise<RefundResult> {
  const cfg = deps.config.getCardcorpConfig();
  if (!cfg.entityId || !cfg.bearerToken) {
    return { status: 501, body: { success: false, error: { code: 'NOT_CONFIGURED', message: 'CardCorp is not configured on the server' } } };
  }

  if (!input.referencePaymentId) {
    return { status: 400, body: { success: false, error: { code: 'BAD_REQUEST', message: 'referencePaymentId is required' } } };
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { status: 400, body: { success: false, error: { code: 'BAD_REQUEST', message: 'amount must be a positive number' } } };
  }

  const refPayment = await deps.repo.findReferencePayment({
    policyId: input.policyId,
    referencePaymentId: input.referencePaymentId,
  });
  if (!refPayment) {
    return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'Reference payment not found' } } };
  }

  const refProviderPaymentId = String(refPayment.paymentId || '').trim();
  if (!refProviderPaymentId) {
    return { status: 400, body: { success: false, error: { code: 'BAD_REQUEST', message: 'Reference payment has no provider paymentId yet' } } };
  }

  const alreadyRefunded = await deps.repo.sumPreviousRefunds({
    policyId: input.policyId,
    referencePaymentId: input.referencePaymentId,
  });
  const snapshotData = await deps.repo.getPolicySnapshotForRefund({ policyId: input.policyId });
  const registryFallbackPrice = await deps.rules.getRoadsideRegistryFallbackPrice();
  const productType = String(snapshotData?.productType || '').trim().toUpperCase();
  const adapter = productType ? ProductRegistry.getInstance().getAdapter(productType) : null;
  const nonRefundableFloor = adapter?.computeNonRefundableFloor({
    snapshot: snapshotData?.snapshot ?? {},
    registryFallbackPrice,
  }) ?? 0;
  const refAmount = Number(refPayment.amount || 0);
  const allowance = evaluateRefundAllowance({
    referenceAmount: refAmount,
    alreadyRefunded,
    requestedAmount: input.amount,
    nonRefundableFloor,
  });
  if (!allowance.allowed) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Refund amount exceeds refundable balance for the reference transaction',
          details: { refAmount, alreadyRefunded, nonRefundableFloor, remaining: allowance.remaining },
        },
      },
    };
  }

  const merchantTransactionId = safeMerchantTxId(`RF-${String(refPayment.merchantTransactionId || input.referencePaymentId).slice(0, 20)}`);
  const gatewayResult = await deps.gateway.refundPayment({
    baseUrl: cfg.baseUrl,
    entityId: cfg.entityId,
    bearerToken: cfg.bearerToken,
    referencePaymentId: refProviderPaymentId,
    amount: formatAmountEUR(input.amount),
    currency: input.currency,
    merchantTransactionId,
    testMode: cfg.testMode,
  });
  if (!gatewayResult.ok) {
    return {
      status: 502,
      body: {
        success: false,
        error: { code: 'UPSTREAM_ERROR', message: gatewayResult.description || 'Refund rejected by provider', details: gatewayResult.raw },
      },
    };
  }

  const refundPayment = await deps.repo.createRefundPayment({
    policyId: input.policyId,
    riskTransactionId: input.riskTransactionId,
    entityId: cfg.entityId,
    amount: input.amount,
    currency: input.currency,
    paymentId: gatewayResult.paymentId || null,
    merchantTransactionId,
    referencePaymentId: input.referencePaymentId,
    referenceProviderPaymentId: refProviderPaymentId,
    raw: gatewayResult.raw,
  });
  await deps.repo.enqueuePolicyListUpdate(input.policyId);
  await deps.repo.createPaymentEvent({
    paymentId: refundPayment.id,
    eventType: 'REFUND',
    providerEventId: gatewayResult.paymentId || null,
    verified: true,
    payload: gatewayResult.raw,
  });
  deps.audit.logAuditEvent(input.policyId, 'PAYMENT.REFUNDED', input.actor, {
    refundPaymentId: refundPayment.id,
    referencePaymentId: input.referencePaymentId,
    amount: input.amount,
    currency: input.currency,
  });
  return {
    status: 200,
    body: { success: true, data: { refundPaymentId: refundPayment.id, providerPaymentId: gatewayResult.paymentId } },
  };
}
