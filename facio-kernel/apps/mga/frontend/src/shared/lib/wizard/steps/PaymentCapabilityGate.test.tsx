// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PaymentStep } from './PaymentCapabilityGate';
vi.mock('./PaymentStep', () => ({ PaymentStep: () => <p>Provider checkout mounted</p> }));
afterEach(() => vi.unstubAllGlobals());
const props = {
  productCode: 'home',
  publicSessionToken: 'opaque-training-token',
  summary: { amount: 100, currency: 'EUR' },
  onBack: vi.fn(),
  onSubmit: vi.fn(),
};
it('keeps provider checkout unmounted until exact published capability is returned', async () => {
  let complete!: (value: unknown) => void;
  const request = vi.fn().mockReturnValue(new Promise((resolve) => (complete = resolve)));
  vi.stubGlobal('fetch', request);
  render(<PaymentStep {...props} />);
  expect(screen.queryByText('Provider checkout mounted')).toBeNull();
  complete({
    ok: true,
    json: async () => ({ success: true, data: { customer: { payment: false } } }),
  });
  await screen.findByText('Online payment is not enabled');
  expect(screen.queryByText('Provider checkout mounted')).toBeNull();
  expect(request.mock.calls[0][0]).toBe('/api/public/home/session/opaque-training-token/journey');
});
it('fails closed on an unavailable capability endpoint', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: false, json: async () => ({ success: false }) }),
  );
  render(<PaymentStep {...props} />);
  await screen.findByRole('alert');
  expect(screen.queryByText('Provider checkout mounted')).toBeNull();
});
it('does not mount checkout from a stale previous-token response', async () => {
  let first!: (value: unknown) => void;
  const request = vi
    .fn()
    .mockReturnValueOnce(new Promise((resolve) => (first = resolve)))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { customer: { payment: false } } }),
    });
  vi.stubGlobal('fetch', request);
  const { rerender } = render(<PaymentStep {...props} />);
  rerender(<PaymentStep {...props} publicSessionToken="second-token" />);
  await screen.findByText('Online payment is not enabled');
  first({ ok: true, json: async () => ({ success: true, data: { customer: { payment: true } } }) });
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Provider checkout mounted')).toBeNull();
});
it('mounts checkout only for a server-enabled exact programme', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { customer: { payment: true } } }),
      }),
  );
  render(<PaymentStep {...props} />);
  await screen.findByText('Provider checkout mounted');
});
