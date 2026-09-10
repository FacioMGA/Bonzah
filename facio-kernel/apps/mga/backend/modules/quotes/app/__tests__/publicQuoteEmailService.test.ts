import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const policyFindFirst = vi.fn();
const outboxCreate = vi.fn();
const tx = { outbox: { create: (...args: unknown[]) => outboxCreate(...args) } };
const generateDocumentPack = vi.fn();
const dispatchQuoteEmailMock = vi.fn();
const resolveProductIpidAssetMock = vi.fn();
const auditLog = vi.fn();

vi.mock('../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    policy: { findFirst: (...args: unknown[]) => policyFindFirst(...args) },
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  },
}));

vi.mock('../../../documents/app/documentService.js', () => ({
  DocumentService: { generate: (...args: unknown[]) => generateDocumentPack(...args) },
}));

vi.mock('../../../policy/app/communicationsInterop.js', () => ({
  dispatchQuoteEmail: (...args: unknown[]) => dispatchQuoteEmailMock(...args),
}));

vi.mock('../../../policy/app/quoteEmailContext.js', () => ({
  buildQuoteEmailContext: vi.fn(() => ({ quote: { reference: 'Q-514' }, policy: {} })),
}));

vi.mock('../../../policy/app/productRegistryService.js', () => ({
  resolveProductIpidAsset: (...args: unknown[]) => resolveProductIpidAssetMock(...args),
}));

vi.mock('../../../../platform/tenant/tenantConfig.js', () => ({
  getTenantConfig: vi.fn(() => ({ countryCode: 'CY' })),
}));

vi.mock('../../../../platform/http/publicAppLinks.js', () => ({
  normalizePublicAppBaseUrl: vi.fn((url: string) => url.replace(/\/$/, '')),
}));

vi.mock('../../../../platform/audit/logger.js', () => ({
  AuditLogger: { log: (...args: unknown[]) => auditLog(...args) },
}));

vi.mock('../../../../platform/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../platform/storage/service.js', () => ({
  storageService: { getFileStream: vi.fn() },
}));

vi.mock('node:fs', () => ({
  default: { readFileSync: vi.fn(() => Buffer.from('ipid-pdf')) },
}));

const { queuePublicQuoteEmailForSession, sendPublicQuoteEmailForSession } = await import('../publicQuoteEmailService.js');

describe('sendPublicQuoteEmailForSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    policyFindFirst.mockResolvedValue({
      id: 'policy-home-514',
      policyNumber: 'ABQ514',
      productType: 'HOME',
      publicSessionToken: 'session-514',
      status: 'QUOTED',
      quoteData: { proposer: { firstName: 'Peter', lastName: 'Abbey', email: 'PETER@ABBEYGATE.CY' } },
      quoteResponse: { reference: 'Q-514' },
      stateCurrent: null,
    });
    generateDocumentPack.mockResolvedValue({
      documents: [{ type: 'HOME_QUOTE_PDF', filename: 'Home quote.pdf', storageUri: 'https://files.example/quote.pdf' }],
    });
    resolveProductIpidAssetMock.mockReturnValue({ absolutePath: '/approved/home-ipid.pdf', filename: 'Home-IPID.pdf' });
    dispatchQuoteEmailMock.mockResolvedValue({ queued: true, messageId: 'message-514' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from('quote-pdf'),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('queues the generated Home quote and the canonical product IPID through the customer-email spine', async () => {
    const result = await sendPublicQuoteEmailForSession({
      productCode: 'HOME',
      publicSessionToken: 'session-514',
      baseUrl: 'https://cy.abbeygate.com/',
      source: 'rate',
      correlationId: 'corr-514',
    });

    expect(result).toEqual({ ok: true, queued: true, recipient: 'peter@abbeygate.cy', messageId: 'message-514' });
    expect(generateDocumentPack).toHaveBeenCalledWith({
      policyId: 'policy-home-514',
      riskTransactionId: null,
      docPack: 'QUOTE_PACK',
      source: 'CUSTOMER',
      generatedByUserId: null,
    });
    expect(dispatchQuoteEmailMock).toHaveBeenCalledWith(
      'peter@abbeygate.cy',
      'Peter Abbey',
      'https://cy.abbeygate.com/quote/session-514?product=home&step=your-quote',
      undefined,
      undefined,
      expect.objectContaining({
        policyId: 'policy-home-514',
        productCode: 'HOME',
        idempotencySeed: 'public-quote-email:policy-home-514:Q-514:rate',
        attachments: [expect.objectContaining({ filename: 'Home quote.pdf', content: Buffer.from('quote-pdf') })],
        extraAttachments: [expect.objectContaining({ filename: 'Home-IPID.pdf', mimetype: 'application/pdf' })],
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      'policy-home-514',
      'POLICY',
      'QUOTE.PUBLIC_EMAIL_SENT',
      'customer',
      'USER',
      expect.objectContaining({ ipidAttached: true, source: 'rate' }),
      'Peter',
    );
  });

  it('passes the persisted Annual Travel selection to a required standalone IPID attachment', async () => {
    const quoteData = { proposer: { firstName: 'Annual', email: 'annual@example.com' }, trip: { planType: 'annual_multi_trip' } };
    policyFindFirst.mockResolvedValue({ id: 'annual-quote', policyNumber: 'ANNUAL-1', productType: 'TRAVEL', publicSessionToken: 'annual-token', status: 'QUOTED', quoteData, quoteResponse: {}, stateCurrent: null });
    generateDocumentPack.mockResolvedValue({ documents: [{ type: 'TRAVEL_SCHEDULE_PDF', filename: 'Annual schedule.pdf', storageUri: 'https://files.example/annual.pdf' }] });
    const result = await sendPublicQuoteEmailForSession({ productCode: 'TRAVEL', publicSessionToken: 'annual-token', baseUrl: 'https://cy.abbeygate.com' });
    expect(result.ok).toBe(true);
    expect(resolveProductIpidAssetMock).toHaveBeenCalledWith('TRAVEL', 'CY', { quoteData });
  });

  it('forwards every approved Travel quote-pack document without a duplicate standalone IPID', async () => {
    policyFindFirst.mockResolvedValue({
      id: 'policy-travel-516',
      policyNumber: 'DIRECT/BRIT/ABG/CY/500001',
      productType: 'TRAVEL',
      publicSessionToken: 'session-516',
      status: 'QUOTED',
      quoteData: { proposer: { firstName: 'Danny', lastName: 'Abbey', email: 'DANNY@ABBEYGATE.CY' } },
      quoteResponse: { reference: 'Q-516' },
      stateCurrent: null,
    });
    generateDocumentPack.mockResolvedValue({
      documents: [
        { type: 'TRAVEL_CERTIFICATE_PDF', filename: 'Travel certificate.pdf', storageUri: 'https://files.example/certificate.pdf' },
        { type: 'TRAVEL_SCHEDULE_PDF', filename: 'Travel schedule.pdf', storageUri: 'https://files.example/schedule.pdf' },
        { type: 'TRAVEL_IPID_PDF', filename: 'Travel IPID.pdf', storageUri: 'https://files.example/ipid.pdf' },
        { type: 'TRAVEL_POLICY_WORDING_PDF', filename: 'Travel wording.pdf', storageUri: 'https://files.example/wording.pdf' },
      ],
    });

    const result = await sendPublicQuoteEmailForSession({
      productCode: 'TRAVEL',
      publicSessionToken: 'session-516',
      baseUrl: 'https://cy.abbeygate.com',
    });

    expect(result).toEqual({ ok: true, queued: true, recipient: 'danny@abbeygate.cy', messageId: 'message-514' });
    expect(resolveProductIpidAssetMock).not.toHaveBeenCalled();
    expect(dispatchQuoteEmailMock).toHaveBeenCalledWith(
      'danny@abbeygate.cy',
      'Danny Abbey',
      'https://cy.abbeygate.com/quote/session-516?product=travel&step=your-quote',
      undefined,
      undefined,
      expect.objectContaining({
        attachments: expect.arrayContaining([
          expect.objectContaining({ filename: 'Travel certificate.pdf' }),
          expect.objectContaining({ filename: 'Travel schedule.pdf' }),
          expect.objectContaining({ filename: 'Travel IPID.pdf' }),
          expect.objectContaining({ filename: 'Travel wording.pdf' }),
        ]),
        extraAttachments: [],
      }),
    );
  });

  it('fails closed when the generated quote document has no retrievable PDF', async () => {
    generateDocumentPack.mockResolvedValue({
      documents: [{ type: 'HOME_QUOTE_PDF', filename: 'Home quote.pdf', storageUri: '' }],
    });

    const result = await sendPublicQuoteEmailForSession({
      productCode: 'HOME',
      publicSessionToken: 'session-514',
      baseUrl: 'https://cy.abbeygate.com',
    });

    expect(result).toEqual({
      ok: false,
      code: 'PDF_FAILED',
      message: 'Quote email could not be sent because its document pack is unavailable.',
    });
    expect(dispatchQuoteEmailMock).not.toHaveBeenCalled();
  });

  it('fails closed rather than sending regulated correspondence without an approved IPID', async () => {
    resolveProductIpidAssetMock.mockReturnValue(null);

    const result = await sendPublicQuoteEmailForSession({
      productCode: 'HOME',
      publicSessionToken: 'session-514',
      baseUrl: 'https://cy.abbeygate.com',
    });

    expect(result).toEqual({
      ok: false,
      code: 'PDF_FAILED',
      message: 'Quote email could not be sent because its required IPID is unavailable.',
    });
    expect(dispatchQuoteEmailMock).not.toHaveBeenCalled();
  });

  it('writes the manual quote-send request to the transactional outbox without generating documents in HTTP', async () => {
    const result = await queuePublicQuoteEmailForSession({
      productCode: 'HOME',
      publicSessionToken: 'session-514',
      baseUrl: 'https://cy.abbeygate.com',
      source: 'manual',
      correlationId: 'corr-queue-514',
    });

    expect(result).toEqual({ ok: true, queued: true, recipient: 'peter@abbeygate.cy' });
    expect(generateDocumentPack).not.toHaveBeenCalled();
    expect(outboxCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'EMAIL.PUBLIC_QUOTE',
        aggregateId: 'policy-home-514',
        payload: expect.objectContaining({
          eventType: 'EMAIL.PUBLIC_QUOTE',
          data: { policyId: 'policy-home-514', productCode: 'HOME', source: 'manual' },
        }),
      }),
    }));
  });
});
