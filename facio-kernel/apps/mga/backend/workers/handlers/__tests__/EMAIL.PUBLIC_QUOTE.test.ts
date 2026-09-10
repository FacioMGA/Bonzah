import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUnique = vi.fn();
const sendPublicQuoteEmailForSession = vi.fn();

vi.mock('../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: { policy: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}));
vi.mock('../../../platform/tenant/tenantJobContext.js', () => ({
  runWithPolicyOperatingTenant: async (_policyId: string, action: () => Promise<unknown>) => action(),
}));
vi.mock('../../../platform/http/publicAppLinks.js', () => ({
  resolvePublicAppBaseUrlFromTenant: () => 'https://cy.abbeygate.com',
}));
vi.mock('../../../platform/utils/logger.js', () => ({ logger: { info: vi.fn() } }));
vi.mock('../../../modules/quotes/app/publicQuoteEmailService.js', () => ({
  sendPublicQuoteEmailForSession: (...args: unknown[]) => sendPublicQuoteEmailForSession(...args),
}));

const { handleEmailPublicQuote } = await import('../EMAIL.PUBLIC_QUOTE.js');

describe('EMAIL.PUBLIC_QUOTE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({ publicSessionToken: 'home-session-token' });
  });

  it('generates and delivers regulated correspondence only from the worker', async () => {
    sendPublicQuoteEmailForSession.mockResolvedValue({ ok: true, queued: true, recipient: 'customer@example.com' });

    await handleEmailPublicQuote({
      data: {
        eventType: 'EMAIL.PUBLIC_QUOTE',
        data: { policyId: 'policy-home-514', productCode: 'HOME', source: 'rate' },
      },
    });

    expect(sendPublicQuoteEmailForSession).toHaveBeenCalledWith({
      productCode: 'HOME',
      publicSessionToken: 'home-session-token',
      baseUrl: 'https://cy.abbeygate.com',
      source: 'rate',
    });
  });

  it('fails the job when the correspondence service cannot queue delivery', async () => {
    sendPublicQuoteEmailForSession.mockResolvedValue({
      ok: false,
      code: 'PDF_FAILED',
      message: 'Quote email could not be sent because its required IPID is unavailable.',
    });

    await expect(handleEmailPublicQuote({
      data: { policyId: 'policy-home-514', productCode: 'HOME', source: 'manual' },
    })).rejects.toThrow('EMAIL.PUBLIC_QUOTE: dispatch failed');
  });
});
