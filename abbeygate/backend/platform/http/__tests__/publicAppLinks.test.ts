/**
 * `publicAppLinks` — tenant-aware base-URL resolution.
 *
 * Pins the resolution precedence we MUST preserve for multi-tenant deploys
 * where one set of API/worker pods serves several tenants:
 *
 *     1. ALS operating tenant `publicBaseUrl`
 *     2. Inbound request origin / `x-forwarded-*`
 *     3. Process-wide env vars
 *     4. Hard-coded localhost default
 *
 * The pre-2026-05 ordering had env BEFORE the per-request tenant, which
 * meant emails sent from `abbeygate-pt` carried `abbeygate-cy` links
 * because `PUBLIC_APP_BASE_URL` is a single global value. These tests
 * lock the corrected ordering down so the bug cannot silently come back.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildBackOfficePolicyUrl,
  buildPublicDashboardUrl,
  buildPublicQuoteUrl,
  normalizePublicAppBaseUrl,
  resolvePublicAppBaseUrlFromContext,
  resolvePublicAppBaseUrlFromRequest,
  resolvePublicAppBaseUrlFromTenant,
} from '../publicAppLinks.js';
import { runWithOperatingTenant, withoutOperatingTenantForTest } from '../../tenant/tenantAls.js';
import type { TenantConfig } from '../../tenant/tenantConfig.js';

// ADR-0019: vitest setup installs a default CY tenant ALS for the test
// worker. Tests below that exercise the "no ALS" branch of the
// resolvers explicitly clear it via this helper.
const itNoTenant = (name: string, fn: () => void | Promise<void>) =>
  it(name, () => withoutOperatingTenantForTest(fn));

const CY: TenantConfig = {
  id: '00000000-0000-4000-8000-000000000001',
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

const PT: TenantConfig = {
  id: '00000000-0000-4000-8000-000000000002',
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

const PUBLIC_APP_ENV_KEYS = ['PUBLIC_APP_BASE_URL', 'FRONTEND_URL', 'APP_URL', 'APP_BASE_URL'] as const;

describe('publicAppLinks', () => {
  // Snapshot the env once and restore it between tests so we never leak
  // simulated multi-tenant configurations into other suites.
  const ENV_BACKUP: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of PUBLIC_APP_ENV_KEYS) {
      ENV_BACKUP[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of PUBLIC_APP_ENV_KEYS) {
      const prev = ENV_BACKUP[key];
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  });

  describe('normalizePublicAppBaseUrl', () => {
    it('normalizes localhost:3000 to frontend port 5173', () => {
      expect(normalizePublicAppBaseUrl('http://localhost:3000')).toBe('http://localhost:5173');
    });

    it('strips a trailing slash', () => {
      expect(normalizePublicAppBaseUrl('https://abbeygate-pt.facio.io/')).toBe('https://abbeygate-pt.facio.io');
    });

    it('falls back to the default for empty input', () => {
      expect(normalizePublicAppBaseUrl('')).toBe('http://localhost:5173');
    });
  });

  describe('buildPublicDashboardUrl / buildPublicQuoteUrl', () => {
    it('builds dashboard link through the canonical verified-email access flow', () => {
      const url = buildPublicDashboardUrl('http://localhost:3000', 'customer+test@example.com');
      expect(url).toBe('http://localhost:5173/verify-email?email=customer%2Btest%40example.com&redirect=%2Fclient');
    });

    it('refuses to build an un-linkable dashboard route without a customer email', () => {
      expect(() => buildPublicDashboardUrl('https://pt.abbeygate.com', '   '))
        .toThrow('Customer email is required for a dashboard link');
    });

    it('builds a public quote URL embedding token + step', () => {
      const url = buildPublicQuoteUrl('https://abbeygate-pt.facio.io', 't-1', { step: 'payment' });
      expect(url).toBe('https://abbeygate-pt.facio.io/quote/t-1?step=payment');
    });

    it('builds a travel quote URL with the product-owned options step (ABY-516)', () => {
      const url = buildPublicQuoteUrl('https://cy.abbeygate.com', 'tok-abc', { productType: 'TRAVEL', step: 'options' });
      expect(url).toBe('https://cy.abbeygate.com/quote/tok-abc?product=travel&step=options');
    });

    it('defaults quote links to your-quote when the product supplies no step', () => {
      const url = buildPublicQuoteUrl('https://cy.abbeygate.com', 'tok-abc', { productType: 'TRAVEL' });
      expect(url).toBe('https://cy.abbeygate.com/quote/tok-abc?product=travel&step=your-quote');
    });

    it('builds an encoded BO policy link with an optional tab hash', () => {
      expect(
        buildBackOfficePolicyUrl('https://cy.abbeygate.com/', 'policy/id with spaces', { tab: 'Underwriting' }),
      ).toBe('https://cy.abbeygate.com/policies/policy%2Fid%20with%20spaces#underwriting');
    });
  });

  describe('resolvePublicAppBaseUrlFromRequest — precedence', () => {
    it('prefers ALS tenant publicBaseUrl over an env var, an origin header, AND an x-forwarded host', () => {
      // Simulate the production multi-tenant misconfig: env baked at deploy
      // time points at CY, but the request belongs to PT.
      process.env.PUBLIC_APP_BASE_URL = 'https://abbeygate-cy.facio.io';
      const req = {
        headers: {
          origin: 'https://abbeygate-cy.facio.io',
          'x-forwarded-host': 'abbeygate-cy.facio.io',
          'x-forwarded-proto': 'https',
        },
      };

      let resolved = '';
      runWithOperatingTenant(PT, () => {
        resolved = resolvePublicAppBaseUrlFromRequest(req);
      });

      expect(resolved).toBe('https://abbeygate-pt.facio.io');
    });

    itNoTenant('falls back to request origin when no ALS tenant is bound', () => {
      process.env.PUBLIC_APP_BASE_URL = 'https://abbeygate-cy.facio.io';
      const req = {
        headers: { origin: 'https://abbeygate-pt.facio.io' },
      };

      const resolved = resolvePublicAppBaseUrlFromRequest(req);

      expect(resolved).toBe('https://abbeygate-pt.facio.io');
    });

    itNoTenant('synthesises base URL from x-forwarded-{proto,host} when no origin header is present', () => {
      const req = {
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'abbeygate-pt.facio.io',
        },
      };

      const resolved = resolvePublicAppBaseUrlFromRequest(req);

      expect(resolved).toBe('https://abbeygate-pt.facio.io');
    });

    itNoTenant('falls back to env var only when neither ALS nor request data is present', () => {
      process.env.PUBLIC_APP_BASE_URL = 'https://abbeygate-cy.facio.io';

      const resolved = resolvePublicAppBaseUrlFromRequest({ headers: {} });

      expect(resolved).toBe('https://abbeygate-cy.facio.io');
    });

    itNoTenant('falls back to localhost when no source provides a value', () => {
      const resolved = resolvePublicAppBaseUrlFromRequest({ headers: {} });
      expect(resolved).toBe('http://localhost:5173');
    });

    itNoTenant('survives a request mock missing the entire `headers` object (defensive against partial mocks)', () => {
      const partialReq: Parameters<typeof resolvePublicAppBaseUrlFromRequest>[0] = {};
      const resolved = resolvePublicAppBaseUrlFromRequest(partialReq);
      expect(resolved).toBe('http://localhost:5173');
    });
  });

  describe('resolvePublicAppBaseUrlFromContext — precedence', () => {
    it('prefers ALS tenant publicBaseUrl over caller-supplied origin and host', () => {
      process.env.PUBLIC_APP_BASE_URL = 'https://abbeygate-cy.facio.io';
      let resolved = '';
      runWithOperatingTenant(PT, () => {
        resolved = resolvePublicAppBaseUrlFromContext({
          origin: 'https://abbeygate-cy.facio.io',
          host: 'abbeygate-cy.facio.io',
          protocol: 'https',
        });
      });
      expect(resolved).toBe('https://abbeygate-pt.facio.io');
    });

    itNoTenant('uses caller-supplied origin when no ALS tenant is bound', () => {
      process.env.PUBLIC_APP_BASE_URL = 'https://abbeygate-cy.facio.io';
      const resolved = resolvePublicAppBaseUrlFromContext({
        origin: 'https://abbeygate-pt.facio.io',
      });
      expect(resolved).toBe('https://abbeygate-pt.facio.io');
    });

    itNoTenant('synthesises from caller-supplied protocol+host when no origin is given', () => {
      const resolved = resolvePublicAppBaseUrlFromContext({
        protocol: 'https',
        host: 'abbeygate-pt.facio.io',
      });
      expect(resolved).toBe('https://abbeygate-pt.facio.io');
    });

    itNoTenant('falls back to env var only when both ALS and caller args are empty', () => {
      process.env.PUBLIC_APP_BASE_URL = 'https://abbeygate-cy.facio.io';
      expect(resolvePublicAppBaseUrlFromContext({})).toBe('https://abbeygate-cy.facio.io');
    });
  });

  describe('resolvePublicAppBaseUrlFromTenant — worker / non-HTTP entry point', () => {
    it('returns the ALS tenant publicBaseUrl when bound', () => {
      let resolved = '';
      runWithOperatingTenant(PT, () => {
        resolved = resolvePublicAppBaseUrlFromTenant();
      });
      expect(resolved).toBe('https://abbeygate-pt.facio.io');
    });

    itNoTenant('returns the env var when no tenant is bound (single-tenant deploy)', () => {
      process.env.PUBLIC_APP_BASE_URL = 'https://abbeygate-cy.facio.io';
      expect(resolvePublicAppBaseUrlFromTenant()).toBe('https://abbeygate-cy.facio.io');
    });

    itNoTenant('returns the localhost default outside ALS and without env', () => {
      expect(resolvePublicAppBaseUrlFromTenant()).toBe('http://localhost:5173');
    });

    it('switches per nested ALS scope (PT-inside-CY)', () => {
      let outer = '';
      let inner = '';
      runWithOperatingTenant(CY, () => {
        outer = resolvePublicAppBaseUrlFromTenant();
        runWithOperatingTenant(PT, () => {
          inner = resolvePublicAppBaseUrlFromTenant();
        });
      });
      expect(outer).toBe('https://abbeygate-cy.facio.io');
      expect(inner).toBe('https://abbeygate-pt.facio.io');
    });

    it('per-tenant scopes do NOT leak between sibling async tasks', async () => {
      const ptResultPromise = new Promise<string>((resolve) => {
        runWithOperatingTenant(PT, () => {
          // Simulate any async hop that real handlers do.
          setTimeout(() => resolve(resolvePublicAppBaseUrlFromTenant()), 10);
        });
      });
      const cyResultPromise = new Promise<string>((resolve) => {
        runWithOperatingTenant(CY, () => {
          setTimeout(() => resolve(resolvePublicAppBaseUrlFromTenant()), 10);
        });
      });
      const [pt, cy] = await Promise.all([ptResultPromise, cyResultPromise]);
      expect(pt).toBe('https://abbeygate-pt.facio.io');
      expect(cy).toBe('https://abbeygate-cy.facio.io');
    });
  });
});
