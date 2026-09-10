import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUniqueMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    policy: {
      findUnique: findUniqueMock,
      findMany: vi.fn(),
    },
  },
}));

import { customerCanAccessPolicy } from '../customerPolicyAccess.js';

describe('customerPolicyAccess', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
  });

  it('allows access when quoteData.proposer.email matches the customer', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'pol-home-pt',
      accountId: null,
      quoteData: { proposer: { email: 'customer@example.com' } },
      policyHolder: { contact: '{}' },
    });

    await expect(
      customerCanAccessPolicy(
        { role: 'CUSTOMER', email: 'customer@example.com', primaryAccountId: 'acct-other' },
        'pol-home-pt',
      ),
    ).resolves.toBe(true);
  });

  it('denies access when neither account nor email surfaces match', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'pol-home-pt',
      accountId: null,
      quoteData: { proposer: { email: 'other@example.com' } },
      policyHolder: { contact: JSON.stringify({ email: 'other@example.com' }) },
    });

    await expect(
      customerCanAccessPolicy(
        { role: 'CUSTOMER', email: 'customer@example.com', primaryAccountId: 'acct-other' },
        'pol-home-pt',
      ),
    ).resolves.toBe(false);
  });
});
