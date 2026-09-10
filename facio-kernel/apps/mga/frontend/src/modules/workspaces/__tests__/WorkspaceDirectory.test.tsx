// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspacePicker } from '../views/WorkspacePicker';
import { platformApi, type PlatformSession } from '../api/platformClient';
import { presentationTenant } from '@/src/shared/lib/tenant/testFixture';
const base: PlatformSession = {
  user: { name: 'Training', role: 'ADMIN' },
  organizations: [],
  tenants: [presentationTenant()],
  templates: [],
  tenantNextCursor: 'next-alpha',
};
afterEach(() => vi.restoreAllMocks());
it('loads subsequent authorized tenant pages and resets the cursor for a new search', async () => {
  const page = vi
    .spyOn(platformApi, 'tenants')
    .mockResolvedValueOnce({
      tenants: [{ ...presentationTenant('tenant-beta'), displayName: 'Beta Training' }],
      hasMore: false,
      nextCursor: null,
    })
    .mockResolvedValueOnce({ tenants: [], hasMore: false, nextCursor: null });
  render(
    <WorkspacePicker session={base} onSelect={vi.fn()} onRefresh={vi.fn()} onLogout={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Load more workspaces' }));
  await screen.findByRole('heading', { name: 'Beta Training' });
  expect(page.mock.calls[0][0]).toEqual({ cursor: 'next-alpha' });
  fireEvent.change(screen.getByPlaceholderText('Workspace name or identifier'), {
    target: { value: 'Other' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search workspaces' }));
  await waitFor(() => expect(page).toHaveBeenCalledTimes(2));
  expect(page.mock.calls[1][0]).toEqual({ search: 'Other' });
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Beta Training' })).toBeNull());
});
it('permits organization discovery even when the first page has no creation role', async () => {
  vi.spyOn(platformApi, 'organizations').mockResolvedValue({
    organizations: [{ id: 'later-org', name: 'Later organization', role: 'OWNER' }],
    hasMore: false,
    nextCursor: null,
  });
  render(
    <WorkspacePicker
      session={{ ...base, organizationNextCursor: 'next-org' }}
      onSelect={vi.fn()}
      onRefresh={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: 'Create workspace' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Load more organizations' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeEnabled(),
  );
});
