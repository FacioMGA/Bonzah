import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getOperatingCountryFromHostMock } = vi.hoisted(() => ({
  getOperatingCountryFromHostMock: vi.fn<() => string | null>(),
}));

vi.mock('@/src/shared/lib/tenant/operatingCountry', () => ({
  getOperatingCountryFromHost: getOperatingCountryFromHostMock,
}));

import { ClientQuoteEntryPanel } from './ClientQuoteEntryPanel';

describe('ClientQuoteEntryPanel', () => {
  beforeEach(() => {
    getOperatingCountryFromHostMock.mockReset();
  });

  it('removes both Motor and Motorbike quick starts from the Greece client portal', () => {
    getOperatingCountryFromHostMock.mockReturnValue('GR');
    const html = renderToStaticMarkup(<MemoryRouter><ClientQuoteEntryPanel /></MemoryRouter>);
    expect(html).not.toContain('/quote/motor/new');
    expect(html).not.toContain('Motorbike');
    expect(html).toContain('/quote/home/new');
    expect(html).toContain('/quote/travel/new');
  });

  it('links to the product quote creation flows', () => {
    getOperatingCountryFromHostMock.mockReturnValue('CY');
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ClientQuoteEntryPanel />
      </MemoryRouter>,
    );

    expect(html).toContain('href="/quote/start"');
    expect(html).toContain('href="/quote/motor/new"');
    expect(html).toContain('href="/quote/home/new"');
    expect(html).toContain('href="/quote/travel/new"');
    expect(html).toContain('href="/quote/health/new"');
    expect(html).toContain('href="/quote/business/new"');
    expect(html).toContain('href="/quote/open-market/new"');
  });

  it('does not advertise Cyprus-only Immigration Medical on the Portugal client portal', () => {
    getOperatingCountryFromHostMock.mockReturnValue('PT');
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ClientQuoteEntryPanel />
      </MemoryRouter>,
    );

    expect(html).not.toContain('href="/quote/health/new"');
    expect(html).not.toContain('Cyprus residency');
    expect(html).toContain('href="/quote/motor/new"');
    expect(html).toContain('href="/quote/home/new"');
    expect(html).toContain('href="/quote/travel/new"');
  });
});
