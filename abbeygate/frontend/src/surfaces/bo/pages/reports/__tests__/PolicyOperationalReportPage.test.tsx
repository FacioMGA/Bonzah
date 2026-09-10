/* @vitest-environment happy-dom */

import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/src/modules/auth/useSession', () => ({
  useSession: () => ({ user: { id: 'user_1', role: 'ADMIN' } }),
}));

vi.mock('@/src/modules/auth/session', () => ({
  hasPermission: () => true,
}));

vi.mock('@/src/surfaces/bo/api/boClient', () => ({
  boClient: {
    getCashSheet: vi.fn(async () => ({
      success: true,
      data: {
        items: [{
          policyId: 'pol_1',
          policyNumber: 'ABV/CY000001',
          insuredName: 'Ada Driver',
          productType: 'MOTOR',
          status: 'ISSUED',
          boStatus: 'ACTIVE',
          date: '2026-07-10T00:00:00.000Z',
          totalPremium: 120.5,
          outstandingBalance: 20.25,
          invoiceOverdue: true,
        }],
        totals: {
          count: 1,
          totalPremium: 120.5,
          outstandingBalance: 20.25,
          invoiceOverdueCount: 1,
        },
      },
    })),
    getDebtorsReport: vi.fn(),
    downloadCashSheetCsv: vi.fn(),
  },
}));

import PolicyOperationalReportPage from '../PolicyOperationalReportPage';

describe('PolicyOperationalReportPage cash sheet (ABY-447)', () => {
  it('makes the policy number a link to the policy workspace', async () => {
    render(
      <MemoryRouter>
        <PolicyOperationalReportPage kind="cash-sheet" />
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: 'Open policy ABV/CY000001' });
    expect(link).toHaveAttribute('href', '/policies/pol_1');
  });

  it('shows normalized in-force status labels from the report API (ABY-459)', async () => {
    render(
      <MemoryRouter>
        <PolicyOperationalReportPage kind="cash-sheet" />
      </MemoryRouter>,
    );

    expect(await screen.findByText('ACTIVE')).toBeInTheDocument();
  });

  it('shows a back button to the reporting hub (ABY-477)', async () => {
    render(
      <MemoryRouter>
        <PolicyOperationalReportPage kind="cash-sheet" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: 'Back to Reporting' })).toBeInTheDocument();
  });

  it('navigates to /reporting when back is clicked (ABY-477)', async () => {
    render(
      <MemoryRouter initialEntries={['/reporting/cash-sheet']}>
        <Routes>
          <Route path="/reporting/cash-sheet" element={<PolicyOperationalReportPage kind="cash-sheet" />} />
          <Route path="/reporting" element={<div>Reporting hub</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Back to Reporting' }));
    expect(screen.getByText('Reporting hub')).toBeInTheDocument();
  });

  it('exposes calendar overlays for start and end filters (ABY-476)', async () => {
    render(
      <MemoryRouter>
        <PolicyOperationalReportPage kind="cash-sheet" />
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText(/open start date picker/i)).toHaveAttribute('data-date-picker-overlay', 'true');
    expect(screen.getByLabelText(/open end date picker/i)).toHaveAttribute('data-date-picker-overlay', 'true');
  });
});
