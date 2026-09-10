/* @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import OfficeTargetsPage from './OfficeTargetsPage';

vi.mock('@/src/surfaces/bo/api/boClient', () => ({
  boClient: {
    getOfficeTargetReport: vi.fn().mockResolvedValue({
      success: true,
      data: {
        filters: {},
        actuals: {
          premium: 900,
          policyCount: 4,
          newBusinessPremium: 500,
          renewalPremium: 400,
          newBusinessPolicyCount: 2,
          renewalPolicyCount: 2,
        },
        groups: [{
          productCode: 'MOTOR',
          periodStart: '2026-08-01T00:00:00.000Z',
          periodEnd: '2026-08-31T00:00:00.000Z',
          categories: [
            { category: 'NEW_BUSINESS', label: 'New Business', premiumTarget: 600, policyCountTarget: 3, premiumActual: 500, policyCountActual: 2, premiumVariance: -100, policyCountVariance: -1 },
            { category: 'RENEWAL', label: 'Renewal', premiumTarget: 400, policyCountTarget: 2, premiumActual: 400, policyCountActual: 2, premiumVariance: 0, policyCountVariance: 0 },
            { category: 'TOTAL', label: 'Total', premiumTarget: 1000, policyCountTarget: 5, premiumActual: 900, policyCountActual: 4, premiumVariance: -100, policyCountVariance: -1 },
          ],
        }],
      },
    }),
    saveOfficeTarget: vi.fn().mockResolvedValue({ success: true, data: { newBusinessId: 'nb', renewalId: 'rnl' } }),
  },
}));

vi.mock('./reports/reportNavigation', () => ({
  useReportingBackBreadcrumb: () => ({ label: 'Reporting', to: '/reporting' }),
}));

describe('OfficeTargetsPage', () => {
  it('renders office new business, renewal, and total rows', async () => {
    render(<OfficeTargetsPage />);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('New Business')).toBeInTheDocument();
    expect(within(table).getByText('Renewal')).toBeInTheDocument();
    expect(within(table).getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Targets are configured at office level. Enter new business and renewal separately; total is the sum of both.')).toBeInTheDocument();
  });

  it('shows total premium actual summary card', async () => {
    render(<OfficeTargetsPage />);
    expect(await screen.findByText('Total premium')).toBeInTheDocument();
    expect(screen.getAllByText('€900.00').length).toBeGreaterThan(0);
  });
});
