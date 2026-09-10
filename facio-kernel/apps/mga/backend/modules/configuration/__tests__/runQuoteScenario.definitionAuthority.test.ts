import { describe, expect, it, vi } from 'vitest';

const findDraftMock = vi.fn();
const findAuthorityMock = vi.fn();
const resolveDefinitionMock = vi.fn();
const evaluateMock = vi.fn();

vi.mock('../../policy/domain/ProductRegistry.js', () => ({
  ProductRegistry: {
    getInstance: () => ({
      getAdapter: () => ({
        getRuntimeDefinition: () => ({
          engines: {
            rating: {},
            underwriting: { evaluate: (...args: unknown[]) => evaluateMock(...args) },
            wording: {},
          },
        }),
      }),
    }),
  },
}));

vi.mock('../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    binderProductAuthority: { findUnique: (...args: unknown[]) => findAuthorityMock(...args) },
  },
}));

vi.mock('../../programs/app/activeProgramDefinition.js', () => ({
  resolveMappedProgramDefinition: (...args: unknown[]) => resolveDefinitionMock(...args),
}));

vi.mock('../infra/repositories/productLaunchDraftRepo.js', () => ({
  findDraft: (...args: unknown[]) => findDraftMock(...args),
}));

const { runQuoteScenario } = await import('../app/runQuoteScenario.js');

const publishedDefinition = {
  id: 'definition-1',
  programId: 'program-1',
  version: 3,
  pricingMode: 'AUTOMATED' as const,
  binderProductAuthorityId: 'authority-1',
  underwriting: { scheme: 'published-only' },
  coverage: { schemaVersion: 1, programCode: 'abbeygate_motor', base: [], options: [] },
  questionnaire: { sections: [] },
  workflow: {},
  channels: { questions: true, quote: true, payment: false },
  documents: {},
  ratingModel: { id: 'model-1', programId: 'program-1', version: 4, tables: { rates: [] } },
};

type DraftFixture = {
  id: string;
  productCode: string;
  operatingTenantId: string;
  publishedProgramId: string | null;
  publishedBinderId: string | null;
  delta: { uwOverrides: { thresholds: { vehicleValueReferral: number } } };
};

function draft(overrides: Partial<DraftFixture> = {}): DraftFixture {
  return {
    id: 'draft-1',
    productCode: 'MOTOR',
    operatingTenantId: 'tenant-1',
    publishedProgramId: 'program-1',
    publishedBinderId: 'binder-1',
    delta: { uwOverrides: { thresholds: { vehicleValueReferral: 1 } } },
    ...overrides,
  };
}

describe('runQuoteScenario programme-definition authority', () => {
  it('blocks simulation until a programme and binder are mapped to a published definition', async () => {
    findDraftMock.mockResolvedValue(draft({ publishedProgramId: null }));

    await expect(runQuoteScenario({ draftId: 'draft-1', scenarioName: 'missing', riskData: {} }))
      .rejects.toMatchObject({ code: 'PUBLISH_BLOCKED' });
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  it('passes only the mapped published definition to the underwriting engine', async () => {
    findDraftMock.mockResolvedValue(draft());
    findAuthorityMock.mockResolvedValue({ id: 'authority-1' });
    resolveDefinitionMock.mockResolvedValue(publishedDefinition);
    evaluateMock.mockResolvedValue({ decision: { outcome: 'accept', reasons: [] } });

    await expect(runQuoteScenario({ draftId: 'draft-1', scenarioName: 'published', riskData: { vehicleValue: 10000 } }))
      .resolves.toMatchObject({ result: { outcome: 'accept' } });

    expect(resolveDefinitionMock).toHaveBeenCalledWith({ programId: 'program-1', binderProductAuthorityId: 'authority-1' });
    expect(evaluateMock).toHaveBeenCalledWith(expect.objectContaining({
      productType: 'MOTOR',
      context: expect.objectContaining({
        programDefinition: expect.objectContaining({ id: 'definition-1', underwriting: { scheme: 'published-only' } }),
        ratingModel: expect.objectContaining({ id: 'model-1', binderProductAuthorityId: 'authority-1' }),
      }),
    }));
    expect(evaluateMock.mock.calls[0]?.[0]).not.toHaveProperty('programMeta');
  });
});
