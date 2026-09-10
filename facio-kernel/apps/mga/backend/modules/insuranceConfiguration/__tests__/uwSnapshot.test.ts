import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ policy: vi.fn(), upsert: vi.fn(), context: vi.fn(), validation: vi.fn() }));
vi.mock('../../../platform/db/connection.js', () => {
  const tx = { policy: { findUnique: mocks.policy, update: vi.fn() }, policyStateCurrent: { findUnique: vi.fn(async () => ({ snapshot: { programDefinition: { id: 'previous-price' }, quoteResponse: { primaryOption: {} } } })), upsert: mocks.upsert }, binderProductAuthority: { findUnique: vi.fn(async () => ({ id: 'authority' })) } };
  return { prisma: tx, tenantScopedPrisma: tx, runTenantScopedTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };
});
vi.mock('../../policy/app/productRegistryService.js', async (original) => ({
  ...(await original<typeof import('../../policy/app/productRegistryService.js')>()),
  productAdapterExists: () => true,
  normalizeUwDataForProduct: (_product: string, value: object) => ({ normalizedQuoteData: value, productFields: {} }),
  validateProductQuoteForIssuance: mocks.validation,
  resolvePublishedProgramQuoteContext: mocks.context,
  buildQuoteResponseForProduct: async () => ({ quoteResponse: { status: 'QUOTED', primaryOption: { annualPremium: 500 } }, underwritingAnalysis: { outcome: 'accept' } }),
}));
vi.mock('../../policy/app/coverageSelectionHttpProjection.js', () => ({ resolveCoverageContractForHttp: () => ({ schemaVersion: 1, programId: 'programme', programCode: 'commercial', selected: {}, params: {}, source: 'UW_SAVE', updatedAt: '2026-09-07T00:00:00Z' }) }));
vi.mock('../../policy/app/pricing/pricingIntegrityStamp.js', () => ({ computePricingIntegrityStamp: () => ({ snapshotHash: 'snapshot', pricingHash: 'price' }) }));
vi.mock('../../policy/app/commands/policyLifecycleCommands.js', () => ({ transitionPolicyLifecycle: vi.fn() }));
vi.mock('../../policy/app/policyListIndex.js', () => ({ enqueuePolicyListIndexUpdate: vi.fn() }));
vi.mock('../../../platform/audit/logger.js', () => ({ AuditLogger: { log: vi.fn() } }));
import { updatePolicyUwFormHandler } from '../../policy/http/uwRouter.js';
import { commercialContext } from '../../../products/commercial/__tests__/fixtures.js';

describe('BO underwriting retains the selected rating definition', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.policy.mockResolvedValue({ id: 'policy', status: 'DRAFT', productType: 'COMMERCIAL', programId: 'programme', binderId: 'binder', quoteData: {} }); mocks.validation.mockResolvedValue({ missingForQuotePack: [], schemaIssues: [] }); const context = commercialContext(); mocks.context.mockResolvedValue({ programDefinition: context.programDefinition, coverage: context.programDefinition!.coverage }); });
  const save = async () => { const response = { status: vi.fn(), json: vi.fn() }; response.status.mockReturnValue(response); await updatePolicyUwFormHandler({ params: { id: 'policy' }, body: { quoteDataUpdates: { commercial: { turnover: 100000 } } }, user: { id: 'admin', role: 'ADMIN' } } as never, response); expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ success: true })); return mocks.upsert.mock.calls[0][0].update.snapshot; };
  it('saves the exact resolved programme, document authority and source workflow alongside its price', async () => {
    const snapshot = await save();
    expect(snapshot.programDefinition).toEqual(commercialContext().programDefinition);
    expect(snapshot.quoteResponse.primaryOption.annualPremium).toBe(500);
    expect(snapshot.programDefinition.id).not.toBe('previous-price');
  });
  it('removes stale pricing authority when an incomplete edit cannot be rated', async () => {
    mocks.validation.mockResolvedValue({ missingForQuotePack: ['commercial.turnover'], schemaIssues: [] });
    const snapshot = await save();
    expect(snapshot.programDefinition).not.toHaveProperty('id'); expect(snapshot.quoteResponse).not.toHaveProperty('primaryOption');
    expect(mocks.context).not.toHaveBeenCalled();
  });
});
