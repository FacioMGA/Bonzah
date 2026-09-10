// @vitest-environment happy-dom
import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OperatingSurfaceBootstrap } from '../views/OperatingSurfaceBootstrap';
import { platformApi } from '../api/platformClient';
import { clearSelectedTenant, getSelectedTenant } from '@/src/shared/lib/tenant/runtimeProfile';
import { presentationTenant } from '@/src/shared/lib/tenant/testFixture';
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/quote/local?workspace=tenant-alpha');
});
afterEach(() => {
  vi.restoreAllMocks();
  clearSelectedTenant();
});
it('keeps insurance components unmounted until exact selected profile has been verified', async () => {
  localStorage.setItem('platform_token', 'platform');
  localStorage.setItem('active_operating_tenant_id', 'tenant-alpha');
  const tenant = presentationTenant();
  vi.spyOn(platformApi, 'session').mockResolvedValue({
    user: { name: 'Training', role: 'ADMIN' },
    organizations: [],
    tenants: [tenant],
    templates: [],
  });
  let finish!: (value: Awaited<ReturnType<typeof platformApi.select>>) => void;
  vi.spyOn(platformApi, 'select').mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const seen: string[] = [];
  function Journey() {
    seen.push(getSelectedTenant()?.tenantSlug || 'missing');
    return <p>Insurance journey ready</p>;
  }
  render(
    <OperatingSurfaceBootstrap>
      <Journey />
    </OperatingSurfaceBootstrap>,
  );
  await waitFor(() => expect(platformApi.select).toHaveBeenCalledWith('tenant-alpha'));
  expect(seen).toEqual([]);
  finish({
    tenant,
    token: 'scoped',
    user: { name: 'Training', role: 'ADMIN' },
    accountScopeId: 'account-alpha',
  });
  await screen.findByText('Insurance journey ready');
  expect(seen).toEqual(['tenant-alpha']);
});
it('does not switch another tab back to a stale wizard workspace', async () => {
  localStorage.setItem('platform_token', 'platform');
  localStorage.setItem('active_operating_tenant_id', 'tenant-beta');
  vi.spyOn(platformApi, 'session').mockResolvedValue({
    user: { name: 'Training', role: 'ADMIN' },
    organizations: [],
    tenants: [presentationTenant(), presentationTenant('tenant-beta')],
    templates: [],
  });
  const select = vi.spyOn(platformApi, 'select');
  render(
    <OperatingSurfaceBootstrap>
      <p>Wrong journey</p>
    </OperatingSurfaceBootstrap>,
  );
  await screen.findByText(/belongs to a different workspace/);
  expect(select).not.toHaveBeenCalled();
  expect(screen.queryByText('Wrong journey')).not.toBeInTheDocument();
});
it('authorizes a saved ID directly even when it is outside the first directory page', async () => {
  localStorage.setItem('platform_token', 'platform');
  localStorage.setItem('active_operating_tenant_id', 'tenant-alpha');
  vi.spyOn(platformApi, 'session').mockResolvedValue({
    user: { name: 'Training', role: 'ADMIN' },
    organizations: [],
    tenants: [],
    templates: [],
  });
  const select = vi
    .spyOn(platformApi, 'select')
    .mockResolvedValue({
      tenant: presentationTenant(),
      token: 'scoped',
      user: { name: 'Training', role: 'ADMIN' },
      accountScopeId: 'account-alpha',
    });
  render(
    <OperatingSurfaceBootstrap>
      <p>Exact tenant opened</p>
    </OperatingSurfaceBootstrap>,
  );
  await screen.findByText('Exact tenant opened');
  expect(select).toHaveBeenCalledWith('tenant-alpha');
});
