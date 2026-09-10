/* @vitest-environment happy-dom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { makeQuoteStartPage } from './GenericQuoteStartPage';

type FetchCall = { input: RequestInfo | URL; init?: RequestInit };

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function successfulSession(token: string) {
  return new Response(
    JSON.stringify({ success: true, data: { publicSessionToken: token } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('GenericQuoteStartPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  it('passes the immigration health plan URL param into health session creation', async () => {
    window.history.replaceState(null, '', '/quote/health/new?plan=immigration');
    const calls: FetchCall[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return successfulSession('tok_health');
    }));
    const HealthStartPage = makeQuoteStartPage('health', 'eligibility');
    render(<MemoryRouter initialEntries={['/quote/health/new?plan=immigration']}><Routes><Route path="/quote/health/new" element={<HealthStartPage />} /><Route path="/quote/:token" element={<div>quote page</div>} /></Routes></MemoryRouter>);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.input).toBe('/api/public/health/session');
    expect(JSON.parse(String(calls[0]?.init?.body || '{}'))).toEqual({ quoteData: { plan: { code: 'immigration', label: 'Britt Immigration Health' } } });
  });

  it('preserves entry intent through the session redirect', async () => {
    window.history.replaceState(null, '', '/quote/open-market/new?intent=portugal-immigration');
    vi.stubGlobal('fetch', vi.fn(async () => successfulSession('tok_open_market')));
    const OpenMarketStartPage = makeQuoteStartPage('open-market', 'intake');
    render(<MemoryRouter initialEntries={['/quote/open-market/new?intent=portugal-immigration']}><Routes><Route path="/quote/open-market/new" element={<OpenMarketStartPage />} /><Route path="/quote/:token" element={<LocationDisplay />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/quote/tok_open_market?product=open-market&step=intake&intent=portugal-immigration'));
  });

  it.each([
    ['motor', 'Car'],
    ['van', 'Van to 3.5 tons'],
    ['motorcycle', 'Motorbike'],
    ['caravan', 'Motorcaravan'],
  ])('maps motor vehicle category alias %s to canonical seed %s', async (vehicleTypeParam, expectedVehicleType) => {
    window.history.replaceState(null, '', `/quote/motor/new?vehicleType=${vehicleTypeParam}`);
    const calls: FetchCall[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return successfulSession(`tok_${vehicleTypeParam}`);
    }));
    const MotorStartPage = makeQuoteStartPage('motor', 'policy-holder');
    render(<MemoryRouter initialEntries={[`/quote/motor/new?vehicleType=${vehicleTypeParam}`]}><Routes><Route path="/quote/motor/new" element={<MotorStartPage />} /><Route path="/quote/:token" element={<div>quote page</div>} /></Routes></MemoryRouter>);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(String(calls[0]?.init?.body || '{}'))).toEqual({ vehicleType: expectedVehicleType });
  });
});
