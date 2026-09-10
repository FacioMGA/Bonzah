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

  it('edits canonical authority limits, dates, scope, and notes through the existing PATCH route', async () => {
    request.mockImplementation(async (endpoint: string, options?: RequestInit) => {
      if (endpoint === 'products') {
        return { success: true, data: [{ code: 'HOME', displayName: 'Home Insurance' }] };
      }
      if (endpoint === 'binders/binder-1/authorities' && !options?.method) {
        return {
          success: true,
          data: [{
            id: 'authority-1',
            binderId: 'binder-1',
            productCode: 'HOME',
            classOfBusiness: 'PROPERTY',
            riskCode: 'HOME',
            territorialScope: ['CY'],
            maxPremiumAnnual: '1200',
            maxPolicyPeriodDays: 365,
            maxAdvanceInceptionDays: 30,
            authorityClasses: ['STANDARD'],
            status: 'ACTIVE',
            effectiveFrom: '2026-01-01T00:00:00.000Z',
            effectiveTo: '2026-12-31T00:00:00.000Z',
            notes: 'Original authority',
          }],
        };
      }
      if (endpoint === 'binders/binder-1/authorities/HOME' && options?.method === 'PATCH') {
        return { success: true, data: { id: 'authority-1' } };
      }
      throw new Error(`Unexpected request: ${endpoint}`);
    });

    render(<AuthorizedProductsPanel binderId="binder-1" />);

    await screen.findByText('PROPERTY');
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.change(screen.getByLabelText('Annual premium limit'), { target: { value: '1500' } });
    fireEvent.change(screen.getByPlaceholderText('Territory scope (CY, PT)'), { target: { value: 'CY, PT' } });
    fireEvent.change(screen.getByPlaceholderText('Authority notes'), { target: { value: 'Updated authority' } });
    fireEvent.click(screen.getByText('Save authority'));

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        'binders/binder-1/authorities/HOME',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            classOfBusiness: 'PROPERTY',
            riskCode: 'HOME',
            territorialScope: ['CY', 'PT'],
            maxPremiumAnnual: 1500,
            maxPolicyPeriodDays: 365,
            maxAdvanceInceptionDays: 30,
            authorityClasses: ['STANDARD'],
            effectiveFrom: '2026-01-01T00:00:00.000Z',
            effectiveTo: '2026-12-31T00:00:00.000Z',
            notes: 'Updated authority',
          }),
        }),
      );
    });
  });

  it('preserves unchanged authority timestamps and rejects an inverted date range', async () => {
    request.mockImplementation(async (endpoint: string, options?: RequestInit) => {
      if (endpoint === 'products') return { success: true, data: [] };
      if (endpoint === 'binders/binder-1/authorities' && !options?.method) {
        return {
          success: true,
          data: [{
            id: 'authority-1', binderId: 'binder-1', productCode: 'HOME', classOfBusiness: 'PROPERTY',
            territorialScope: ['CY'], authorityClasses: [], status: 'ACTIVE',
            effectiveFrom: '2026-01-01T12:34:56.000Z', effectiveTo: '2026-12-31T23:59:59.000Z', notes: 'Original authority',
          }],
        };
      }
      if (endpoint === 'binders/binder-1/authorities/HOME' && options?.method === 'PATCH') {
        return { success: true, data: { id: 'authority-1' } };
      }
      throw new Error(`Unexpected request: ${endpoint}`);
    });

    render(<AuthorizedProductsPanel binderId="binder-1" />);
    await screen.findByText('PROPERTY');
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.change(screen.getByPlaceholderText('Authority notes'), { target: { value: 'Updated authority' } });
    fireEvent.click(screen.getByText('Save authority'));

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        'binders/binder-1/authorities/HOME',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('2026-01-01T12:34:56.000Z'),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText('Save authority')).toBeNull();
    });

    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByLabelText('Open Effective from picker'));
    fireEvent.click(screen.getByLabelText('Next year'));
    fireEvent.click(screen.getByLabelText('Saturday, 2 January 2027'));
    fireEvent.click(screen.getByLabelText('Open Effective to picker'));
    fireEvent.click(screen.getByLabelText('Thursday, 31 December 2026'));
    fireEvent.click(screen.getByText('Save authority'));

    expect(await screen.findByText('Effective from must be on or before effective to.')).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(4);
  });
});
