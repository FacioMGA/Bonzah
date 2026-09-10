import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendRevisedQuoteUseCaseMock = vi.fn();
const retryLatestFailedCustomerEmailForPolicyMock = vi.fn();

vi.mock('../../../policy/app/quoteLifecycle/sendRevisedQuoteUseCase.js', () => ({
  sendRevisedQuoteUseCase: (...args: unknown[]) => sendRevisedQuoteUseCaseMock(...args),
}));
vi.mock('../../../communications/app/retryFailedMessageUseCase.js', () => ({
  retryLatestFailedCustomerEmailForPolicy: (...args: unknown[]) =>
    retryLatestFailedCustomerEmailForPolicyMock(...args),
}));

vi.mock('../../../../platform/http/publicAppLinks.js', () => ({
  resolvePublicAppBaseUrlFromTenant: vi.fn(() => 'https://cy.abbeygate.com'),
}));

const { sendTravelQuoteEmailAfterRate } = await import('../sendTravelQuoteEmailAfterRate.js');

describe('sendTravelQuoteEmailAfterRate (ABY-516)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retryLatestFailedCustomerEmailForPolicyMock.mockResolvedValue({ status: 'NO_MATCH' });
    sendRevisedQuoteUseCaseMock.mockResolvedValue({
      ok: true,
      status: 'queued',
      recipient: 'customer@example.test',
      url: 'https://cy.abbeygate.com/quote/token?product=travel&step=options',
      messageId: 'msg-1',
      lifecycleRecorded: true,
    });
  });

  it('dispatches the canonical quote email on the first QUOTED transition', async () => {
    await sendTravelQuoteEmailAfterRate({
      policyId: 'pol_travel_1',
      productType: 'TRAVEL',
      previousStatus: 'INTAKE',
      finalStatus: 'QUOTED',
      correlationId: 'corr-1',
    });

    expect(sendRevisedQuoteUseCaseMock).toHaveBeenCalledWith({
      policyId: 'pol_travel_1',
      actor: { id: 'travel-rate-service', role: 'SYSTEM', name: 'Travel rating' },
      correlationId: 'corr-1',
      publicAppBaseUrl: 'https://cy.abbeygate.com',
      auditSource: 'travel-auto-rate',
      quoteWizardStep: 'options',
      idempotencySeed: 'travel-auto-quote',
    });
  });

  it('skips non-travel products', async () => {
    await sendTravelQuoteEmailAfterRate({
      policyId: 'pol_home_1',
      productType: 'HOME',
      previousStatus: 'INTAKE',
      finalStatus: 'QUOTED',
    });

    expect(sendRevisedQuoteUseCaseMock).not.toHaveBeenCalled();
  });

  it('skips REFERRAL and DECLINED outcomes', async () => {
    await sendTravelQuoteEmailAfterRate({
      policyId: 'pol_travel_1',
      productType: 'TRAVEL',
      previousStatus: 'INTAKE',
      finalStatus: 'REFERRAL',
    });
    await sendTravelQuoteEmailAfterRate({
      policyId: 'pol_travel_1',
      productType: 'TRAVEL',
      previousStatus: 'INTAKE',
      finalStatus: 'DECLINED',
    });

    expect(sendRevisedQuoteUseCaseMock).not.toHaveBeenCalled();
  });

  it('retries through the canonical deduplicated delivery key when the policy is already QUOTED', async () => {
    await sendTravelQuoteEmailAfterRate({
      policyId: 'pol_travel_1',
      productType: 'TRAVEL',
      previousStatus: 'QUOTED',
      finalStatus: 'QUOTED',
    });

    expect(sendRevisedQuoteUseCaseMock).toHaveBeenCalledTimes(1);
  });

  it('requeues the matching failed Travel letter instead of creating a duplicate on a later rate', async () => {
    retryLatestFailedCustomerEmailForPolicyMock.mockResolvedValueOnce({
      status: 'REQUEUED', messageId: 'message-1', previousAttempts: 1,
    });
    await sendTravelQuoteEmailAfterRate({
      policyId: 'pol_travel_1', productType: 'TRAVEL', previousStatus: 'QUOTED', finalStatus: 'QUOTED',
    });

    expect(retryLatestFailedCustomerEmailForPolicyMock).toHaveBeenCalledWith({
      policyId: 'pol_travel_1', templateKey: 'TRAVEL_QUOTE_STANDARD',
    });
    expect(sendRevisedQuoteUseCaseMock).not.toHaveBeenCalled();
  });

  it('sends when a REFERRAL is cleared and the policy becomes QUOTED', async () => {
    await sendTravelQuoteEmailAfterRate({
      policyId: 'pol_travel_1',
      productType: 'TRAVEL',
      previousStatus: 'REFERRAL',
      finalStatus: 'QUOTED',
    });

    expect(sendRevisedQuoteUseCaseMock).toHaveBeenCalledTimes(1);
  });
});
