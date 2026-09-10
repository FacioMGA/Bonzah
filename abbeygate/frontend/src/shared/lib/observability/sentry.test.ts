import { afterEach, describe, expect, it, vi } from 'vitest';

import { operatingTenantTags } from './sentry';

function stubHost(hostname: string): void {
  // vi.stubGlobal takes an `unknown` value, so no cast is needed — a minimal
  // stand-in with just the `location.hostname` the helper reads is enough.
  vi.stubGlobal('window', { location: { hostname } });
}

describe('operatingTenantTags', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mirrors the backend tenant + tenant.country tags for each live territory host', () => {
    stubHost('cy.abbeygate.com');
    expect(operatingTenantTags()).toEqual({ tenant: 'abbeygate-cy', 'tenant.country': 'CY' });

    stubHost('pt.abbeygate.com');
    expect(operatingTenantTags()).toEqual({ tenant: 'abbeygate-pt', 'tenant.country': 'PT' });

    stubHost('gr.abbeygate.com');
    expect(operatingTenantTags()).toEqual({ tenant: 'abbeygate-gr', 'tenant.country': 'GR' });
  });

  it('maps staging and legacy facio hosts to the same tenant tags', () => {
    stubHost('cy.staging.abbeygate.com');
    expect(operatingTenantTags()).toEqual({ tenant: 'abbeygate-cy', 'tenant.country': 'CY' });

    stubHost('abbeygate-es.facio.io');
    expect(operatingTenantTags()).toEqual({ tenant: 'abbeygate-es', 'tenant.country': 'ES' });
  });

  it('returns no tags on non-tenant hosts so the widget/tag stays off', () => {
    stubHost('localhost');
    expect(operatingTenantTags()).toEqual({});

    stubHost('preview.vercel.app');
    expect(operatingTenantTags()).toEqual({});
  });
});
