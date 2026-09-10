/* @vitest-environment happy-dom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import GetAutoQuotePage, { __resetMotorQuoteSessionCreateCacheForTests } from './GetAutoQuotePage';

type FetchCall = { input: RequestInfo | URL; init?: RequestInit };

describe('GetAutoQuotePage', () => {
  afterEach(() => {
    __resetMotorQuoteSessionCreateCacheForTests();
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  it('passes a supported vehicleType URL param into motor session creation', async () => {
    window.history.replaceState(null, '', '/quote/motor/new?vehicleType=Motorbike');
    const calls: FetchCall[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({ success: true, data: { publicSessionToken: 'tok_motorbike' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <MemoryRouter initialEntries={['/quote/motor/new?vehicleType=Motorbike']}>
        <Routes>
          <Route path="/quote/motor/new" element={<GetAutoQuotePage />} />
          <Route path="/quote/:token" element={<div>quote page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse(String(calls[0]?.init?.body || '{}'))).toEqual({ vehicleType: 'Motorbike' });
  });

  it.each([
    ['motor', 'Car'],
    ['van', 'Van to 3.5 tons'],
    ['motorcycle', 'Motorbike'],
    ['caravan', 'Motorcaravan'],
  ])('maps vehicle category alias %s into canonical motor session vehicleType %s', async (vehicleTypeParam, expectedVehicleType) => {
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

    render(
      <MemoryRouter initialEntries={[`/quote/motor/new?vehicleType=${vehicleTypeParam}`]}>
        <Routes>
          <Route path="/quote/motor/new" element={<GetAutoQuotePage />} />
          <Route path="/quote/:token" element={<div>quote page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse(String(calls[0]?.init?.body || '{}'))).toEqual({ vehicleType: expectedVehicleType });
  });

  it('does not pass unsupported vehicleType URL params', async () => {
    window.history.replaceState(null, '', '/quote/motor/new?vehicleType=Truck');
    const calls: FetchCall[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({ success: true, data: { publicSessionToken: 'tok_default' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <MemoryRouter initialEntries={['/quote/motor/new?vehicleType=Truck']}>
        <Routes>
          <Route path="/quote/motor/new" element={<GetAutoQuotePage />} />
          <Route path="/quote/:token" element={<div>quote page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse(String(calls[0]?.init?.body || '{}'))).toEqual({});
  });
});
