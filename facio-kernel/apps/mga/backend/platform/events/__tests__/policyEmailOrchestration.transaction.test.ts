import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db/connection.js', () => ({
  runTenantScopedTransaction: vi.fn(),
  tenantScopedPrisma: {},
}));
vi.mock('../../storage/service.js', () => ({ storageService: {} }));
vi.mock('../../utils/logger.js', () => ({ logger: {} }));
vi.mock('../../http/publicAppLinks.js', () => ({}));
vi.mock('../../tenant/tenantConfig.js', () => ({}));

import {
  quoteDataFromIssuedRiskTransactionSnapshot,
  welcomeEmailAlreadySentForTransaction,
} from '../policyEmailOrchestration.js';

describe('issued-pack email transaction ownership', () => {
  it('does not let an earlier transaction suppress a renewal confirmation', () => {
    expect(welcomeEmailAlreadySentForTransaction({
      sentAt: '2026-08-01T10:00:00.000Z',
      riskTransactionId: 'inception-transaction',
    }, 'renewal-transaction')).toBe(false);
  });

  it('keeps retries idempotent within the same risk transaction', () => {
    expect(welcomeEmailAlreadySentForTransaction({
      sentAt: '2026-08-01T10:00:00.000Z',
      riskTransactionId: 'renewal-transaction',
    }, 'renewal-transaction')).toBe(true);
  });

  it('reads the contents amount from the immutable issued snapshot', () => {
    expect(quoteDataFromIssuedRiskTransactionSnapshot({
      quoteData: { coverage: { contents: 60_000 } },
    })).toEqual({ coverage: { contents: 60_000 } });
  });

  it('fails visibly when an issued transaction does not carry quote data', () => {
    expect(() => quoteDataFromIssuedRiskTransactionSnapshot({})).toThrow(
      'Issued risk transaction snapshot is missing quoteData',
    );
  });
});
