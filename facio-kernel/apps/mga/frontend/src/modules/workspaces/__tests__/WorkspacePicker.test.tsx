// @vitest-environment happy-dom
import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspacePicker } from '../views/WorkspacePicker';
import {
  platformApi,
  PlatformError,
  retainSelectedSession,
  type PlatformSession,
} from '../api/platformClient';
import { presentationTenant } from '@/src/shared/lib/tenant/testFixture';
const session: PlatformSession = {
  region: 'westeurope',
  user: { name: 'Training operator', role: 'ADMIN' },
  organizations: [{ id: 'org-training', name: 'Training Organization', role: 'OWNER' }],
  tenants: [],
  templates: [
    {
      id: 'registered-home',
      version: 1,
      hash: 'a'.repeat(64),
      name: 'Synthetic Home',
      jurisdiction: 'CY',
      currency: 'EUR',
    },
  ],
};
const profileInputs = {
  displayName: 'Training MGA',
  legalName: 'Training MGA Limited',
  tenantSlug: 'training-mga',
  declaredRole: 'MGA',
  organizationId: 'org-training',
  locale: 'en-GB',
  timeZone: 'Europe/Nicosia',
  addressLines: 'Training office\nNicosia',
  contactEmail: 'operator@training.invalid',
  contactPhone: '+357 20000000',
  primaryColor: '#236789',
  secondaryColor: '#ab5678',
};
async function fill() {
  fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
  fireEvent.change(screen.getByLabelText('Organization'), { target: { value: 'org-training' } });
  await waitFor(() => expect(platformApi.templates).toHaveBeenCalled());
  await screen.findByRole('option', { name: /Synthetic Home/ });
  fireEvent.change(screen.getByLabelText('Registered insurance template'), {
    target: { value: 'registered-home@1' },
  });
  const form = screen.getByRole('form', { name: 'Create MGA workspace' });
  for (const [key, value] of Object.entries({
    ...profileInputs,
    jurisdiction: 'CY',
    currency: 'EUR',
  }))
    if (key !== 'organizationId')
      fireEvent.change(form.querySelector(`[name="${key}"]`)!, { target: { value } });
  return form;
}
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(platformApi, 'templates').mockResolvedValue({ templates: session.templates });
});
afterEach(() => vi.restoreAllMocks());
describe('workspace creation', () => {
  it('submits a complete registered profile and exact template revision then opens the real tenant', async () => {
    const create = vi
      .spyOn(platformApi, 'create')
      .mockResolvedValue({ tenant: presentationTenant() });
    const select = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkspacePicker
        session={session}
        onSelect={select}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onLogout={vi.fn()}
      />,
    );
    fireEvent.submit(await fill());
    await waitFor(() => expect(select).toHaveBeenCalledWith('tenant-alpha'));
    expect(create.mock.calls[0][0]).toMatchObject({
      ...profileInputs,
      addressLines: ['Training office', 'Nicosia'],
      jurisdiction: 'CY',
      currency: 'EUR',
      templateId: 'registered-home',
      templateVersion: 1,
      templateHash: 'a'.repeat(64),
    });
    expect(create.mock.calls[0][0].idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
  });
  it('retries an uncertain create with the unchanged idempotency key and profile', async () => {
    const create = vi
      .spyOn(platformApi, 'create')
      .mockRejectedValueOnce(new PlatformError('Connection interrupted', 502, 'UNCERTAIN'))
      .mockResolvedValueOnce({ tenant: presentationTenant() });
    render(
      <WorkspacePicker
        session={session}
        onSelect={vi.fn().mockResolvedValue(undefined)}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onLogout={vi.fn()}
      />,
    );
    const form = await fill();
    fireEvent.submit(form);
    await screen.findByRole('button', { name: 'Retry unchanged creation' });
    expect(form.querySelector('fieldset')).toBeDisabled();
    fireEvent.submit(form);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0]).toEqual(create.mock.calls[0][0]);
  });
  it('does not recreate when post-create access fails', async () => {
    const create = vi
      .spyOn(platformApi, 'create')
      .mockResolvedValue({ tenant: presentationTenant() });
    const select = vi
      .fn()
      .mockRejectedValueOnce(new Error('Access response lost'))
      .mockResolvedValue(undefined);
    render(
      <WorkspacePicker
        session={session}
        onSelect={select}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onLogout={vi.fn()}
      />,
    );
    const form = await fill();
    fireEvent.submit(form);
    await screen.findByText(/Workspace was created/);
    fireEvent.submit(form);
    await waitFor(() => expect(select).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('has no automatic first-tenant selection and no creation control for viewers', () => {
    const select = vi.fn();
    render(
      <WorkspacePicker
        session={{
          ...session,
          organizations: [{ id: 'org', name: 'Read only', role: 'VIEWER' }],
          tenants: [presentationTenant()],
        }}
        onSelect={select}
        onRefresh={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeDisabled();
    expect(select).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open workspace' })).toBeEnabled();
  });
  it('keeps platform token, operating identity and account identity separate', () => {
    localStorage.setItem('platform_token', 'platform');
    retainSelectedSession({
      token: 'selected',
      user: session.user,
      tenant: presentationTenant(),
      accountScopeId: 'real-account-id',
    });
    expect(localStorage.getItem('platform_token')).toBe('platform');
    expect(localStorage.getItem('auth_token')).toBe('selected');
    expect(localStorage.getItem('active_tenant_id')).toBe('real-account-id');
    expect(localStorage.getItem('active_operating_tenant_id')).toBe('tenant-alpha');
  });
});
