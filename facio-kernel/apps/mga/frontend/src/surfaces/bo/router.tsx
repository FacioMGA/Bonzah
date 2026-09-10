import type { AppUser } from '@/src/shared/types/session';
import React from 'react';
import { TenantProfilePage } from '@/src/modules/workspaces';
import { Navigate, Route } from 'react-router-dom';

import {
  AccessControlPage,
  ActivityLogReportPage,
  AccountsPage,
  BinderCreatePage,
  BinderDetailPage,
  BillingPage,
  CashSheetPage,
  ChangePasswordPage,
  BindersListPage,
  ClaimsEntryPage,
  ClaimsDeskPage,
  CyprusDemographicPage,
  DashboardPage,
  DebtorsReportPage,
  DnoReportPage,
  FinancialRulesPage,
  IntegrationsPage,
  MessengerPage,
  OpenApiPage,
  OfficeTargetsPage,
  OrganizationProfilePage,
  OriginConversionPage,
  PersonnelFilePage,
  PortfoliosPage,
  ProductArchitectPage,
  ProgramsPage,
  ReportingPage,
  StaffDiaryPage,
  LeaveCalendarPage,
  SettingsGlobalPage,
  TemplatesPage,
  EmailPreviewPage,
  ViewTracksReportPage,
} from '@/src/surfaces/bo/pages';


type BoSurfaceRoutesProps = {
  wrapProtected: (element: React.ReactElement) => React.ReactElement;
  dashboardProps: {
    user: AppUser | null;
    selectedMonth: string;
    onMonthChange: React.Dispatch<React.SetStateAction<string>>;
    isInternalRole: (role: unknown) => boolean;
  };
};

function DashboardHome({
  user,
  selectedMonth,
  onMonthChange,
  isInternalRole,
}: BoSurfaceRoutesProps['dashboardProps']) {
  const isClientUser = user ? !isInternalRole(user.role) : false;
  if (isClientUser) return <Navigate to="/client" replace />;
  return <DashboardPage month={selectedMonth} user={user} onMonthChange={onMonthChange} />;
}

function renderBoRoutes({ wrapProtected, dashboardProps }: BoSurfaceRoutesProps) {
  return (
    <>
      <Route path="/" element={wrapProtected(<DashboardHome {...dashboardProps} />)} />
      <Route path="/policies" element={wrapProtected(<PortfoliosPage />)} />
      <Route path="/policies/:id" element={wrapProtected(<PortfoliosPage />)} />
      <Route path="/accounts" element={wrapProtected(<AccountsPage />)} />
      <Route path="/accounts/:id" element={wrapProtected(<AccountsPage />)} />
      <Route path="/communications" element={wrapProtected(<MessengerPage />)} />
      <Route path="/messenger" element={<Navigate to="/communications" replace />} />
      <Route path="/change-password" element={wrapProtected(<ChangePasswordPage />)} />
      <Route path="/personnel-file" element={wrapProtected(<PersonnelFilePage />)} />
      <Route path="/archive-messages" element={<Navigate to="/communications" replace />} />
      <Route path="/products" element={<Navigate to="/policies" replace />} />
      <Route path="/processes" element={<Navigate to="/policies?viewId=renewal_queue" replace />} />
      <Route path="/allocator" element={<Navigate to="/policies" replace />} />
      <Route path="/staff-files" element={<Navigate to="/configure/users" replace />} />
      <Route path="/holiday-chart" element={wrapProtected(<LeaveCalendarPage />)} />
      <Route path="/staff-diary" element={wrapProtected(<StaffDiaryPage />)} />
      <Route path="/payslips" element={<Navigate to="/configure/users" replace />} />
      <Route path="/billing" element={wrapProtected(<BillingPage />)} />
      <Route path="/claims" element={wrapProtected(<ClaimsEntryPage />)} />
      <Route path="/claims/desk" element={wrapProtected(<ClaimsDeskPage />)} />
      <Route path="/claims/:id" element={wrapProtected(<ClaimsDeskPage />)} />
      <Route path="/reporting" element={wrapProtected(<ReportingPage />)} />
      <Route path="/reporting/cash-sheet" element={wrapProtected(<CashSheetPage />)} />
      <Route path="/reporting/debtors" element={wrapProtected(<DebtorsReportPage />)} />
      <Route path="/reporting/office-targets" element={wrapProtected(<OfficeTargetsPage />)} />
      <Route path="/reporting/origin-conversion" element={wrapProtected(<OriginConversionPage />)} />
      <Route path="/reporting/cyprus-demographic" element={wrapProtected(<CyprusDemographicPage />)} />
      <Route path="/reporting/dno" element={wrapProtected(<DnoReportPage />)} />
      <Route path="/reporting/activity-log" element={wrapProtected(<ActivityLogReportPage />)} />
      <Route path="/reporting/view-tracks" element={wrapProtected(<ViewTracksReportPage />)} />
      <Route path="/configure/tenant-profile" element={wrapProtected(<TenantProfilePage />)} />
      <Route path="/configure" element={<Navigate to="/configure/users" replace />} />
      <Route path="/configure/users" element={wrapProtected(<AccessControlPage activeTab="users" />)} />
      <Route path="/configure/roles" element={wrapProtected(<AccessControlPage activeTab="roles" />)} />
      <Route path="/configure/audit" element={wrapProtected(<AccessControlPage activeTab="audit" />)} />
      <Route path="/configure/financial-rules" element={wrapProtected(<FinancialRulesPage />)} />
      <Route path="/configure/binders" element={wrapProtected(<BindersListPage />)} />
      <Route path="/configure/binders/new" element={wrapProtected(<BinderCreatePage />)} />
      <Route path="/configure/binders/:id/edit" element={wrapProtected(<BinderCreatePage />)} />
      <Route path="/configure/binders/:id/:tab" element={wrapProtected(<BinderDetailPage />)} />
      <Route path="/configure/binders/:id" element={wrapProtected(<BinderDetailPage />)} />
      <Route path="/configure/programs" element={wrapProtected(<ProgramsPage user={dashboardProps.user} />)} />
      <Route path="/configure/programs/:id" element={wrapProtected(<ProgramsPage user={dashboardProps.user} />)} />
      <Route path="/configure/global-settings" element={wrapProtected(<SettingsGlobalPage />)} />
        <Route path="/configure/templates" element={wrapProtected(<TemplatesPage />)} />
        <Route path="/configure/email-preview" element={wrapProtected(<EmailPreviewPage />)} />
      <Route path="/configure/organization" element={wrapProtected(<OrganizationProfilePage />)} />
      <Route path="/configure/integrations" element={wrapProtected(<IntegrationsPage />)} />
      <Route path="/configure/api" element={wrapProtected(<OpenApiPage />)} />
      <Route path="/configure/product-architect" element={wrapProtected(<ProductArchitectPage />)} />
    </>
  );
}

export function BoSurfaceRoutes(props: BoSurfaceRoutesProps) {
  return renderBoRoutes(props);
}

export function buildBoSurfaceRouteElements(props: BoSurfaceRoutesProps) {
  return renderBoRoutes(props);
}
