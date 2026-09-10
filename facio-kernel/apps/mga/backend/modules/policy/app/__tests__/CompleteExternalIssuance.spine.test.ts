import { beforeEach, describe, expect, it, vi } from 'vitest';

const txMock = {
  document: { create: vi.fn() },
};
const prismaMock = {
  policy: { findUnique: vi.fn() },
  binderProductAuthority: { findUnique: vi.fn() },
  document: { findMany: vi.fn() },
  riskTransaction: { findFirst: vi.fn() },
  $transaction: vi.fn(),
};
const executeBindCoverageMock = vi.fn();
const executeIssuePolicyMock = vi.fn();
const resolveMappedProgramDefinitionMock = vi.fn();

vi.mock('../../../../platform/db/connection.js', () => ({ tenantScopedPrisma: prismaMock }));
vi.mock('../../../../platform/audit/logger.js', () => ({ AuditLogger: { log: vi.fn() } }));
vi.mock('../BindCoverage.js', () => ({ executeBindCoverage: (...args: unknown[]) => executeBindCoverageMock(...args) }));
vi.mock('../IssuePolicy.js', () => ({ executeIssuePolicy: (...args: unknown[]) => executeIssuePolicyMock(...args) }));
vi.mock('../../../programs/app/activeProgramDefinition.js', () => ({
  resolveMappedProgramDefinition: (...args: unknown[]) => resolveMappedProgramDefinitionMock(...args),
}));

const documentTypes = [
  'OPEN_MARKET_EXTERNAL_CERTIFICATE_PDF',
  'OPEN_MARKET_EXTERNAL_SCHEDULE_PDF',
  'OPEN_MARKET_EXTERNAL_POLICY_WORDING_PDF',
];

describe('CompleteExternalIssuance canonical workflow (ADR-0096)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock));
    prismaMock.binderProductAuthority.findUnique.mockResolvedValue({ id: 'authority-open-market' });
    resolveMappedProgramDefinitionMock.mockResolvedValue({
      workflow: {
        referralOnly: false,
        externalIssuance: { mode: 'manager_upload_after_payment', documentTypes },
      },
    });
    prismaMock.policy.findUnique.mockResolvedValue({
      id: 'pol-1', status: 'AWAITING_EXTERNAL_ISSUANCE', productType: 'OPEN_MARKET',
      programId: 'program-open-market', binderId: 'binder-open-market', operatingTenantId: 'tenant-1',
    });
    prismaMock.document.findMany.mockResolvedValue([]);
    executeBindCoverageMock.mockResolvedValue({ status: 'SUCCESS', data: { status: 'BOUND', riskTransactionId: 'rt-1' } });
    executeIssuePolicyMock.mockResolvedValue({ status: 'SUCCESS', data: { status: 'ACTIVE', riskTransactionId: 'rt-1' } });
    txMock.document.create
      .mockResolvedValueOnce({ id: 'doc-1' })
      .mockResolvedValueOnce({ id: 'doc-2' })
      .mockResolvedValueOnce({ id: 'doc-3' });
  });

  it('uses the canonical bind and issue commands after recording the complete insurer-issued pack', async () => {
    const { completeExternalIssuance } = await import('../CompleteExternalIssuance.js');
    const result = await completeExternalIssuance({
      policyId: 'pol-1',
      actor: { id: 'manager-1', name: 'Manager', email: 'manager@example.test', role: 'UNDERWRITER' },
      documents: documentTypes.map((type, index) => ({
        type,
        storageUri: `/api/documents/external-${index}.pdf`,
        filename: `external-${index}.pdf`,
        fileHash: `hash-${index}`,
      })),
      correlationId: 'corr-1',
    });

    expect(executeBindCoverageMock).toHaveBeenCalledWith(expect.objectContaining({ policyId: 'pol-1', correlationId: 'corr-1', externalIssuanceCompletion: true }));
    expect(txMock.document.create).toHaveBeenCalledTimes(3);
    expect(executeIssuePolicyMock).toHaveBeenCalledWith(expect.objectContaining({
      policyId: 'pol-1',
      suppressIssuedPack: true,
      externalDocumentEmail: { documentIds: ['doc-1', 'doc-2', 'doc-3'] },
    }));
    expect(result).toEqual({
      status: 'SUCCESS',
      data: { policyStatus: 'ACTIVE', riskTransactionId: 'rt-1', documentIds: ['doc-1', 'doc-2', 'doc-3'], idempotent: false },
    });
  });

  it('fails closed when the configured external pack is incomplete', async () => {
    const { completeExternalIssuance } = await import('../CompleteExternalIssuance.js');
    const result = await completeExternalIssuance({
      policyId: 'pol-1',
      actor: { id: 'manager-1', name: 'Manager', email: 'manager@example.test', role: 'UNDERWRITER' },
      documents: [{
        type: documentTypes[0]!,
        storageUri: '/api/documents/certificate.pdf',
        filename: 'certificate.pdf',
        fileHash: 'hash-certificate',
      }],
    });

    expect(result).toMatchObject({ status: 'VALIDATION_ERROR', error: { code: 'EXTERNAL_ISSUED_DOCUMENTS_INVALID' } });
    expect(executeBindCoverageMock).not.toHaveBeenCalled();
  });

  it('refuses external issuance for a referral-only program', async () => {
    prismaMock.policy.findUnique.mockResolvedValueOnce({
      id: 'pol-1',
      status: 'AWAITING_EXTERNAL_ISSUANCE',
      productType: 'OPEN_MARKET',
      programId: 'program-open-market',
      binderId: 'binder-open-market',
      operatingTenantId: 'tenant-1',
    });
    resolveMappedProgramDefinitionMock.mockResolvedValueOnce({
      workflow: { referralOnly: true, externalIssuance: { mode: 'manager_upload_after_payment', documentTypes } },
    });

    const { completeExternalIssuance } = await import('../CompleteExternalIssuance.js');
    const result = await completeExternalIssuance({
      policyId: 'pol-1',
      actor: { id: 'manager-1', name: 'Manager', email: 'manager@example.test', role: 'UNDERWRITER' },
      documents: [],
    });

    expect(result).toMatchObject({ status: 'BLOCKED', error: { code: 'REFERRAL_ONLY_PROGRAM' } });
    expect(executeBindCoverageMock).not.toHaveBeenCalled();
    expect(executeIssuePolicyMock).not.toHaveBeenCalled();
  });

  it('resumes a bound policy with its recorded complete pack without a second upload', async () => {
    prismaMock.policy.findUnique.mockResolvedValueOnce({
      id: 'pol-1', status: 'BOUND', productType: 'OPEN_MARKET', programId: 'program-open-market',
      binderId: 'binder-open-market', operatingTenantId: 'tenant-1',
    });
    prismaMock.document.findMany.mockResolvedValueOnce(documentTypes.map((type, index) => ({
      id: `doc-${index + 1}`,
      type,
      riskTransactionId: 'rt-1',
    })));
    prismaMock.riskTransaction.findFirst.mockResolvedValueOnce({ id: 'rt-1' });

    const { completeExternalIssuance } = await import('../CompleteExternalIssuance.js');
    const result = await completeExternalIssuance({
      policyId: 'pol-1',
      actor: { id: 'manager-1', name: 'Manager', email: 'manager@example.test', role: 'UNDERWRITER' },
      documents: [],
      correlationId: 'corr-resume',
    });

    expect(executeBindCoverageMock).not.toHaveBeenCalled();
    expect(txMock.document.create).not.toHaveBeenCalled();
    expect(executeIssuePolicyMock).toHaveBeenCalledWith(expect.objectContaining({
      policyId: 'pol-1',
      correlationId: 'corr-resume',
      externalDocumentEmail: { documentIds: ['doc-1', 'doc-2', 'doc-3'] },
    }));
    expect(result).toMatchObject({ status: 'SUCCESS', data: { idempotent: false } });
  });
});
