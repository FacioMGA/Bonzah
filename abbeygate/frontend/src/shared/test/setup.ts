import { afterEach } from 'vitest';

// Sentinel DATABASE_URL for unit tests. `backend/platform/db/connection.ts`
// throws at module-load time if `DATABASE_URL` is unset (Postgres-only
// guard). Pure unit tests under backend/ that transitively import the
// connection module (e.g. via `programProductRepo.ts`) need a syntactically
// valid URL even though they never open a real connection. Tests that
// genuinely require Postgres set their own real `DATABASE_URL` via env
// (or run under `INTEGRATION_TESTS=true`), in which case this fallback
// is a no-op.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

// ADR-0019: getTenantConfig() is ALS-only in production; outside ALS it
// throws TenantNotResolvedError. Unit tests for pure pricing / document /
// projection code shouldn't have to wrap every call in
// runWithOperatingTenant — so we install a default CY operating tenant
// for the test worker's async stack. Tests that need a different tenant
// nest a `runWithOperatingTenant(otherTenant, ...)`. Tests that need to
// assert the fail-closed path clear the context with
// `withoutOperatingTenantForTest(...)`. Production code paths are
// unaffected because they don't load this setup file.
//
// Only load this when the backend/test path is in scope (Node env) — DOM
// tests don't import the tenancy plumbing so we skip the import there.
if (typeof document === 'undefined') {
  const [{ enterOperatingTenantForTest }, { TENANT_IDS }] = await Promise.all([
    import('../../../../backend/platform/tenant/tenantAls.js'),
    import('../../../../backend/platform/tenant/tenantConfig.js'),
  ]);
  enterOperatingTenantForTest({
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
  });
}

// Only load DOM matchers + cleanup when running in a DOM-like environment.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());
}

