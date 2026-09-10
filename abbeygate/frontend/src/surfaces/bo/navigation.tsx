import type { AppMode } from '@/src/surfaces/bo/mode';

export type BoNavItem = {
  name: string;
  path: string;
  icon?: string;
  matchPrefix?: string;
};

export type BoNavSection = {
  title: string;
  items: BoNavItem[];
};

export const WORKSPACE_SETTINGS_ENTRY: BoNavItem = {
  name: 'Workspace Settings',
  path: '/configure/users',
  icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
};

export const OPERATE_NAV_ITEMS: BoNavItem[] = [
  { name: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', path: '/' },
  { name: 'Communications', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', path: '/communications', matchPrefix: '/communications' },
  { name: 'Clients', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z', path: '/accounts', matchPrefix: '/accounts' },
  { name: 'Policies', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', path: '/policies' },
  { name: 'Billing', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', path: '/billing' },
  { name: 'Claims', icon: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z', path: '/claims' },
  { name: 'Reporting', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', path: '/reporting' },
  { name: 'Renewals', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', path: '/policies?viewId=renewal_queue', matchPrefix: '/policies?viewId=renewal_queue' },
  { name: 'Staff diary', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', path: '/staff-diary', matchPrefix: '/staff-diary' },
  { name: 'Leave calendar', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', path: '/holiday-chart', matchPrefix: '/holiday-chart' },
];

export const CONFIGURE_NAV_SECTIONS: BoNavSection[] = [
  {
    title: 'Identity & Access',
    items: [
      { name: 'Users', path: '/configure/users', matchPrefix: '/configure/users' },
      { name: 'Roles', path: '/configure/roles', matchPrefix: '/configure/roles' },
      { name: 'Audit', path: '/configure/audit', matchPrefix: '/configure/audit' },
    ],
  },
  {
    title: 'Product Configuration',
    items: [
      { name: 'Binders', path: '/configure/binders', matchPrefix: '/configure/binders' },
      { name: 'Programs', path: '/configure/programs', matchPrefix: '/configure/programs' },
      { name: 'Product Channels', path: '/configure/product-channels', matchPrefix: '/configure/product-channels' },
      { name: 'Financial Rules', path: '/configure/financial-rules', matchPrefix: '/configure/financial-rules' },
      { name: 'Templates', path: '/configure/templates', matchPrefix: '/configure/templates' },
      { name: 'Email Preview', path: '/configure/email-preview', matchPrefix: '/configure/email-preview' },
    ],
  },
  {
    title: 'Organization',
    items: [
      { name: 'Organization', path: '/configure/organization', matchPrefix: '/configure/organization' },
    ],
  },
  {
    title: 'Integrations',
    items: [
      { name: 'Integrations', path: '/configure/integrations', matchPrefix: '/configure/integrations' },
      { name: 'Open API', path: '/configure/api', matchPrefix: '/configure/api' },
      // AI agent surface — Config MCP + Operator MCP (ADR-0036 + ADR-0039).
      // Hosts three tabs: BO architect demo, remote MCP API key
      // management for Claude/ChatGPT/Cursor, and operator-MCP action
      // history.
      { name: 'AI / MCP', path: '/configure/product-architect', matchPrefix: '/configure/product-architect' },
    ],
  },
];

const PAGE_TITLES: Array<{ matchPrefix: string; title: string }> = [
  { matchPrefix: '/configure/users', title: 'Users' },
  { matchPrefix: '/configure/roles', title: 'Roles & Permissions' },
  { matchPrefix: '/configure/audit', title: 'Audit Log' },
  { matchPrefix: '/configure/binders', title: 'Binders' },
  { matchPrefix: '/configure/programs', title: 'Programs' },
  { matchPrefix: '/configure/product-channels', title: 'Product Channels' },
  { matchPrefix: '/configure/financial-rules', title: 'Financial Rules' },
  { matchPrefix: '/configure/templates', title: 'Templates' },
  { matchPrefix: '/configure/email-preview', title: 'Email Preview & Testing Centre' },
  { matchPrefix: '/configure/organization', title: 'Organization Profile' },
  { matchPrefix: '/configure/integrations', title: 'Integrations' },
  { matchPrefix: '/configure/api', title: 'Open API' },
  { matchPrefix: '/configure/product-architect', title: 'AI / MCP' },
  { matchPrefix: '/communications', title: 'Communications' },
  { matchPrefix: '/messenger', title: 'Communications' },
  { matchPrefix: '/change-password', title: 'Change Password' },
  { matchPrefix: '/personnel-file', title: 'Personnel File' },
  { matchPrefix: '/archive-messages', title: 'Archive Messages' },
  { matchPrefix: '/products', title: 'Products' },
  { matchPrefix: '/processes', title: 'Processes' },
  { matchPrefix: '/allocator', title: 'Allocator' },
  { matchPrefix: '/staff-files', title: 'View Staff File' },
  { matchPrefix: '/holiday-chart', title: 'Holiday Chart' },
  { matchPrefix: '/staff-diary', title: 'View Another Diary' },
  { matchPrefix: '/payslips', title: 'Upload Payslips' },
  { matchPrefix: '/policies', title: 'Policies' },
  { matchPrefix: '/accounts', title: 'Clients' },
  { matchPrefix: '/billing', title: 'Billing' },
  { matchPrefix: '/claims', title: 'Claims Desk' },
  { matchPrefix: '/reporting/cash-sheet', title: 'Cash Sheet' },
  { matchPrefix: '/reporting/debtors', title: 'Debtors' },
  { matchPrefix: '/reporting/office-targets', title: 'Office Target' },
  { matchPrefix: '/reporting/origin-conversion', title: 'Origin & Conversion' },
  { matchPrefix: '/reporting/cyprus-demographic', title: 'Cyprus Demographic' },
  { matchPrefix: '/reporting/dno', title: 'DNO Report' },
  { matchPrefix: '/reporting/activity-log', title: 'Activity Log' },
  { matchPrefix: '/reporting/view-tracks', title: 'View Tracks' },
  { matchPrefix: '/reporting', title: 'Reporting' },
];

export function resolveBoPageTitle(pathname: string): string {
  if (pathname === '/') return 'Dashboard';
  const match = PAGE_TITLES.find((item) => pathname.startsWith(item.matchPrefix));
  return match?.title || 'FacioMGA';
}

export function isNavItemActive(pathname: string, item: BoNavItem): boolean {
  if (item.path === '/') return pathname === '/';
  const matchPrefix = item.matchPrefix || item.path;
  return pathname === item.path || pathname.startsWith(`${matchPrefix}/`) || pathname.startsWith(matchPrefix);
}

export function getNavigationForMode(mode: AppMode) {
  return mode === 'configure'
    ? { sections: CONFIGURE_NAV_SECTIONS, items: [] as BoNavItem[] }
    : { sections: [] as BoNavSection[], items: OPERATE_NAV_ITEMS };
}
