import { beforeEach, describe, expect, it, vi } from 'vitest';

const findManyAuthoritiesMock = vi.fn();
vi.mock('../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    binderProductAuthority: { findMany: findManyAuthoritiesMock },
  },
}));

vi.mock('../../../platform/tenant/tenantJobContext.js', () => ({
  runWithBinderOperatingTenant: (_binderId: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../../platform/observability/context.js', () => ({
  ensureCorrelationId: (value: unknown) => String(value || 'test-correlation'),
  runWithCorrelationId: (_correlationId: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../../platform/storage/service.js', () => ({
  storageService: {
    uploadFile: vi.fn(async () => ({ filename: 'bdx.xlsx', url: 'memory://bdx.xlsx' })),
  },
}));

vi.mock('../../../modules/reporting/infra/xlsx/writeBdxWorkbook.js', () => ({
  writeBdxWorkbookBuffer: vi.fn(async () => Buffer.from('xlsx')),
}));

const fetchRowsMock = vi.fn(async () => ({
  rows: [{ 'CR0026 Policy or Group Reference': 'POL-1' }],
  defaultHeaders: ['CR0026 Policy or Group Reference'],
}));
const validateRowsMock = vi.fn();
vi.mock('../../../modules/reporting/domain/bordereaux/lloydsV52.js', () => ({
  fetchLloydsV52BordereauxRows: (...args: unknown[]) => fetchRowsMock(...args),
  validateLloydsV52RowsOrThrow: (...args: unknown[]) => validateRowsMock(...args),
}));

vi.mock('../../../platform/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock('../../index.js', () => ({
  registerHandler: vi.fn(),
}));

describe('XLSX.GENERATE_BORDEREAUX_V52', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyAuthoritiesMock.mockResolvedValue([{ productCode: 'HOME' }]);
  });

  it('uses explicit productType and returns the single-segment router shape', async () => {
    const { handleGenerateBordereauxV52 } = await import('../XLSX.GENERATE_BORDEREAUX_V52.js');

    // bullmq's `Job` is a class with lifecycle methods the handler never
    // calls in this codepath; we build a minimal stub and cast at the
    // variable (not the literal) to satisfy `consistent-type-assertions`.
    const job = {
      id: 'job-1',
      data: {
        binderId: 'binder-1',
        year: 2026,
        month: 3,
        stream: 'risk',
        filenameBase: 'lloyds_v5.2_home_risk_2026-03',
        productType: 'HOME',
        validate: true,
      },
    };
    const result = await handleGenerateBordereauxV52(job as never);

    expect(fetchRowsMock).toHaveBeenCalledWith(expect.objectContaining({ productCode: 'HOME' }));
    expect(validateRowsMock).toHaveBeenCalledWith('risk', expect.any(Array), undefined, 'HOME');
    expect(result).toEqual(expect.objectContaining({
      filename: 'bdx.xlsx',
      url: 'memory://bdx.xlsx',
      productType: 'HOME',
      segments: [expect.objectContaining({ productType: 'HOME', rowCount: 1 })],
    }));
  });

  it('fails closed when a binder has no active product authority rows', async () => {
    findManyAuthoritiesMock.mockResolvedValue([]);
    const { handleGenerateBordereauxV52 } = await import('../XLSX.GENERATE_BORDEREAUX_V52.js');

    const job = {
      id: 'job-2',
      data: {
        binderId: 'binder-without-authority',
        year: 2026,
        month: 3,
        stream: 'risk',
        filenameBase: 'lloyds_v5.2_risk_2026-03',
      },
    };
    await expect(handleGenerateBordereauxV52(job as never)).rejects.toThrow(
      'has no active product authority rows',
    );
  });
});
