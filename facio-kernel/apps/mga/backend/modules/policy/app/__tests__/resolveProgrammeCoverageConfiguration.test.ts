import { beforeEach, describe, expect, it, vi } from 'vitest';

const findAuthority = vi.fn();
const resolveDefinition = vi.fn();
const parseCoverage = vi.fn();

vi.mock('../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    binderProductAuthority: { findUnique: (...args: unknown[]) => findAuthority(...args) },
  },
}));
vi.mock('../../../programs/app/activeProgramDefinition.js', () => ({
  resolveMappedProgramDefinition: (...args: unknown[]) => resolveDefinition(...args),
}));
vi.mock('../../../mbe/domain/programProduct.js', () => ({
  parsePublishedProgramMbeProductConfig: (...args: unknown[]) => parseCoverage(...args),
}));

import { resolveProgrammeCoverageConfiguration } from '../resolveProgrammeCoverageConfiguration.js';

describe('resolveProgrammeCoverageConfiguration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    findAuthority.mockResolvedValue({ id: 'authority-1' });
    resolveDefinition.mockResolvedValue({
      pricingMode: 'AUTOMATED',
      coverage: { schemaVersion: 1, programCode: 'abbeygate_motor', base: [], options: [] },
    });
    parseCoverage.mockReturnValue({ schemaVersion: 1, programCode: 'abbeygate_motor', base: [], options: [] });
  });

  it('uses the policy binder-product authority and the mapped definition only', async () => {
    await expect(resolveProgrammeCoverageConfiguration({
      programId: 'program-1', binderId: 'binder-1', productType: 'motor',
    })).resolves.toEqual({ schemaVersion: 1, programCode: 'abbeygate_motor', base: [], options: [] });

    expect(findAuthority).toHaveBeenCalledWith({
      where: { binderId_productCode: { binderId: 'binder-1', productCode: 'MOTOR' } },
      select: { id: true },
    });
    expect(resolveDefinition).toHaveBeenCalledWith({ programId: 'program-1', binderProductAuthorityId: 'authority-1' });
    expect(parseCoverage).toHaveBeenCalledWith(
      { schemaVersion: 1, programCode: 'abbeygate_motor', base: [], options: [] },
      { productType: 'MOTOR' },
    );
  });

  it('fails closed when the authority is absent', async () => {
    findAuthority.mockResolvedValue(null);
    await expect(resolveProgrammeCoverageConfiguration({
      programId: 'program-1', binderId: 'binder-1', productType: 'MOTOR',
    })).rejects.toThrow('No active binder product authority');
    expect(resolveDefinition).not.toHaveBeenCalled();
  });

  it('rejects a manual definition instead of manufacturing coverage defaults', async () => {
    resolveDefinition.mockResolvedValue({ pricingMode: 'MANUAL', coverage: { schemaVersion: 1, mode: 'MANUAL' } });
    await expect(resolveProgrammeCoverageConfiguration({
      programId: 'program-1', binderId: 'binder-1', productType: 'MOTOR',
    })).rejects.toThrow('automated programme definition');
    expect(parseCoverage).not.toHaveBeenCalled();
  });
});
