import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
}));

vi.mock('../../../../platform/db/connection.js', () => {
  const prisma = {
    document: {
      findMany: findManyMock,
    },
  };
  return { prisma, tenantScopedPrisma: prisma };
});

import { buildPolicyDocumentsRepository } from './policyDocumentsRepository.js';

describe('buildPolicyDocumentsRepository', () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  it('lists documents by policyId after route-level access control', async () => {
    findManyMock.mockResolvedValueOnce([{ id: 'doc-1' }]);
    const repo = buildPolicyDocumentsRepository();

    const rows = await repo.listDocumentsByPolicy({
      policyId: 'policy-1',
      tenantId: 'staff-internal-account',
    });

    expect(rows).toEqual([{ id: 'doc-1' }]);
    expect(findManyMock).toHaveBeenCalledWith({
      where: { policyId: 'policy-1', status: 'GENERATED' },
      orderBy: { createdAt: 'desc' },
    });
  });
});
