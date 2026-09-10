type UnknownRecord = Record<string, unknown>;
const riskTransactionTypesModule = await import('../../domain/riskTransactionTypes.js');

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};

type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

type BoundRiskTransaction = {
  id: string;
  transactionType: string;
  pricingFinal: unknown;
  premiumTransactions: Array<{ grossPremium: unknown }>;
};

type PaymentRow = {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  amount: unknown;
  currency: string | null;
  status: string | null;
  purpose: string | null;
  provider: string | null;
  paymentType: string | null;
  paymentId: string | null;
  checkoutId: string | null;
  merchantTransactionId: string | null;
  initiatedBy: string | null;
  responsePayload: unknown;
  raw: unknown;
  requestPayload: unknown;
};

export type GetBillingSummaryInput = {
  policyId: string;
  riskTransactionId: string | null;
};

export type GetBillingSummaryRepoPort = {
  findPolicy(policyId: string): Promise<{ id: string; status: string | null; policyNumber: string | null } | null>;
  listBoundRiskTransactions(policyId: string): Promise<BoundRiskTransaction[]>;
  listPayments(args: { policyId: string; policyAccountMode: boolean; selectedRiskTxnId: string | null; selectedTxTypeUp: string }): Promise<PaymentRow[]>;
  markStaleBoPendingPaymentsCancelled(paymentIds: string[]): Promise<void>;
  listReconciliationLines(policyId: string): Promise<unknown[]>;
  enqueuePolicyListUpdate(policyId: string): Promise<void>;
};

function parseJsonString(value: unknown): UnknownRecord {
  if (!value) return {};
  if (typeof value !== 'string') return asRecord(value);
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed);
  } catch {
    return {};
  }
}

export async function getBillingSummaryUseCase(
  input: GetBillingSummaryInput,
  deps: { repo: GetBillingSummaryRepoPort }
): Promise<UseCaseResult> {
  const policyAccountMode = !input.riskTransactionId;
  const policy = await deps.repo.findPolicy(input.policyId);
  if (!policy) {
    return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } } };
  }

  const boundRiskTxns = await deps.repo.listBoundRiskTransactions(input.policyId);
  const selectedRiskTxn = input.riskTransactionId
    ? boundRiskTxns.find((txn) => String(txn.id) === String(input.riskTransactionId)) || null
    : boundRiskTxns[boundRiskTxns.length - 1] || null;
  const selectedTxTypeUp = String(selectedRiskTxn?.transactionType || '').toUpperCase();
  const selectedPricingFinal = parseJsonString(selectedRiskTxn?.pricingFinal || null);
  const currency = String(selectedPricingFinal.currency || 'EUR');

  const inceptionTxn =
    boundRiskTxns.find((txn) => riskTransactionTypesModule.isIssuanceTransactionType(txn.transactionType)) || null;
  const inceptionPricing = parseJsonString(inceptionTxn?.pricingFinal || null);
  const inceptionPremium = Number(inceptionPricing.premium || 0) || 0;

  const endorsementMovements = boundRiskTxns
    .filter((txn) => riskTransactionTypesModule.isPolicyChangeTransactionType(txn.transactionType))
    .map((txn) =>
      Array.isArray(txn.premiumTransactions) && txn.premiumTransactions.length > 0
        ? txn.premiumTransactions.reduce((acc, premiumTxn) => acc + Number(premiumTxn?.grossPremium || 0), 0)
        : 0
    );
  const endorsementNetMovement = endorsementMovements.reduce((acc, value) => acc + value, 0);
  const endorsementPositiveMovement = endorsementMovements
    .filter((value) => value > 0)
    .reduce((acc, value) => acc + value, 0);

  let targetAmount = 0;
  let charged = 0;
  if (policyAccountMode) {
    targetAmount = inceptionPremium + endorsementNetMovement;
    charged = inceptionPremium + endorsementPositiveMovement;
  } else if (
    riskTransactionTypesModule.isPolicyChangeTransactionType(selectedTxTypeUp) &&
    Array.isArray(selectedRiskTxn?.premiumTransactions) &&
    selectedRiskTxn.premiumTransactions.length > 0
  ) {
    targetAmount = selectedRiskTxn.premiumTransactions.reduce((acc, premiumTxn) => acc + Number(premiumTxn?.grossPremium || 0), 0);
    charged = Math.max(0, targetAmount);
  } else {
    targetAmount = Number(selectedPricingFinal.premium || 0) || 0;
    charged = Math.max(0, targetAmount);
  }

  const payments = await deps.repo.listPayments({
    policyId: input.policyId,
    policyAccountMode,
    selectedRiskTxnId: selectedRiskTxn?.id || null,
    selectedTxTypeUp,
  });

  const now = Date.now();
  const stale = payments.filter((payment) => {
    const status = String(payment.status || '').toUpperCase();
    if (status !== 'PENDING' && status !== 'INITIATED' && status !== 'REDIRECTED') return false;
    if (String(payment.initiatedBy || '').toUpperCase() !== 'BO') return false;
    if (String(payment.provider || '').toUpperCase() !== 'CARDCORP') return false;
    if (String(payment.purpose || '').toUpperCase() !== 'BO_CHARGE') return false;
    if (String(payment.paymentId || '').trim()) return false;
    const createdAtMs = payment.createdAt ? new Date(payment.createdAt).getTime() : 0;
    if (!createdAtMs || Number.isNaN(createdAtMs)) return false;
    return now - createdAtMs > 15 * 60 * 1000;
  });
  if (stale.length > 0) {
    await deps.repo.markStaleBoPendingPaymentsCancelled(stale.map((payment) => payment.id));
    await deps.repo.enqueuePolicyListUpdate(input.policyId);
  }

  const isSuccess = (payment: PaymentRow) => {
    const status = String(payment.status || '').toUpperCase();
    return status === 'PAID' || status === 'CAPTURED' || status === 'AUTHORIZED';
  };
  const isCreditCreated = (payment: PaymentRow) => {
    const status = String(payment.status || '').toUpperCase();
    const purpose = String(payment.purpose || '').toUpperCase();
    return status === 'CREDIT_CREATED' || purpose === 'CANCELLATION_CREDIT';
  };
  const isRefund = (payment: PaymentRow) => {
    const paymentType = String(payment.paymentType || '').toUpperCase();
    const purpose = String(payment.purpose || '').toUpperCase();
    return paymentType === 'RF' || purpose === 'REFUND' || purpose === 'BO_REFUND';
  };

  const paid = payments
    .filter((payment) => isSuccess(payment) && !isRefund(payment))
    .reduce((acc, payment) => acc + Number(payment.amount || 0), 0);
  const refunded = payments
    .filter((payment) => (isSuccess(payment) && isRefund(payment)) || isCreditCreated(payment))
    .reduce((acc, payment) => acc + Number(payment.amount || 0), 0);
  const balance = Number(targetAmount || 0) - Number(paid || 0) + Number(refunded || 0);

  const ledger = payments.map((payment) => {
    const responsePayload = asRecord(payment.responsePayload);
    const raw = asRecord(payment.raw);
    const requestPayload = asRecord(payment.requestPayload);
    const rawResult = asRecord(raw.result);
    const purpose = String(payment.purpose || '').toUpperCase();
    const type =
      purpose === 'CUSTOMER_CHECKOUT_REQUEST'
        ? 'Payment request'
        : isCreditCreated(payment)
          ? 'Credit'
          : isRefund(payment)
            ? 'Refund'
            : 'Charge';
    const amount = Number(payment.amount || 0);
    const signedAmount = isRefund(payment) || isCreditCreated(payment) ? -Math.abs(amount) : Math.abs(amount);
    const reference = String(payment.paymentId || payment.checkoutId || payment.merchantTransactionId || payment.id || '').trim();
    const status = purpose === 'CUSTOMER_CHECKOUT_REQUEST' ? 'PAYMENT REQUEST SENT' : String(payment.status || '').toUpperCase();
    const details =
      String(responsePayload.error || '') ||
      String(responsePayload.note || '') ||
      (purpose === 'CUSTOMER_CHECKOUT_REQUEST' ? `Secure payment link sent to ${String(requestPayload.to || '')}` : '') ||
      String(rawResult.description || '') ||
      String(rawResult.code || '') ||
      '';
    return {
      id: payment.id,
      date: payment.updatedAt || payment.createdAt,
      type,
      provider: String(payment.provider || 'CARDCORP'),
      reference,
      status,
      details,
      amount: signedAmount,
      currency: String(payment.currency || currency || 'EUR'),
    };
  });

  const reconciliationLines = await deps.repo.listReconciliationLines(input.policyId);
  return {
    status: 200,
    body: {
      success: true,
      data: {
        policyId: input.policyId,
        riskTransactionId: selectedRiskTxn?.id || null,
        accountMode: policyAccountMode ? 'policy' : 'risk_transaction',
        charged,
        targetAmount,
        paid,
        refunded,
        balance,
        currency,
        transactions: ledger,
        reconciliation: {
          lines: reconciliationLines,
        },
      },
    },
  };
}
