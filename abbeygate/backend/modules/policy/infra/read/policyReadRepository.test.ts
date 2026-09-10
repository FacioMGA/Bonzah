import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findPolicyMock, findDocumentsMock } = vi.hoisted(() => ({
  findPolicyMock: vi.fn(),
  findDocumentsMock: vi.fn(),
}));

vi.mock('../../../../platform/db/connection.js', () => {
  const prisma = {
    policy: {
      findFirst: findPolicyMock,
    },
    document: {
      findMany: findDocumentsMock,
    },
  };
  return { prisma, tenantScopedPrisma: prisma };
});

import { buildPolicyReadRepository } from './policyReadRepository.js';

describe('buildPolicyReadRepository', () => {
  beforeEach(() => {
    findPolicyMock.mockReset();
    findDocumentsMock.mockReset();
  });

  it('findPolicy loads by policyId after route-level access control', async () => {
    findPolicyMock.mockResolvedValueOnce({
      id: 'policy-1',
      policyNumber: 'ABV-1',
      quoteData: { email: 'a@b.com' },
      policyHolder: { name: 'A B', contact: '{}' },
    });
    const repo = buildPolicyReadRepository();

    const row = await repo.findPolicy({ policyId: 'policy-1', tenantId: 'staff-internal-account' });

    expect(row?.id).toBe('policy-1');
    expect(findPolicyMock).toHaveBeenCalledWith({
      where: { id: 'policy-1' },
      include: { policyHolder: true },
    });
  });

  it('findDocuments loads by policyId after route-level access control', async () => {
    findDocumentsMock.mockResolvedValueOnce([{ id: 'doc-1' }]);
    const repo = buildPolicyReadRepository();

    const rows = await repo.findDocuments({
      policyId: 'policy-1',
      tenantId: 'staff-internal-account',
      documentIds: ['doc-1'],
    });

    expect(rows).toEqual([{ id: 'doc-1' }]);
    expect(findDocumentsMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['doc-1'] },
        policyId: 'policy-1',
      },
      select: {
        id: true,
        filename: true,
        storageUri: true,
        type: true,
        docPack: true,
        status: true,
      },
    });
  });
});
