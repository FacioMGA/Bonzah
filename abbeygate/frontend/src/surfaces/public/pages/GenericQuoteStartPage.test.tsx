/* @vitest-environment happy-dom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/src/shared/lib/productChannels', () => ({
  useProductChannel: () => ({
    channel: { questions: true, quote: true, payment: true },
    loading: false,
    isAdmin: false,
  }),
}));

import { makeQuoteStartPage } from './GenericQuoteStartPage';

type FetchCall = { input: RequestInfo | URL; init?: RequestInit };

describe('GenericQuoteStartPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  it('passes the immigration health plan URL param into health session creation', async () => {
    window.history.replaceState(null, '', '/quote/health/new?plan=immigration');
    const calls: FetchCall[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({ success: true, data: { publicSessionToken: 'tok_health' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchSpy);
    const HealthStartPage = makeQuoteStartPage('health', 'eligibility');

    render(
      <MemoryRouter initialEntries={['/quote/health/new?plan=immigration']}>
        <Routes>
          <Route path="/quote/health/new" element={<HealthStartPage />} />
          <Route path="/quote/:token" element={<div>quote page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(calls[0]?.input).toBe('/api/public/health/session');
    expect(JSON.parse(String(calls[0]?.init?.body || '{}'))).toEqual({
      quoteData: {
        plan: {
          code: 'immigration',
          label: 'Britt Immigration Health',
        },
      },
    });
  });

  it('does not pass unsupported health plan URL params', async () => {
    window.history.replaceState(null, '', '/quote/health/new?plan=other');
    const calls: FetchCall[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({ success: true, data: { publicSessionToken: 'tok_health_default' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchSpy);
    const HealthStartPage = makeQuoteStartPage('health', 'eligibility');

    render(
      <MemoryRouter initialEntries={['/quote/health/new?plan=other']}>
        <Routes>
          <Route path="/quote/health/new" element={<HealthStartPage />} />
          <Route path="/quote/:token" element={<div>quote page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse(String(calls[0]?.init?.body || '{}'))).toEqual({});
  });

  it.each([
    ['motor', 'Car'],
    ['van', 'Van to 3.5 tons'],
    ['motorcycle', 'Motorbike'],
    ['caravan', 'Motorcaravan'],
  ])('maps motor vehicle category alias %s to canonical seed %s', async (vehicleTypeParam, expectedVehicleType) => {
    window.history.replaceState(null, '', `/quote/motor/new?vehicleType=${vehicleTypeParam}`);
    const calls: FetchCall[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({ success: true, data: { publicSessionToken: `tok_${vehicleTypeParam}` } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchSpy);
    const MotorStartPage = makeQuoteStartPage('motor', 'policy-holder');

    render(
      <MemoryRouter initialEntries={[`/quote/motor/new?vehicleType=${vehicleTypeParam}`]}>
        <Routes>
          <Route path="/quote/motor/new" element={<MotorStartPage />} />
          <Route path="/quote/:token" element={<div>quote page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(calls[0]?.input).toBe('/api/public/motor/session');
    expect(JSON.parse(String(calls[0]?.init?.body || '{}'))).toEqual({ vehicleType: expectedVehicleType });
  });

  it('does not pass unsupported motor vehicleType URL params', async () => {
    window.history.replaceState(null, '', '/quote/motor/new?vehicleType=Truck');
    const calls: FetchCall[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({ success: true, data: { publicSessionToken: 'tok_motor_default' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchSpy);
    const MotorStartPage = makeQuoteStartPage('motor', 'policy-holder');

    render(
      <MemoryRouter initialEntries={['/quote/motor/new?vehicleType=Truck']}>
        <Routes>
          <Route path="/quote/motor/new" element={<MotorStartPage />} />
          <Route path="/quote/:token" element={<div>quote page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse(String(calls[0]?.init?.body || '{}'))).toEqual({});
  });
});
