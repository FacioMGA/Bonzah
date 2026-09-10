// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSession } from '@/src/modules/auth/useSession';
import { presentationTenant } from '@/src/shared/lib/tenant/testFixture';
import { clearOperatingSession, platformApi, retainSelectedSession, type CreateTenant } from '../api/platformClient';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const input: CreateTenant = {
  organizationId: 'org-training', templateId: 'registered-home', templateVersion: 1,
  templateHash: 'a'.repeat(64), jurisdiction: 'CY', currency: 'EUR',
  tenantSlug: 'training-alpha', displayName: 'Training Alpha', legalName: 'Training Alpha Limited',
  declaredRole: 'MGA', locale: 'en-GB', timeZone: 'UTC', addressLines: ['Synthetic office'],
  contactEmail: 'operator@example.invalid', contactPhone: '+357 20000000', idempotencyKey: crypto.randomUUID(),
};

it('creates, opens, returns to Workspaces in another tab and creates again without revoking organization sign-in', async () => {
  localStorage.setItem('platform_token', 'organization-token');
  const user = { id: 'training-user', name: 'Training', role: 'ADMIN' };
  let revoked = false;
  const revoke = vi.fn(() => { revoked = true; });
  window.addEventListener('facio:platform-logout', revoke);
  const created: string[] = [];
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    const headers = new Headers(options?.headers);
    expect(headers.get('Authorization')).toBe('Bearer organization-token');
    expect(headers.has('X-Tenant-Slug')).toBe(false);
    expect(headers.has('x-tenant-id')).toBe(false);
    if (revoked) return Response.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, { status: 401 });
    const path = String(url);
    let data: unknown;
    if (path.endsWith('/tenants') && options?.method === 'POST') {
      const body = JSON.parse(String(options.body)) as CreateTenant;
      created.push(body.tenantSlug);
      data = { tenant: presentationTenant(body.tenantSlug) };
    } else if (path.endsWith('/select')) {
      data = { token: 'operating-token', user, tenant: presentationTenant('training-alpha'), accountScopeId: 'account-alpha' };
    } else if (path.endsWith('/session')) {
      data = { user, tenants: [presentationTenant('training-alpha')], organizations: [{ id: 'org-training', role: 'OWNER', name: 'Training' }], templates: [] };
    } else if (path.endsWith('/templates')) data = { templates: [{ id: 'registered-home' }] };
    else throw new Error('Unexpected request in workspace transition');
    return Response.json({ success: true, data });
  });
  try {
    const first = await platformApi.create(input);
    retainSelectedSession(await platformApi.select(first.tenant.id));
    const backOffice = renderHook(() => useSession());
    expect(backOffice.result.current.isAuthenticated).toBe(true);
    await platformApi.session();
    act(() => {
      // A different same-origin tab enters /workspaces and clears its operating
      // selection. The browser delivers this storage event to the open BO tab.
      clearOperatingSession();
      window.dispatchEvent(new StorageEvent('storage', { key: 'auth_token', oldValue: 'operating-token', newValue: null }));
    });
    expect(revoke).not.toHaveBeenCalled();
    expect(backOffice.result.current.isAuthenticated).toBe(false);
    expect(backOffice.result.current.user).toBeNull();
    expect(localStorage.getItem('platform_token')).toBe('organization-token');
    await expect(platformApi.templates('org-training')).resolves.toMatchObject({ templates: [{ id: 'registered-home' }] });
    await platformApi.create({ ...input, tenantSlug: 'training-beta', idempotencyKey: crypto.randomUUID() });
    expect(created).toEqual(['training-alpha', 'training-beta']);
    expect(fetch).toHaveBeenCalledTimes(5);
  } finally { window.removeEventListener('facio:platform-logout', revoke); }
});

it('still requests durable organization revocation for an explicit back-office sign-out', () => {
  localStorage.setItem('platform_token', 'organization-token');
  localStorage.setItem('auth_token', 'operating-token');
  const revoke = vi.fn();
  window.addEventListener('facio:platform-logout', revoke);
  try {
    const { result } = renderHook(() => useSession());
    act(() => result.current.handleLogout());
    expect(revoke).toHaveBeenCalledOnce();
  } finally { window.removeEventListener('facio:platform-logout', revoke); }
});
