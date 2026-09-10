type UnknownRecord = Record<string, unknown>;
const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};

export type VerifyCardcorpStatusInput = {
  policyId: string;
  checkoutId: string;
  resourcePath: string;
};

export type VerifyCardcorpStatusConfigPort = {
  getCardcorpConfig(): {
    entityId?: string;
    bearerToken?: string;
    baseUrl: string;
  };
};

export type VerifyCardcorpStatusGatewayPort = {
  getPaymentStatus(args: { baseUrl: string; entityId: string; bearerToken: string; checkoutId: string }): Promise<{
    ok: boolean;
    code?: string;
    description?: string;
    paymentId?: string;
    raw: unknown;
  }>;
  getPaymentStatusByResourcePath(args: { baseUrl: string; entityId: string; bearerToken: string; resourcePath: string }): Promise<{
    ok: boolean;
    code?: string;
    description?: string;
    paymentId?: string;
    raw: unknown;
  }>;
};

export type VerifyCardcorpStatusRepoPort = {
  findPaymentAttempt(args: { policyId: string; checkoutId: string }): Promise<{
    id: string;
    status: string;
    paymentId: string | null;
    raw: unknown;
  } | null>;
  updatePaymentDiagnostics(args: { paymentId: string; errorMessage: string; previousRaw: unknown }): Promise<void>;
  markPaymentFailed(paymentId: string): Promise<{ status: string } | null>;
  findLatestPaidPayment(policyId: string): Promise<{ status: string; raw: unknown } | null>;
  updatePaymentFromGateway(args: {
    paymentId: string;
    nextStatus: 'PAID' | 'FAILED';
    providerPaymentId: string | null;
    raw: unknown;
  }): Promise<{ status: string }>;
  createPaymentEvent(args: {
    paymentId: string;
    eventType: 'CAPTURE' | 'FAIL';
    providerEventId: string | null;
    verified: boolean;
    payload: unknown;
  }): Promise<void>;
  persistPendingGatewayRaw(args: { paymentId: string; raw: unknown }): Promise<void>;
  enqueuePolicyListUpdate(policyId: string): Promise<void>;
};

type VerifyResult = {
  status: number;
  body: Record<string, unknown>;
};

function inferCheckoutIdFromResourcePath(resourcePath: string): string {
  const match = resourcePath.match(/^\/v1\/checkouts\/([^/]+)\/payment/i);
  return match?.[1] || '';
}

function isNoSessionMessage(message: string): boolean {
  return (
    message.includes('No payment session found') ||
    message.includes('200.300.404') ||
    message.toLowerCase().includes('invalid or missing parameter')
  );
}

function storedRawCode(value: unknown): { code: string; description?: unknown } {
  const raw = asRecord(value);
  const result = asRecord(raw.result);
  return { code: String(result.code || ''), description: result.description };
}

export async function verifyCardcorpStatusUseCase(
  input: VerifyCardcorpStatusInput,
  deps: {
    config: VerifyCardcorpStatusConfigPort;
    gateway: VerifyCardcorpStatusGatewayPort;
    repo: VerifyCardcorpStatusRepoPort;
    errorMessage: (error: unknown, fallback: string) => string;
  }
): Promise<VerifyResult> {
  const cfg = deps.config.getCardcorpConfig();
  if (!cfg.entityId || !cfg.bearerToken) {
    return { status: 501, body: { success: false, error: { code: 'NOT_CONFIGURED', message: 'CardCorp is not configured on the server' } } };
  }
  if (!input.checkoutId && !input.resourcePath) {
    return { status: 400, body: { success: false, error: { code: 'BAD_REQUEST', message: 'checkoutId or resourcePath is required' } } };
  }

  const checkoutIdForLookup = input.checkoutId || (input.resourcePath ? inferCheckoutIdFromResourcePath(input.resourcePath) : '');
  const payment = await deps.repo.findPaymentAttempt({ policyId: input.policyId, checkoutId: checkoutIdForLookup });
  if (!payment) {
    return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'Payment attempt not found' } } };
  }

  const fromStored = storedRawCode(payment.raw);
  if ((payment.status === 'PAID' || payment.status === 'FAILED') && fromStored.code) {
    return {
      status: 200,
      body: {
        success: true,
        data: {
          ok: fromStored.code.startsWith('000.'),
          code: fromStored.code,
          description: fromStored.description,
          paymentStatus: payment.status,
          idempotent: true,
        },
      },
    };
  }

  let gatewayStatus: { ok: boolean; code?: string; description?: string; paymentId?: string; raw: unknown };
  try {
    gatewayStatus = input.resourcePath
      ? await deps.gateway.getPaymentStatusByResourcePath({
          baseUrl: cfg.baseUrl,
          entityId: cfg.entityId,
          bearerToken: cfg.bearerToken,
          resourcePath: input.resourcePath,
        })
      : await deps.gateway.getPaymentStatus({
          baseUrl: cfg.baseUrl,
          entityId: cfg.entityId,
          bearerToken: cfg.bearerToken,
          checkoutId: checkoutIdForLookup,
        });
  } catch (error) {
    const msg = String(deps.errorMessage(error, 'Payment verification failed'));
    await deps.repo.updatePaymentDiagnostics({ paymentId: payment.id, errorMessage: msg, previousRaw: payment.raw });
    await deps.repo.enqueuePolicyListUpdate(input.policyId);

    if (isNoSessionMessage(msg)) {
      return {
        status: 200,
        body: {
          success: true,
          data: {
            ok: false,
            pending: true,
            code: '200.300.404',
            description: msg,
            paymentStatus: payment.status,
          },
        },
      };
    }

    const updated = await deps.repo.markPaymentFailed(payment.id);
    await deps.repo.enqueuePolicyListUpdate(input.policyId);
    return {
      status: 200,
      body: {
        success: true,
        data: {
          ok: false,
          code: 'UPSTREAM_ERROR',
          description: msg,
          paymentStatus: updated?.status || payment.status,
        },
      },
    };
  }

  const code = String(gatewayStatus.code || '');
  const description = String(gatewayStatus.description || '');
  const isNoSession = code === '200.300.404' || description.toLowerCase().includes('no payment session');
  if (isNoSession) {
    const paid = await deps.repo.findLatestPaidPayment(input.policyId);
    const paidStored = storedRawCode(paid?.raw);
    if (paid && paidStored.code.startsWith('000.')) {
      return {
        status: 200,
        body: {
          success: true,
          data: {
            ok: true,
            code: paidStored.code,
            description: paidStored.description,
            paymentStatus: paid.status,
            idempotent: true,
            note: 'Verified from stored PAID outcome after gateway session expired.',
          },
        },
      };
    }
  }

  if (isNoSession) {
    await deps.repo.persistPendingGatewayRaw({ paymentId: payment.id, raw: gatewayStatus.raw });
    await deps.repo.enqueuePolicyListUpdate(input.policyId);
    return {
      status: 200,
      body: {
        success: true,
        data: {
          ok: false,
          pending: true,
          code,
          description: description || 'Finalising payment — please retry.',
          paymentStatus: payment.status,
        },
      },
    };
  }

  const nextStatus = gatewayStatus.ok ? 'PAID' : 'FAILED';
  const updated = await deps.repo.updatePaymentFromGateway({
    paymentId: payment.id,
    nextStatus,
    providerPaymentId: gatewayStatus.paymentId || payment.paymentId,
    raw: gatewayStatus.raw,
  });
  await deps.repo.enqueuePolicyListUpdate(input.policyId);
  await deps.repo.createPaymentEvent({
    paymentId: payment.id,
    eventType: gatewayStatus.ok ? 'CAPTURE' : 'FAIL',
    providerEventId: gatewayStatus.paymentId || null,
    verified: Boolean(gatewayStatus.ok),
    payload: gatewayStatus.raw,
  });
  return {
    status: 200,
    body: {
      success: true,
      data: {
        ok: gatewayStatus.ok,
        code,
        description,
        paymentStatus: updated.status,
      },
    },
  };
}
