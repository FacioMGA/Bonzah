import { beforeEach, describe, expect, it, vi } from 'vitest';

const dispatchMock = vi.fn();

vi.mock('../../../app/customerEmailTriggerService.js', () => ({
  dispatchCustomerEmailTrigger: dispatchMock,
}));

describe('sendUwQuestionnaireRequestEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatchMock.mockResolvedValue({ messageId: 'msg-uw-1' });
  });

  it('dispatches questionnaire email through unified trigger service', async () => {
    const { sendUwQuestionnaireRequestEmail } = await import('../email.js');

    const ok = await sendUwQuestionnaireRequestEmail({
      toEmail: 'customer@example.com',
      firstName: 'Avi',
      applicationUrl: 'https://public.example.com/quote/token-123?step=policy-holder',
    });

    expect(ok).toBe(true);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'UW_INFO_REQUESTED',
      toEmail: 'customer@example.com',
      variables: expect.objectContaining({
        customer: { firstName: 'Avi' },
      }),
    }));
  });

  it('returns false when trigger dispatch is skipped', async () => {
    dispatchMock.mockResolvedValueOnce({ skipped: true, reason: 'missing vars' });
    const { sendUwQuestionnaireRequestEmail } = await import('../email.js');

    const ok = await sendUwQuestionnaireRequestEmail({
      toEmail: 'customer@example.com',
      firstName: 'Dana',
      applicationUrl: 'https://public.example.com/quote/token-456?step=vehicle-cover',
    });

    expect(ok).toBe(false);
  });
});
