/* @vitest-environment happy-dom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthorizedProductsPanel } from './AuthorizedProductsPanel';

const request = vi.hoisted(() => vi.fn());

vi.mock('@/src/shared/api/http', () => ({
  http: { request },
}));

describe('AuthorizedProductsPanel', () => {
  beforeEach(() => {
    request.mockImplementation(async (endpoint: string, options?: RequestInit) => {
      if (endpoint === 'products') {
        return {
          success: true,
          data: [
            { code: 'HOME', displayName: 'Home Insurance' },
            { code: 'MOTOR', displayName: 'Motor Insurance' },
          ],
        };
      }
      if (endpoint === 'binders/binder-1/authorities' && !options?.method) {
        return { success: true, data: [] };
      }
      if (endpoint === 'binders/binder-1/authorities' && options?.method === 'POST') {
        return { success: true, data: { id: 'authority-1' } };
      }
      throw new Error(`Unexpected request: ${endpoint}`);
    });
  });

  afterEach(() => {
    cleanup();
    request.mockReset();
  });

  it('selects an active canonical ProductDefinition instead of accepting a typed product code', async () => {
    render(<AuthorizedProductsPanel binderId="binder-1" />);

    fireEvent.click(screen.getByText('Add authority'));

    const product = await screen.findByLabelText('Product definition');
    expect(screen.queryByPlaceholderText('Product (MOTOR)')).toBeNull();
    expect(screen.getByRole('option', { name: 'Home Insurance (HOME)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Motor Insurance (MOTOR)' })).toBeTruthy();

    fireEvent.change(product, { target: { value: 'HOME' } });
    fireEvent.change(screen.getByPlaceholderText('Class of business'), { target: { value: 'HOME' } });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        'binders/binder-1/authorities',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"productCode":"HOME"'),
        }),
      );
    });
  });
});
