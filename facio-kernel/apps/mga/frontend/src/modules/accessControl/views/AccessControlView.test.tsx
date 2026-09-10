/* @vitest-environment happy-dom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/src/shared/core/recordList/ui/RecordListView', () => ({
  RecordListView: () => <div>Users tab content</div>,
}));

vi.mock('@/src/shared/core/recordList/useRecordListController', () => ({
  useRecordListController: () => ({ items: [] }),
}));

vi.mock('../hooks/useUserList', () => ({
  useStableUserListAdapter: () => ({ fetchPage: vi.fn() }),
}));

const accessControlApiClient = vi.hoisted(() => ({
  getUser: vi.fn(),
  listRoles: vi.fn(async () => ({ success: true, roles: [] })),
  getRole: vi.fn(),
  listPermissions: vi.fn(async () => ({ success: true, permissions: [] })),
  queryAuditFeed: vi.fn(async () => ({ success: true, items: [], nextCursor: null, hasMore: false })),
}));

vi.mock('../api/accessControlApiClient', () => ({
  accessControlApiClient,
}));

import { AccessControlView } from './AccessControlView';

describe('AccessControlView', () => {
  it('renders the route-selected section and does not show stale tabs', async () => {
    render(<AccessControlView activeTab="audit" />);

    expect(await screen.findByRole('heading', { name: 'Audit Log' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /roles & permissions/i })).not.toBeInTheDocument();
  });
});
