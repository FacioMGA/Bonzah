// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http } from '@/src/shared/api/http';
import { RegisteredProductGate } from './RegisteredProductGate';
afterEach(() => vi.restoreAllMocks());
it('does not mount a session-creating route for an inactive or unregistered tenant programme', async () => {
  vi.spyOn(http, 'request').mockResolvedValue({
    success: true,
    data: [
      { productType: 'MOTOR', status: 'INACTIVE' },
      { productType: 'HOME', status: 'ACTIVE' },
    ],
  });
  const started = vi.fn();
  function Journey() {
    started();
    return <p>New motor session</p>;
  }
  render(
    <RegisteredProductGate productType="MOTOR">
      <Journey />
    </RegisteredProductGate>,
  );
  await screen.findByText('This product has no active programme in the selected workspace.');
  expect(started).not.toHaveBeenCalled();
});
it('opens only a server-listed active programme', async () => {
  vi.spyOn(http, 'request').mockResolvedValue({
    success: true,
    data: [{ productType: 'HOME', status: 'ACTIVE' }],
  });
  render(
    <RegisteredProductGate productType="HOME">
      <p>Registered Home journey</p>
    </RegisteredProductGate>,
  );
  await screen.findByText('Registered Home journey');
});
