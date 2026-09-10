// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { getOperatingCountryFromHost, getOperatingCountryName } from '../tenant/operatingCountry';
import { clearSelectedTenant, installSelectedTenant, safeBrandUrl } from '../tenant/runtimeProfile';
import { presentationTenant } from '../tenant/testFixture';
import { getSupportContact } from '../tenant/supportContact';
import { REGION_CONFIG } from '../../config/region';
afterEach(clearSelectedTenant);
describe('server-selected operating tenant presentation', () => {
  it('never selects customer configuration from a hostname', () => {
    expect(getOperatingCountryFromHost('cy.abbeygate.com')).toBeNull();
    expect(getOperatingCountryName('abbeygate-cy.facio.io')).toBeNull();
    expect(REGION_CONFIG.defaultCountry).toBe('');
    expect(getSupportContact().email).toBe('');
  });
  it('separates two profiles in the same jurisdiction and clears brand defaults', () => {
    installSelectedTenant(presentationTenant());
    expect(REGION_CONFIG.defaultCurrency).toBe('EUR');
    expect(getOperatingCountryFromHost('pt.abbeygate.com')).toBe('CY');
    expect(getSupportContact().email).toBe('tenant-alpha@training.invalid');
    expect(document.documentElement.style.getPropertyValue('--tenant-brand-primary')).toBe(
      '#236789',
    );
    const beta = presentationTenant('tenant-beta', 'Training Beta');
    delete beta.profile.runtimeSettings!.branding.primaryColor;
    installSelectedTenant(beta);
    expect(getSupportContact().email).toBe('tenant-beta@training.invalid');
    expect(document.title).toBe('Training Beta · FacioMGA');
    expect(document.documentElement.style.getPropertyValue('--tenant-brand-primary')).toBe(
      '#334155',
    );
    expect(REGION_CONFIG.defaultNationality).toBe('');
  });
  it('fails closed when selected runtime configuration is incomplete', () => {
    const tenant = presentationTenant();
    tenant.profile.runtimeSettings = null;
    expect(() => installSelectedTenant(tenant)).toThrow('complete operating tenant');
    expect(getOperatingCountryFromHost()).toBeNull();
  });
  it('rejects unsafe brand sources without inheriting a customer logo', () => {
    expect(safeBrandUrl('https://example.invalid/logo.svg')).toBe(
      'https://example.invalid/logo.svg',
    );
    for (const input of [
      'javascript:alert(1)',
      'data:image/svg+xml,x',
      '//example.invalid/a',
      'https://user:secret@example.invalid/a',
      '/\\example.invalid',
    ])
      expect(safeBrandUrl(input)).toBeNull();
  });
});
