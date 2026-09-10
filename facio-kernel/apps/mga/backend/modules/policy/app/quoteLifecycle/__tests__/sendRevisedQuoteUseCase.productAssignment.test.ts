import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPolicyFindUnique = vi.fn();
const mockDocumentGenerate = vi.fn();
const mockDispatchQuoteEmail = vi.fn();
const mockGetFileStream = vi.fn();
const mockBuildQuoteEmailContext = vi.fn();

vi.mock('../../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    policy: { findUnique: mockPolicyFindUnique },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) => callback({})),
  },
}));

vi.mock('../../../../../platform/audit/logger.js', () => ({ AuditLogger: { log: vi.fn() } }));
vi.mock('../../../../../platform/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../documents/app/documentService.js', () => ({ DocumentService: { generate: mockDocumentGenerate } }));
vi.mock('../../communicationsInterop.js', () => ({ dispatchQuoteEmail: mockDispatchQuoteEmail }));
vi.mock('../../shared.js', () => ({ newPublicSessionToken: vi.fn(() => 'session-token') }));
vi.mock('../../policyListIndex.js', () => ({ enqueuePolicyListIndexUpdate: vi.fn() }));
vi.mock('../../commands/policyLifecycleCommands.js', () => ({ transitionPolicyLifecycle: vi.fn() }));
vi.mock('../../quoteEmailContext.js', () => ({ buildQuoteEmailContext: mockBuildQuoteEmailContext }));
vi.mock('../../../../../platform/storage/service.js', () => ({ storageService: { getFileStream: mockGetFileStream } }));
vi.mock('../../../domain/lifecycle/stateMachines.js', () => ({ assertPolicyTransitionAllowed: vi.fn() }));

describe('sendRevisedQuoteUseCase — product assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPolicyFindUnique.mockResolvedValue({
      id: 'policy-unassigned',
      productType: null,
      binderId: null,
      programId: null,
      quoteData: { proposer: { email: 'customer@example.test' } },
      stateCurrent: null,
    });
    mockDispatchQuoteEmail.mockResolvedValue({ queued: true, messageId: 'message-1' });
    mockBuildQuoteEmailContext.mockReturnValue({
      quote: { reference: 'TR/CY1000001', premium: 'EUR 100.00', excess: '€100', productLabel: 'travel insurance quote' },
      policy: { registration: '', vehicleDescription: 'Gold — Single Trip' },
    });
  });

  it('fails closed instead of sending an unassigned policy as Motor', async () => {
    const { sendRevisedQuoteUseCase } = await import('../sendRevisedQuoteUseCase.js');

    const result = await sendRevisedQuoteUseCase({
      policyId: 'policy-unassigned',
      actor: { id: 'underwriter-1', role: 'UNDERWRITER' },
      publicAppBaseUrl: 'https://cy.abbeygate.com',
    });

    expect(result).toEqual({
      ok: false,
      code: 'PRODUCT_ASSIGNMENT_REQUIRED',
      message: 'Select and save an active binder and program before sending this quote.',
    });
  });

  it('attaches every generated quote-pack document instead of selecting the first one', async () => {
    mockPolicyFindUnique.mockResolvedValueOnce({
      id: 'policy-travel',
      policyNumber: 'TR/CY1000001',
      status: 'QUOTED',
      productType: 'TRAVEL',
      binderId: 'binder-1',
      programId: 'program-1',
      publicSessionToken: 'token-1',
      quoteResponse: {},
      vehicleInfo: {},
      excessAmount: null,
      quoteData: { proposer: { firstName: 'Ada', lastName: 'Lovelace', email: 'customer@example.test' } },
      policyHolder: null,
      stateCurrent: null,
    });
    mockDocumentGenerate.mockResolvedValueOnce({
      documents: [
        { type: 'TRAVEL_CERTIFICATE_PDF', filename: 'certificate.pdf', storageUri: '/api/documents/certificate.pdf' },
        { type: 'TRAVEL_IPID_PDF', filename: 'ipid.pdf', storageUri: '/api/documents/ipid.pdf' },
      ],
    });
    mockGetFileStream.mockImplementation(async (filename: string) => Readable.from([Buffer.from(filename)]));

    const { sendRevisedQuoteUseCase } = await import('../sendRevisedQuoteUseCase.js');

    const result = await sendRevisedQuoteUseCase({
      policyId: 'policy-travel',
      actor: { id: 'travel-rate-service', role: 'SYSTEM', name: 'Travel rating' },
      publicAppBaseUrl: 'https://cy.abbeygate.com',
      idempotencySeed: 'travel-auto-quote',
    });

    expect(result).toMatchObject({ ok: true, status: 'queued' });
    expect(mockDispatchQuoteEmail).toHaveBeenCalledWith(
      'customer@example.test',
      'Ada Lovelace',
      expect.any(String),
      undefined,
      undefined,
      expect.objectContaining({
        attachments: [
          { filename: 'certificate.pdf', content: Buffer.from('certificate.pdf') },
          { filename: 'ipid.pdf', content: Buffer.from('ipid.pdf') },
        ],
      }),
    );
  });
});
