import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUnique = vi.fn();

vi.mock('../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    binderProductAuthorityProgramDefinition: { findUnique: (...args: unknown[]) => findUnique(...args) },
  },
}));

vi.mock('../../../../platform/tenant/tenantConfig.js', () => ({
  getTenantConfig: vi.fn(() => ({ id: 'tenant-cy' })),
}));

const { resolveMappedProgramDefinition } = await import('../activeProgramDefinition.js');
const { ProgramDefinitionConfigurationError } = await import('../../domain/programDefinition.js');

const components = {
  underwriting: { rules: [] },
  coverage: { options: [] },
  questionnaire: { fields: [] },
  workflow: { stages: [] },
  channels: { publicQuote: true },
  documents: { pack: 'MOTOR_POLICY' },
};

const activeAuthority = {
  operatingTenantId: 'tenant-cy',
  status: 'ACTIVE',
  ratingModelMapping: { programRatingModelId: 'rates-v2' },
  binder: { status: 'ACTIVE', programLinks: [{ id: 'link-1' }] },
};

const ratingStages = [{ id: 'resolve-excess', operator: 'resolve-excess' }];

describe('resolveMappedProgramDefinition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves the one published automated definition mapped to the binder authority', async () => {
    findUnique.mockResolvedValue({
      binderProductAuthority: activeAuthority,
      programDefinitionVersion: {
        id: 'definition-santam-v2', operatingTenantId: 'tenant-cy', programId: 'program-motor-pt', version: 2,
        status: 'PUBLISHED', pricingMode: 'AUTOMATED', ...components,
        programRatingModel: { id: 'rates-v2', programId: 'program-motor-pt', version: 2, status: 'PUBLISHED', stages: ratingStages, tables: { matrix: [] } },
      },
    });

    await expect(resolveMappedProgramDefinition({
      programId: 'program-motor-pt', binderProductAuthorityId: 'authority-santam-motor',
    })).resolves.toMatchObject({
      id: 'definition-santam-v2', pricingMode: 'AUTOMATED',
      ratingModel: { id: 'rates-v2', tables: { matrix: [] } }, ...components,
    });
  });

  it('supports explicit manual pricing without smuggling a static rating model', async () => {
    findUnique.mockResolvedValue({
      binderProductAuthority: activeAuthority,
      programDefinitionVersion: {
        id: 'definition-business-v1', operatingTenantId: 'tenant-cy', programId: 'program-business-gr', version: 1,
        status: 'PUBLISHED', pricingMode: 'MANUAL', ...components, programRatingModel: null,
      },
    });

    await expect(resolveMappedProgramDefinition({
      programId: 'program-business-gr', binderProductAuthorityId: 'authority-business',
    })).resolves.toMatchObject({ id: 'definition-business-v1', pricingMode: 'MANUAL', ...components });
  });

  it('fails closed for absent mappings, missing components and unpublished models', async () => {
    findUnique.mockResolvedValue(null);
    await expect(resolveMappedProgramDefinition({
      programId: 'program-motor-pt', binderProductAuthorityId: 'authority-santam-motor',
    })).rejects.toBeInstanceOf(ProgramDefinitionConfigurationError);

    findUnique.mockResolvedValue({
      binderProductAuthority: activeAuthority,
      programDefinitionVersion: {
        id: 'definition-bad', operatingTenantId: 'tenant-cy', programId: 'program-motor-pt', version: 1,
        status: 'PUBLISHED', pricingMode: 'AUTOMATED', ...components,
        channels: null,
        programRatingModel: { id: 'rates-draft', programId: 'program-motor-pt', version: 1, status: 'DRAFT', stages: ratingStages, tables: {} },
      },
    });
    await expect(resolveMappedProgramDefinition({
      programId: 'program-motor-pt', binderProductAuthorityId: 'authority-santam-motor',
    })).rejects.toThrow('channels component is not an object');
  });

  it('fails closed when the mapped definition and rating model belong to different binder authorities', async () => {
    findUnique.mockResolvedValue({
      binderProductAuthority: { ...activeAuthority, ratingModelMapping: { programRatingModelId: 'rates-for-another-authority' } },
      programDefinitionVersion: {
        id: 'definition-santam-v2', operatingTenantId: 'tenant-cy', programId: 'program-motor-pt', version: 2,
        status: 'PUBLISHED', pricingMode: 'AUTOMATED', ...components,
        programRatingModel: { id: 'rates-v2', programId: 'program-motor-pt', version: 2, status: 'PUBLISHED', stages: ratingStages, tables: { matrix: [] } },
      },
    });

    await expect(resolveMappedProgramDefinition({
      programId: 'program-motor-pt', binderProductAuthorityId: 'authority-santam-motor',
    })).rejects.toThrow('selected rating model is not mapped to this binder-product authority');
  });

  it.each([
    ['authority', { ...activeAuthority, status: 'SUSPENDED' }, 'authority is not active'],
    ['binder', { ...activeAuthority, binder: { ...activeAuthority.binder, status: 'EXPIRED' } }, 'binder is not active'],
    ['program link', { ...activeAuthority, binder: { ...activeAuthority.binder, programLinks: [] } }, 'binder has no active link to this program'],
  ])('fails closed when the mapped %s is no longer active', async (_label, binderProductAuthority, expectedReason) => {
    findUnique.mockResolvedValue({
      binderProductAuthority,
      programDefinitionVersion: {
        id: 'definition-santam-v2', operatingTenantId: 'tenant-cy', programId: 'program-motor-pt', version: 2,
        status: 'PUBLISHED', pricingMode: 'AUTOMATED', ...components,
        programRatingModel: { id: 'rates-v2', programId: 'program-motor-pt', version: 2, status: 'PUBLISHED', stages: ratingStages, tables: { matrix: [] } },
      },
    });

    await expect(resolveMappedProgramDefinition({
      programId: 'program-motor-pt', binderProductAuthorityId: 'authority-santam-motor',
    })).rejects.toThrow(expectedReason);
  });
});
