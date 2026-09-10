/* @vitest-environment happy-dom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Routes, useLocation } from 'react-router-dom';
import { render, screen } from '@testing-library/react';

vi.mock('@/src/surfaces/bo/pages', () => ({
  DashboardPage: () => <div>Dashboard page</div>,
  BillingPage: () => <div>Billing page</div>,
  MessengerPage: () => <div>Messenger page</div>,
  ChangePasswordPage: () => <div>Change password page</div>,
  PersonnelFilePage: () => <div>Personnel file page</div>,
  ClaimsEntryPage: () => <div>Claims entry page</div>,
  ClaimsDeskPage: () => <div>Claims page</div>,
  ReportingPage: () => <div>Reporting page</div>,
  CashSheetPage: () => <div>Cash sheet page</div>,
  DebtorsReportPage: () => <div>Debtors report page</div>,
  OfficeTargetsPage: () => <div>Office targets page</div>,
  OriginConversionPage: () => <div>Origin conversion page</div>,
  CyprusDemographicPage: () => <div>Cyprus demographic page</div>,
  DnoReportPage: () => <div>DNO report page</div>,
  ActivityLogReportPage: () => <div>Activity log page</div>,
  ViewTracksReportPage: () => <div>View tracks page</div>,
  PortfoliosPage: () => <div>Policies page</div>,
  AccountsPage: () => <div>Accounts page</div>,
  FinancialRulesPage: () => <div>Financial rules page</div>,
  BindersListPage: () => <div>Binders list page</div>,
  BinderDetailPage: () => <div>Binder detail page</div>,
  BinderCreatePage: () => <div>Binder create page</div>,
  ProgramsPage: () => <div>Programs page</div>,
  ProductChannelsPage: () => <div>Product channels page</div>,
  SettingsGlobalPage: () => <div>Settings global page</div>,
  TemplatesPage: () => <div>Templates page</div>,
  EmailPreviewPage: () => <div>Email preview page</div>,
  AccessControlPage: ({ activeTab }: { activeTab?: string }) => <div>Access control page ({activeTab})</div>,
  OrganizationProfilePage: () => <div>Organization page</div>,
  IntegrationsPage: () => <div>Integrations page</div>,
  OpenApiPage: () => <div>Open API page</div>,
  ProductArchitectPage: () => <div>Product architect page</div>,
  StaffDiaryPage: () => <div>Staff diary page</div>,
  LeaveCalendarPage: () => <div>Leave calendar page</div>,
}));

import { buildBoSurfaceRouteElements } from './router';

function LocationSpy() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderBoRouter(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationSpy />
      <Routes>
        {buildBoSurfaceRouteElements({
          wrapProtected: (element) => element,
          dashboardProps: {
            user: { id: 'u1', name: 'Taylor', role: 'ADMIN', email: 'taylor@example.com' },
            selectedMonth: '2026-04',
            onMonthChange: vi.fn(),
            isInternalRole: () => true,
          },
        })}
      </Routes>
    </MemoryRouter>,
  );
}

describe('buildBoSurfaceRouteElements', () => {
  it('renders access control only from the configure namespace', () => {
    renderBoRouter('/configure/audit');

    expect(screen.getByTestId('location').textContent).toBe('/configure/audit');
    expect(screen.getByText('Access control page (audit)')).toBeInTheDocument();
  });

  it('does not preserve retired access-control URLs as executable redirects', () => {
    renderBoRouter('/access-control/audit');

    expect(screen.getByTestId('location').textContent).toBe('/access-control/audit');
    expect(screen.queryByText(/Access control page/)).toBeNull();
  });

  it('renders binder detail only from the configure namespace', () => {
    renderBoRouter('/configure/binders/binder-42/edit');

    expect(screen.getByTestId('location').textContent).toBe('/configure/binders/binder-42/edit');
    expect(screen.getByText('Binder create page')).toBeInTheDocument();
  });

  it('does not preserve retired binder URLs as executable redirects', () => {
    renderBoRouter('/binders/binder-42/edit');

    expect(screen.getByTestId('location').textContent).toBe('/binders/binder-42/edit');
    expect(screen.queryByText('Binder create page')).toBeNull();
  });

  it('redirects retired operate utility pages to their canonical homes', async () => {
    renderBoRouter('/allocator');

    expect(await screen.findByText('Policies page')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/policies');
  });

  it('keeps communications as the office-level communications route', () => {
    renderBoRouter('/communications');

    expect(screen.getByTestId('location').textContent).toBe('/communications');
    expect(screen.getByText('Messenger page')).toBeInTheDocument();
  });

  it('opens staff diaries without redirecting to Configure users', () => {
    renderBoRouter('/staff-diary');

    expect(screen.getByTestId('location').textContent).toBe('/staff-diary');
    expect(screen.getByText('Staff diary page')).toBeInTheDocument();
  });

  it('opens the leave calendar for all staff', () => {
    renderBoRouter('/holiday-chart');

    expect(screen.getByTestId('location').textContent).toBe('/holiday-chart');
    expect(screen.getByText('Leave calendar page')).toBeInTheDocument();
  });
});
