import { beforeEach, describe, expect, it, vi } from 'vitest';

const dispatchMock = vi.fn();

vi.mock('../../../app/customerEmailTriggerService.js', () => ({
  dispatchCustomerEmailTrigger: dispatchMock,
}));

describe('sendPolicyWelcomeEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatchMock.mockResolvedValue({ messageId: 'msg-1' });
  });

  it('routes welcome email through unified trigger dispatch', async () => {
    const { sendPolicyWelcomeEmail } = await import('../email.js');

    const ok = await sendPolicyWelcomeEmail({
      toEmail: 'customer@example.com',
      contactName: 'Customer',
      policyNumber: 'ABOLV1000001',
      dashboardUrl: 'https://app.example.com/client',
      attachments: [
        {
          filename: 'certificate.pdf',
          content: Buffer.from('pdf-bytes'),
          contentType: 'application/pdf',
        },
      ],
    });

    expect(ok).toBe(true);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'NEW_BUSINESS_PLACED',
      toEmail: 'customer@example.com',
      variables: expect.objectContaining({
        policy: expect.objectContaining({ number: 'ABOLV1000001' }),
      }),
    }));
  });

  it('defaults coverSubjectLabel to "Cover" when none is supplied', async () => {
    const { sendPolicyWelcomeEmail } = await import('../email.js');

    await sendPolicyWelcomeEmail({
      toEmail: 'customer@example.com',
      contactName: 'Customer',
      policyNumber: 'ABOLV1000002',
      dashboardUrl: 'https://app.example.com/client',
    });

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        policy: expect.objectContaining({ coverSubjectLabel: 'Cover' }),
      }),
    }));
  });

  it('passes a product-aware coverSubjectLabel through to the template', async () => {
    const { sendPolicyWelcomeEmail } = await import('../email.js');

    await sendPolicyWelcomeEmail({
      toEmail: 'customer@example.com',
      contactName: 'Customer',
      policyNumber: 'ABTRV1000003',
      dashboardUrl: 'https://app.example.com/client',
      coverSubjectLabel: 'Trip',
      vehicleDetails: 'Single Trip to Spain',
    });

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        policy: expect.objectContaining({
          coverSubjectLabel: 'Trip',
          vehicleDescription: 'Single Trip to Spain',
        }),
      }),
    }));
  });

  it('passes the Home renewal selector through the communications spine', async () => {
    const { sendPolicyWelcomeEmail } = await import('../email.js');

    await sendPolicyWelcomeEmail({
      toEmail: 'customer@example.com',
      contactName: 'Customer',
      policyNumber: 'BZ/CY1000004',
      dashboardUrl: 'https://app.example.com/client',
      productCode: 'HOME',
      isRenewal: true,
    });

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'NEW_BUSINESS_PLACED',
      productCode: 'HOME',
      isRenewal: true,
    }));
  });

  it('queues the separate Home contents notice after the new-business confirmation at €50,000', async () => {
    const { sendPolicyWelcomeEmail } = await import('../email.js');

    await sendPolicyWelcomeEmail({
      toEmail: 'customer@example.com',
      contactName: 'Customer',
      policyNumber: 'BZ/CY1000005',
      dashboardUrl: 'https://app.example.com/client',
      productCode: 'HOME',
      homeContentsSumInsured: 50_000,
    });

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock.mock.calls[0][0]).toEqual(expect.objectContaining({
      trigger: 'NEW_BUSINESS_PLACED',
      productCode: 'HOME',
    }));
    expect(dispatchMock.mock.calls[1][0]).toEqual(expect.objectContaining({
      trigger: 'HOME_HIGH_VALUE_CONTENTS_NOTICE',
      productCode: 'HOME',
      variables: expect.objectContaining({
        policy: { number: 'BZ/CY1000005' },
        home: { contentsSumInsured: 'EUR 50000.00' },
      }),
    }));
  });

  it('throws when dispatch is skipped so the issued-pack worker surfaces the reason', async () => {
    dispatchMock.mockResolvedValueOnce({ skipped: true, reason: 'Missing variables: policy.dashboardUrl' });
    const { sendPolicyWelcomeEmail } = await import('../email.js');

    await expect(sendPolicyWelcomeEmail({
      toEmail: 'customer@example.com',
      contactName: 'Customer',
      policyNumber: 'ABOLV1000099',
      dashboardUrl: '',
    })).rejects.toThrow(/Missing variables: policy\.dashboardUrl/);
  });

  it('does not fail the welcome email when the Home contents notice is skipped', async () => {
    dispatchMock
      .mockResolvedValueOnce({ messageId: 'msg-welcome' })
      .mockResolvedValueOnce({ skipped: true, reason: 'Missing variables: home.contentsSumInsured' });
    const { sendPolicyWelcomeEmail } = await import('../email.js');

    const ok = await sendPolicyWelcomeEmail({
      toEmail: 'customer@example.com',
      contactName: 'Customer',
      policyNumber: 'BZ/CY1000006',
      dashboardUrl: 'https://app.example.com/client',
      productCode: 'HOME',
      homeContentsSumInsured: 50_000,
    });

    expect(ok).toBe(true);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });

  it('does not queue the Home contents notice below €50,000', async () => {
    const { sendPolicyWelcomeEmail } = await import('../email.js');

    await sendPolicyWelcomeEmail({
      toEmail: 'customer@example.com',
      contactName: 'Customer',
      policyNumber: 'BZ/CY1000007',
      dashboardUrl: 'https://app.example.com/client',
      productCode: 'HOME',
      homeContentsSumInsured: 49_999,
    });

    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });
});
