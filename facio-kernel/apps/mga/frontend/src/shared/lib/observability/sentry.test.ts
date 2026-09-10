// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { operatingTenantTags } from './sentry';
import { clearSelectedTenant, installSelectedTenant } from '../tenant/runtimeProfile';
import { presentationTenant } from '../tenant/testFixture';
afterEach(clearSelectedTenant);
it('labels only exact selected tenants, including two tenants sharing one country', () => {
  expect(operatingTenantTags()).toEqual({});
  installSelectedTenant(presentationTenant('training-alpha'));
  expect(operatingTenantTags()).toEqual({ tenant: 'training-alpha', 'tenant.country': 'CY' });
  installSelectedTenant(presentationTenant('training-beta'));
  expect(operatingTenantTags()).toEqual({ tenant: 'training-beta', 'tenant.country': 'CY' });
});
