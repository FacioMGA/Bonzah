import { beforeEach, describe, expect, it, vi } from 'vitest';

const dispatchMock = vi.fn();

vi.mock('../../../app/customerEmailTriggerService.js', () => ({
  dispatchCustomerEmailTrigger: dispatchMock,
}));

describe('dispatchQuoteEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatchMock.mockResolvedValue({ messageId: 'msg-quote-1' });
  });

  it('queues quote email through the communications core with audit identifiers', async () => {
    const { dispatchQuoteEmail } = await import('../email.js');

    const result = await dispatchQuoteEmail(
      'customer@example.com',
      'Ada Lovelace',
      'https://app.example.com/quote/token?step=your-quote',
      Buffer.from('pdf-bytes'),
      'quote.pdf',
      {
        policyId: 'policy-1',
        quote: {
          reference: 'Q-1',
          premium: 'EUR 523.18',
          excess: 'EUR 250.00',
          productLabel: 'business insurance proposal',
        },
        policy: { registration: 'ABC123', vehicleDescription: 'BMW 3 Series' },
        idempotencySeed: 'quote-send:policy-1:corr-1',
      },
    );

    expect(result).toEqual({ queued: true, messageId: 'msg-quote-1' });
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'QUOTE_SENT',
      entityType: 'POLICY',
      entityId: 'policy-1',
      toEmail: 'customer@example.com',
      attachments: [
        expect.objectContaining({
          filename: 'quote.pdf',
          mimetype: 'application/pdf',
          contentBase64: Buffer.from('pdf-bytes').toString('base64'),
        }),
      ],
      variables: expect.objectContaining({
        customer: { firstName: 'Ada' },
        policy: expect.objectContaining({ registration: 'ABC123' }),
        quote: expect.objectContaining({
          reference: 'Q-1',
          premium: 'EUR 523.18',
          excess: 'EUR 250.00',
          productLabel: 'business insurance proposal',
          url: 'https://app.example.com/quote/token?step=your-quote',
        }),
      }),
      idempotencySeed: 'quote-send:policy-1:corr-1',
    }));
  });

  it('returns the skipped reason when the template dispatch is not queued', async () => {
    dispatchMock.mockResolvedValueOnce({ skipped: true, reason: 'Missing variables: quote.url' });
    const { dispatchQuoteEmail } = await import('../email.js');

    const result = await dispatchQuoteEmail('customer@example.com', 'Ada Lovelace', '');

    expect(result).toEqual({ queued: false, skippedReason: 'Missing variables: quote.url' });
  });

  it('dispatches the complete generated quote pack when supplied', async () => {
    const { dispatchQuoteEmail } = await import('../email.js');

    await dispatchQuoteEmail(
      'customer@example.com',
      'Ada Lovelace',
      'https://app.example.com/quote/token?step=your-quote',
      undefined,
      undefined,
      {
        policyId: 'policy-1',
        quote: { reference: 'Q-1', premium: 'EUR 523.18', excess: 'EUR 250.00' },
        policy: { vehicleDescription: 'Travel cover' },
        attachments: [
          { filename: 'quote.pdf', content: Buffer.from('quote') },
          { filename: 'IPID.pdf', content: Buffer.from('ipid') },
        ],
      },
    );

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [
        expect.objectContaining({ filename: 'quote.pdf', contentBase64: Buffer.from('quote').toString('base64') }),
        expect.objectContaining({ filename: 'IPID.pdf', contentBase64: Buffer.from('ipid').toString('base64') }),
      ],
    }));
  });

  it('merges a product IPID alongside the legacy quote PDF', async () => {
    const { dispatchQuoteEmail } = await import('../email.js');

    await dispatchQuoteEmail(
      'customer@example.com',
      'Ada Lovelace',
      'https://app.example.com/quote/token?step=your-quote',
      Buffer.from('quote-bytes'),
      'quote.pdf',
      {
        policyId: 'home-policy-1',
        productCode: 'HOME',
        extraAttachments: [{
          filename: 'Home_IPID.pdf',
          mimetype: 'application/pdf',
          size: 4,
          contentBase64: Buffer.from('ipid').toString('base64'),
        }],
      },
    );

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [
        expect.objectContaining({ filename: 'quote.pdf' }),
        expect.objectContaining({ filename: 'Home_IPID.pdf' }),
      ],
    }));
  });

  it('does not queue the Home contents notice with a quote', async () => {
    const { dispatchQuoteEmail } = await import('../email.js');

    const result = await dispatchQuoteEmail(
      'customer@example.com',
      'Ada Lovelace',
      'https://app.example.com/quote/token?step=your-quote',
      undefined,
      undefined,
      {
        policyId: 'home-policy-1',
        quote: { reference: 'BZ/CY1000001', premium: 'EUR 600.00', excess: 'EUR 150.00' },
        policy: { vehicleDescription: 'Villa, Paphos' },
        productCode: 'HOME',
        idempotencySeed: 'home-quote-1',
      },
    );

    expect(result).toEqual({ queued: true, messageId: 'msg-quote-1' });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'QUOTE_SENT',
      productCode: 'HOME',
    }));
  });
});
