import { describe, it, expect } from 'vitest';

import {
  runWithOperatingTenant,
  getOperatingTenantConfig,
  withoutOperatingTenantForTest,
  readOperatingTenantFromError,
} from '../tenantAls.js';
import {
  getTenantConfig,
  onlinePolicyConfirmationCopyEmailsForCountry,
  TenantNotResolvedError,
  TENANT_IDS,
  type TenantConfig,
} from '../tenantConfig.js';

const CY_CONFIG: TenantConfig = {
  id: TENANT_IDS.CY,
  tenantSlug: 'abbeygate-cy',
  countryCode: 'CY',
  country: 'Cyprus',
  currency: 'EUR',
  ipt: { flatFee: 0 },
  adminFee: 18,
  legalPack: 'cy',
  publicBaseUrl: 'https://abbeygate-cy.facio.io',
  fromEmail: 'no-reply@abbeygate.cy',
  brandLogo: { white: '', blue: '' },
};

const PT_CONFIG: TenantConfig = {
  id: TENANT_IDS.PT,
  tenantSlug: 'abbeygate-pt',
  countryCode: 'PT',
  country: 'Portugal',
  currency: 'EUR',
  ipt: { rate: 0.09 },
  adminFee: 18,
  legalPack: 'pt',
  publicBaseUrl: 'https://abbeygate-pt.facio.io',
  fromEmail: 'no-reply@abbeygate.pt',
  brandLogo: { white: '', blue: '' },
};

describe('tenantAls', () => {
  describe('getOperatingTenantConfig', () => {
    it('returns null when called outside a runWithOperatingTenant context', () => {
      withoutOperatingTenantForTest(() => {
        expect(getOperatingTenantConfig()).toBeNull();
      });
    });

    it('returns the bound config when inside a runWithOperatingTenant context', () => {
      let result: TenantConfig | null = null;
      runWithOperatingTenant(PT_CONFIG, () => {
        result = getOperatingTenantConfig();
      });
      expect(result).toStrictEqual(PT_CONFIG);
    });

    it('reverts to default test ALS after the runWithOperatingTenant callback completes', () => {
      // Setup file installs a default CY context for tests; nested ALS
      // exits cleanly back to it.
      runWithOperatingTenant(PT_CONFIG, () => { /* no-op */ });
      expect(getOperatingTenantConfig()?.countryCode).toBe('CY');
    });
  });

  describe('getTenantConfig ALS precedence (ADR-0019 fail-closed)', () => {
    it('throws TenantNotResolvedError when no ALS context is bound', () => {
      withoutOperatingTenantForTest(() => {
        expect(() => getTenantConfig()).toThrow(TenantNotResolvedError);
      });
    });

    it('returns the ALS-bound PT config when inside runWithOperatingTenant', () => {
      let config: TenantConfig | null = null;
      runWithOperatingTenant(PT_CONFIG, () => {
        config = getTenantConfig();
      });
      expect(config!.countryCode).toBe('PT');
      expect(config!.tenantSlug).toBe('abbeygate-pt');
    });

    it('throws when ALS context is explicitly cleared mid-test', () => {
      runWithOperatingTenant(PT_CONFIG, () => { /* no-op */ });
      withoutOperatingTenantForTest(() => {
        expect(() => getTenantConfig()).toThrow(TenantNotResolvedError);
      });
    });

    it('correctly nests two different tenant contexts', () => {
      let inner: TenantConfig | null = null;
      let outer: TenantConfig | null = null;

      runWithOperatingTenant(CY_CONFIG, () => {
        outer = getTenantConfig();
        runWithOperatingTenant(PT_CONFIG, () => {
          inner = getTenantConfig();
        });
      });

      expect(outer!.countryCode).toBe('CY');
      expect(inner!.countryCode).toBe('PT');
    });
  });

  describe('operating-tenant error stamping (Sentry per-tenant attribution)', () => {
    it('stamps the tenant onto a synchronously thrown error', () => {
      const err = new Error('sync boom');
      expect(() =>
        runWithOperatingTenant(PT_CONFIG, () => {
          throw err;
        }),
      ).toThrow('sync boom');
      expect(readOperatingTenantFromError(err)).toEqual({ slug: 'abbeygate-pt', countryCode: 'PT' });
    });

    it('stamps the tenant onto an asynchronously rejected error', async () => {
      const err = new Error('async boom');
      await expect(
        runWithOperatingTenant(PT_CONFIG, async () => {
          throw err;
        }),
      ).rejects.toBe(err);
      expect(readOperatingTenantFromError(err)).toEqual({ slug: 'abbeygate-pt', countryCode: 'PT' });
    });

    it('keeps the innermost tenant when an error unwinds through nested scopes', async () => {
      const err = new Error('nested boom');
      await runWithOperatingTenant(CY_CONFIG, async () => {
        await runWithOperatingTenant(PT_CONFIG, async () => {
          throw err;
        });
      }).catch(() => undefined);
      expect(readOperatingTenantFromError(err)).toEqual({ slug: 'abbeygate-pt', countryCode: 'PT' });
    });

    it('returns null for errors that never crossed a tenant scope', () => {
      expect(readOperatingTenantFromError(new Error('infra'))).toBeNull();
      expect(readOperatingTenantFromError(null)).toBeNull();
      expect(readOperatingTenantFromError('not-an-object')).toBeNull();
    });

    it('attributes even a frozen error object (WeakMap keeps attribution off the error shape)', () => {
      const err = Object.freeze(new Error('frozen boom'));
      expect(() =>
        runWithOperatingTenant(PT_CONFIG, () => {
          throw err;
        }),
      ).toThrow('frozen boom');
      // The side table never mutates the error, so freezing is irrelevant.
      expect(readOperatingTenantFromError(err)).toEqual({ slug: 'abbeygate-pt', countryCode: 'PT' });
    });
  });
});

describe('online policy confirmation internal copy routing', () => {
  it('notifies the full Cyprus desk (Danny + Peter + Theo) for processed policies', () => {
    expect(onlinePolicyConfirmationCopyEmailsForCountry('CY')).toEqual([
      'danny@abbeygate.cy',
      'peter@abbeygate.cy',
      'theo@abbeygate.cy',
    ]);
  });

  it('routes the jurisdiction mailbox copy for other live territories', () => {
    expect(onlinePolicyConfirmationCopyEmailsForCountry('PT')).toEqual(['theo@abbeygate.pt']);
    expect(onlinePolicyConfirmationCopyEmailsForCountry('GR')).toEqual(['theo@abbeygate.gr']);
  });

  it('does not send online policy confirmation copies for Cyprus-serviced placeholder territories', () => {
    expect(onlinePolicyConfirmationCopyEmailsForCountry('ES')).toEqual([]);
    expect(onlinePolicyConfirmationCopyEmailsForCountry('IT')).toEqual([]);
  });
});
