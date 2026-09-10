import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import {
  getOperatingTenantConfig,
  withoutOperatingTenantForTest,
} from '../../../tenant/tenantAls.js';
import { loadTenantConfig, resolveOperatingTenant, resetResolveTenantCache } from '../resolveTenant.js';
import { TENANT_IDS, type TenantConfig } from '../../../tenant/tenantConfig.js';

// ---------------------------------------------------------------------------
// Vitest module mocking — replace the prisma singleton with a controllable stub
// ---------------------------------------------------------------------------

const mockFindUnique = vi.fn();
vi.mock('../../../db/connection.js', () => ({
  prisma: { tenant: { findUnique: (...args: unknown[]) => mockFindUnique(...args) } },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CY_ROW = {
  id: TENANT_IDS.CY,
  tenantSlug: 'abbeygate-cy',
  kind: 'PRODUCTION',
  status: 'ACTIVE',
  countryCode: 'CY',
  country: 'Cyprus',
  currency: 'EUR',
  iptJson: { flatFee: 0 },
  adminFee: '18.00',
  legalPack: 'cy',
  publicBaseUrl: 'https://abbeygate-cy.facio.io',
  fromEmail: 'no-reply@abbeygate.cy',
  brandLogos: null,
  priorityCountries: ['Cyprus', 'Portugal', 'Spain', 'United Kingdom'],
  allowedRiskCountries: ['Cyprus', 'Portugal', 'Spain', 'Greece'],
  defaultNationality: 'United Kingdom',
  defaultDriversLicenseCountry: 'United Kingdom',
  defaultBrokerName: 'Abbeygate',
  authority: null,
  parentOrganizationId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const PT_ROW = { ...CY_ROW, id: TENANT_IDS.PT, tenantSlug: 'abbeygate-pt', countryCode: 'PT', country: 'Portugal', iptJson: { rate: 0.09 }, legalPack: 'pt', publicBaseUrl: 'https://abbeygate-pt.facio.io', fromEmail: 'no-reply@abbeygate.pt' };

function makeReq(overrides: Partial<Request> = {}): Request {
  // Test fixture: middleware only reads `headers`, `query`, `user`.
  // Source is `Partial<Request>` which is a structural superset of `Request`,
  // so a single narrow cast is sufficient (no `unknown` needed).
  const fixture: Partial<Request> = { headers: {}, query: {}, ...overrides };
  return fixture as Request;
}

function makeRes(): Response {
  const fixture: Partial<Response> = {};
  return fixture as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadTenantConfig', () => {
  beforeEach(() => {
    resetResolveTenantCache();
    mockFindUnique.mockReset();
  });

  it('returns null when the slug is not found in the DB', async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await loadTenantConfig('unknown-slug');
    expect(result).toBeNull();
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { tenantSlug: 'unknown-slug' } });
  });

  it('maps a Tenant DB row to the TenantConfig shape', async () => {
    mockFindUnique.mockResolvedValue(CY_ROW);
    const config = await loadTenantConfig('abbeygate-cy');

    expect(config).toMatchObject<Partial<TenantConfig>>({
      tenantSlug: 'abbeygate-cy',
      countryCode: 'CY',
      country: 'Cyprus',
      currency: 'EUR',
      ipt: { flatFee: 0 },
      adminFee: 18,
      legalPack: 'cy',
      defaultBrokerName: 'Abbeygate',
    });
  });

  it('caches the result and does not call the DB again within 60 s', async () => {
    mockFindUnique.mockResolvedValue(CY_ROW);
    await loadTenantConfig('abbeygate-cy');
    await loadTenantConfig('abbeygate-cy');
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  it('returns null and logs a warning when the DB throws', async () => {
    mockFindUnique.mockRejectedValue(new Error('DB timeout'));
    const result = await loadTenantConfig('abbeygate-cy');
    expect(result).toBeNull();
  });
});

describe('resolveOperatingTenant middleware (ADR-0019 fail-closed)', () => {
  beforeEach(() => {
    resetResolveTenantCache();
    mockFindUnique.mockReset();
    delete process.env.TENANT_SLUG;
  });

  it('fails closed with TENANT_UNRESOLVED when no slug is available', async () => {
    // The vitest setup file installs a default CY ALS context; clear it
    // for this test so the assertion that ALS is unbound after fail-closed
    // is meaningful.
    await withoutOperatingTenantForTest(async () => {
      const next = vi.fn();
      await resolveOperatingTenant(makeReq(), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0]?.[0] as Error & { code?: string; status?: number };
      expect(err).toBeInstanceOf(Error);
      expect(err?.code).toBe('TENANT_UNRESOLVED');
      expect(err?.status).toBe(403);
      // ALS should NOT be bound when we fail closed.
      expect(getOperatingTenantConfig()).toBeNull();
    });
  });

  it('resolves slug from X-Tenant-Slug header and binds ALS config', async () => {
    mockFindUnique.mockResolvedValue(PT_ROW);
    const next: NextFunction = vi.fn(() => {
      // Inside next() we should see the PT config in ALS.
      const config = getOperatingTenantConfig();
      expect(config?.countryCode).toBe('PT');
    });

    await resolveOperatingTenant(
      makeReq({ headers: { 'x-tenant-slug': 'abbeygate-pt' } }),
      makeRes(),
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('resolves slug from staging host when no explicit tenant header is present', async () => {
    mockFindUnique.mockResolvedValue(PT_ROW);
    const next: NextFunction = vi.fn(() => {
      expect(getOperatingTenantConfig()?.tenantSlug).toBe('abbeygate-pt');
    });

    await resolveOperatingTenant(
      makeReq({ headers: { host: 'abbeygate-pt.facio.io' } }),
      makeRes(),
      next,
    );

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { tenantSlug: 'abbeygate-pt' } });
    expect(next).toHaveBeenCalled();
  });

  it('resolves the production abbeygate.com host to the same tenant slug as the legacy facio.io host', async () => {
    mockFindUnique.mockResolvedValue(CY_ROW);
    const next: NextFunction = vi.fn(() => {
      expect(getOperatingTenantConfig()?.tenantSlug).toBe('abbeygate-cy');
    });

    await resolveOperatingTenant(
      makeReq({ headers: { host: 'cy.abbeygate.com' } }),
      makeRes(),
      next,
    );

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { tenantSlug: 'abbeygate-cy' } });
    expect(next).toHaveBeenCalled();
  });

  it('resolves the production gr.abbeygate.com host to the Greece tenant slug', async () => {
    const GR_ROW = { ...PT_ROW, id: TENANT_IDS.GR, tenantSlug: 'abbeygate-gr', countryCode: 'GR', country: 'Greece', legalPack: 'gr', publicBaseUrl: 'https://abbeygate-gr.facio.io', fromEmail: 'no-reply@abbeygate.gr' };
    mockFindUnique.mockResolvedValue(GR_ROW);
    const next: NextFunction = vi.fn(() => {
      expect(getOperatingTenantConfig()?.tenantSlug).toBe('abbeygate-gr');
    });

    await resolveOperatingTenant(
      makeReq({ headers: { host: 'gr.abbeygate.com' } }),
      makeRes(),
      next,
    );

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { tenantSlug: 'abbeygate-gr' } });
    expect(next).toHaveBeenCalled();
  });

  it('resolves the staging-marked host to the tenant slug (environment isolation lives in the deployment, not the slug)', async () => {
    mockFindUnique.mockResolvedValue(PT_ROW);
    const next: NextFunction = vi.fn(() => {
      expect(getOperatingTenantConfig()?.tenantSlug).toBe('abbeygate-pt');
    });

    await resolveOperatingTenant(
      makeReq({ headers: { host: 'pt.staging.abbeygate.com' } }),
      makeRes(),
      next,
    );

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { tenantSlug: 'abbeygate-pt' } });
    expect(next).toHaveBeenCalled();
  });

  it('prefers X-Tenant-Slug over host so tests and admin tooling can override site routing', async () => {
    mockFindUnique.mockResolvedValue(CY_ROW);
    const next: NextFunction = vi.fn(() => {
      expect(getOperatingTenantConfig()?.tenantSlug).toBe('abbeygate-cy');
    });

    await resolveOperatingTenant(
      makeReq({
        headers: {
          host: 'abbeygate-pt.facio.io',
          'x-tenant-slug': 'abbeygate-cy',
        },
      }),
      makeRes(),
      next,
    );

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { tenantSlug: 'abbeygate-cy' } });
    expect(next).toHaveBeenCalled();
  });

  it('resolves slug from JWT claim tenant_slug on req.user', async () => {
    mockFindUnique.mockResolvedValue(CY_ROW);
    const next: NextFunction = vi.fn(() => {
      expect(getOperatingTenantConfig()?.countryCode).toBe('CY');
    });

    await resolveOperatingTenant(
      makeReq({ user: { id: 'u1', tenant_slug: 'abbeygate-cy' } }),
      makeRes(),
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('resolves slug from TENANT_SLUG env var when nothing else is set (single-tenant deploy convenience)', async () => {
    process.env.TENANT_SLUG = 'abbeygate-cy';
    mockFindUnique.mockResolvedValue(CY_ROW);
    const next: NextFunction = vi.fn(() => {
      expect(getOperatingTenantConfig()?.countryCode).toBe('CY');
    });

    await resolveOperatingTenant(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('fails closed with TENANT_UNKNOWN when slug resolves but DB has no matching tenant', async () => {
    process.env.TENANT_SLUG = 'unknown-tenant';
    mockFindUnique.mockResolvedValue(null);

    await withoutOperatingTenantForTest(async () => {
      const next = vi.fn();
      await resolveOperatingTenant(makeReq(), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0]?.[0] as Error & { code?: string; status?: number };
      expect(err).toBeInstanceOf(Error);
      expect(err?.code).toBe('TENANT_UNKNOWN');
      expect(err?.status).toBe(404);
      expect(getOperatingTenantConfig()).toBeNull();
    });
  });
});
