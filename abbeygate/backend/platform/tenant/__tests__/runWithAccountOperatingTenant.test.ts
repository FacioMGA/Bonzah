import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TENANT_IDS, type TenantConfig } from '../tenantConfig.js';

const policyHolderFindUnique = vi.fn();
const summaryFindUnique = vi.fn();
const intelligenceFindUnique = vi.fn();
const portfolioFindUnique = vi.fn();
const alertFindFirst = vi.fn();
const activityFindFirst = vi.fn();
const tenantFindUnique = vi.fn();

vi.mock('../../db/connection.js', () => ({
  prisma: {
    policyHolder: { findUnique: (...args: unknown[]) => policyHolderFindUnique(...args) },
    accountSummaryProjection: { findUnique: (...args: unknown[]) => summaryFindUnique(...args) },
    accountIntelligenceProjection: {
      findUnique: (...args: unknown[]) => intelligenceFindUnique(...args),
    },
    accountPortfolioMetrics: { findUnique: (...args: unknown[]) => portfolioFindUnique(...args) },
    accountAlertsProjection: { findFirst: (...args: unknown[]) => alertFindFirst(...args) },
    accountActivityFeed: { findFirst: (...args: unknown[]) => activityFindFirst(...args) },
    tenant: { findUnique: (...args: unknown[]) => tenantFindUnique(...args) },
  },
}));

const runWithOperatingTenantMock = vi.fn(
  async (_tenant: TenantConfig, fn: () => Promise<unknown>) => fn(),
);
vi.mock('../tenantAls.js', () => ({
  runWithOperatingTenant: (tenant: TenantConfig, fn: () => Promise<unknown>) =>
    runWithOperatingTenantMock(tenant, fn),
}));

const { runWithAccountOperatingTenant, AccountTenantContextMissingError } = await import(
  '../tenantJobContext.js'
);

const CY_TENANT_ROW = {
  id: TENANT_IDS.CY,
  tenantSlug: 'abbeygate-cy',
  countryCode: 'CY',
  country: 'Cyprus',
  currency: 'EUR',
  iptJson: { flatFee: 0 },
  adminFee: 18,
  legalPack: 'cy',
  publicBaseUrl: 'https://abbeygate-cy.facio.io',
  fromEmail: 'no-reply@abbeygate.cy',
  brandLogos: { white: '', blue: '' },
  defaultBrokerName: 'Abbeygate',
};

describe('runWithAccountOperatingTenant (ABY-408)', () => {
  beforeEach(() => {
    policyHolderFindUnique.mockReset();
    summaryFindUnique.mockReset();
    intelligenceFindUnique.mockReset();
    portfolioFindUnique.mockReset();
    alertFindFirst.mockReset();
    activityFindFirst.mockReset();
    tenantFindUnique.mockReset();
    runWithOperatingTenantMock.mockClear();
    tenantFindUnique.mockResolvedValue(CY_TENANT_ROW);
  });

  it('restores tenant from PolicyHolder when present', async () => {
    policyHolderFindUnique.mockResolvedValueOnce({ operatingTenantId: TENANT_IDS.CY });
    const body = vi.fn(async () => 'ok');

    await expect(runWithAccountOperatingTenant('ph_1', body)).resolves.toBe('ok');

    expect(policyHolderFindUnique).toHaveBeenCalledWith({
      where: { id: 'ph_1' },
      select: { operatingTenantId: true },
    });
    expect(summaryFindUnique).not.toHaveBeenCalled();
    expect(runWithOperatingTenantMock).toHaveBeenCalledTimes(1);
    expect(runWithOperatingTenantMock.mock.calls[0]?.[0]).toMatchObject({ id: TENANT_IDS.CY });
    expect(body).toHaveBeenCalledTimes(1);
  });

  it('restores tenant from leftover AccountSummaryProjection when PolicyHolder is already deleted (DELETE /api/accounts enqueue path)', async () => {
    // Regression ABY-408: DELETE removes the holder then enqueues
    // ACCOUNTS360.PROJECTION_UPDATE so rebuild can purge projection rows.
    // Tenant restore must read the leftover projection FK — otherwise the
    // worker throws before the `if (!holder)` cleanup branch runs.
    policyHolderFindUnique.mockResolvedValueOnce(null);
    summaryFindUnique.mockResolvedValueOnce({ operatingTenantId: TENANT_IDS.CY });
    const body = vi.fn(async () => 'cleaned');

    await expect(
      runWithAccountOperatingTenant('e19a1e62-8a33-4e70-8b40-503b8c25e528', body),
    ).resolves.toBe('cleaned');

    expect(summaryFindUnique).toHaveBeenCalledWith({
      where: { accountId: 'e19a1e62-8a33-4e70-8b40-503b8c25e528' },
      select: { operatingTenantId: true },
    });
    expect(runWithOperatingTenantMock).toHaveBeenCalledTimes(1);
    expect(body).toHaveBeenCalledTimes(1);
  });

  it('restores tenant from AccountIntelligenceProjection when summary is also gone', async () => {
    policyHolderFindUnique.mockResolvedValueOnce(null);
    summaryFindUnique.mockResolvedValueOnce(null);
    intelligenceFindUnique.mockResolvedValueOnce({ operatingTenantId: TENANT_IDS.CY });
    const body = vi.fn(async () => 'ok');

    await expect(runWithAccountOperatingTenant('ph_intel', body)).resolves.toBe('ok');
    expect(intelligenceFindUnique).toHaveBeenCalledTimes(1);
    expect(body).toHaveBeenCalledTimes(1);
  });

  it('restores tenant from the remaining cleanup-owned activity row', async () => {
    policyHolderFindUnique.mockResolvedValueOnce(null);
    summaryFindUnique.mockResolvedValueOnce(null);
    intelligenceFindUnique.mockResolvedValueOnce(null);
    portfolioFindUnique.mockResolvedValueOnce(null);
    alertFindFirst.mockResolvedValueOnce(null);
    activityFindFirst.mockResolvedValueOnce({ operatingTenantId: TENANT_IDS.CY });
    const body = vi.fn(async () => 'cleaned');

    await expect(runWithAccountOperatingTenant('ph_activity', body)).resolves.toBe('cleaned');
    expect(activityFindFirst).toHaveBeenCalledWith({
      where: { accountId: 'ph_activity' },
      select: { operatingTenantId: true },
    });
    expect(body).toHaveBeenCalledTimes(1);
  });

  it('throws typed AccountTenantContextMissingError when holder and projections are all gone (permanent miss)', async () => {
    policyHolderFindUnique.mockResolvedValueOnce(null);
    summaryFindUnique.mockResolvedValueOnce(null);
    intelligenceFindUnique.mockResolvedValueOnce(null);
    portfolioFindUnique.mockResolvedValueOnce(null);
    alertFindFirst.mockResolvedValueOnce(null);
    activityFindFirst.mockResolvedValueOnce(null);
    const body = vi.fn(async () => 'never');

    const err = await runWithAccountOperatingTenant('ph_orphan', body).catch((e) => e);

    expect(err).toBeInstanceOf(AccountTenantContextMissingError);
    expect(err).toMatchObject({
      message: 'Account tenant context not found: ph_orphan',
      accountId: 'ph_orphan',
    });
    expect(runWithOperatingTenantMock).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
  });
});
