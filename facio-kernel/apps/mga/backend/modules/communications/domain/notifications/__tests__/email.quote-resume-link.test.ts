import { beforeEach, describe, expect, it, vi } from 'vitest';

const dispatchMock = vi.fn();

vi.mock('../../../app/customerEmailTriggerService.js', () => ({
  dispatchCustomerEmailTrigger: dispatchMock,
}));

describe('sendQuoteResumeLinkEmail (ABY-259)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatchMock.mockResolvedValue({ messageId: 'msg-resume-1' });
  });

  it('dispatches the resume-link template through the unified trigger service', async () => {
    const { sendQuoteResumeLinkEmail } = await import('../email.js');

    const ok = await sendQuoteResumeLinkEmail({
      toEmail: 'effie@example.com',
      firstName: 'Effie',
      resumeUrl: 'https://abbeygate-cy.facio.io/quote/abc123?product=travel&step=3',
      policyId: 'pol-1',
    });

    expect(ok).toBe(true);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'QUOTE_RESUME_LINK_REQUESTED',
      entityType: 'POLICY',
      entityId: 'pol-1',
      toEmail: 'effie@example.com',
      variables: {
        customer: { firstName: 'Effie' },
        quote: { resumeUrl: 'https://abbeygate-cy.facio.io/quote/abc123?product=travel&step=3' },
      },
      idempotencySeed: 'resume-link:https://abbeygate-cy.facio.io/quote/abc123?product=travel&step=3',
    }));
  });

  it('falls back to "there" when firstName is empty so the template never silently drops', async () => {
    const { sendQuoteResumeLinkEmail } = await import('../email.js');

    await sendQuoteResumeLinkEmail({
      toEmail: 'anon@example.com',
      firstName: '   ',
      resumeUrl: 'https://abbeygate-cy.facio.io/quote/xyz',
    });

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        customer: { firstName: 'there' },
      }),
    }));
  });

  it('returns false when the trigger dispatch is skipped', async () => {
    dispatchMock.mockResolvedValueOnce({ skipped: true, reason: 'missing vars' });
    const { sendQuoteResumeLinkEmail } = await import('../email.js');

    const ok = await sendQuoteResumeLinkEmail({
      toEmail: 'effie@example.com',
      firstName: 'Effie',
      resumeUrl: 'https://abbeygate-cy.facio.io/quote/abc123',
    });

    expect(ok).toBe(false);
  });
});
