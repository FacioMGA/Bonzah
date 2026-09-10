import { describe, expect, it, vi } from 'vitest';
import { emailPolicyDocumentsUseCase } from './emailPolicyDocumentsUseCase.js';

function buildDeps(overrides?: Partial<Parameters<typeof emailPolicyDocumentsUseCase>[1]>) {
  const deps: Parameters<typeof emailPolicyDocumentsUseCase>[1] = {
    repo: {
      async findPolicy() {
        return {
          id: 'pol_1',
          policyNumber: 'ABV123',
          quoteData: { proposer: { email: 'client@example.com', firstName: 'Ada', lastName: 'Lovelace' } },
          policyHolderName: 'Ada Lovelace',
          policyHolderContactRaw: '',
        };
      },
      async findDocuments() {
        return [
          {
            id: 'doc_1',
            filename: 'Policy.pdf',
            storageUri: '/api/documents/file-1.pdf',
            type: 'MOTOR_POLICY_PDF',
            docPack: 'ISSUED_POLICY_PACK',
            status: 'GENERATED',
          },
        ];
      },
    },
    storage: {
      async fetchPdfBufferFromStorageUri() {
        return Buffer.from('pdf-content');
      },
    },
    notifications: {
      async sendRequestedDocumentsEmail() {
        return true;
      },
    },
  };
  return { ...deps, ...overrides };
}

describe('emailPolicyDocumentsUseCase', () => {
  it('returns BAD_REQUEST for empty ids', async () => {
    const result = await emailPolicyDocumentsUseCase(
      { policyId: 'pol_1', tenantId: 'tenant_1', documentIds: ['   '] },
      buildDeps()
    );
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'documentIds is required' },
    });
  });

  it('returns NOT_FOUND when policy is missing', async () => {
    const deps = buildDeps({
      repo: {
        ...buildDeps().repo,
        findPolicy: vi.fn(async () => null),
      },
    });
    const result = await emailPolicyDocumentsUseCase(
      { policyId: 'missing', tenantId: 'tenant_1', documentIds: ['doc_1'] },
      deps
    );
    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Policy not found' },
    });
  });

  it('returns NOT_READY when no generated attachments are available', async () => {
    const deps = buildDeps({
      repo: {
        ...buildDeps().repo,
        findDocuments: vi.fn(async () => [
          {
            id: 'doc_1',
            filename: 'Policy.pdf',
            storageUri: '/api/documents/file-1.pdf',
            type: 'MOTOR_POLICY_PDF',
            docPack: 'ISSUED_POLICY_PACK',
            status: 'PENDING',
          },
        ]),
      },
    });
    const result = await emailPolicyDocumentsUseCase(
      { policyId: 'pol_1', tenantId: 'tenant_1', documentIds: ['doc_1'] },
      deps
    );
    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      success: false,
      error: { code: 'NOT_READY', message: 'Selected documents are not available to email yet' },
    });
  });

  it('returns success payload with unchanged shape', async () => {
    const result = await emailPolicyDocumentsUseCase(
      { policyId: 'pol_1', tenantId: 'tenant_1', documentIds: ['doc_1', 'doc_1'] },
      buildDeps()
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      data: { sent: true, toEmail: 'client@example.com', count: 1 },
    });
  });
});
