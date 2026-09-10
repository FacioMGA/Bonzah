import type { AppUser } from '@/src/shared/types/session';
import type { SelectedTenant, TenantProfile } from '@/src/shared/lib/tenant/runtimeProfile';

export type Organization = { id: string; name: string; role: string };
export type TenantTemplate = {
  id: string;
  version: number;
  hash: string;
  name: string;
  countryCode?: string;
  jurisdiction?: string;
  currency: string;
  region?: string;
  limitations?: string[];
};
export type PlatformSession = {
  region?: string;
  tenantNextCursor?: string | null;
  organizationNextCursor?: string | null;
  user: AppUser;
  organizations: Organization[];
  tenants: SelectedTenant[];
  templates: TenantTemplate[];
};
export type SelectedSession = {
  token: string;
  user: AppUser;
  tenant: SelectedTenant;
  accountScopeId: string | null;
};
export type EditableProfile = {
  displayName: string;
  legalName: string;
  declaredRole: 'MGA' | 'BROKER' | 'COVERHOLDER';
  locale: string;
  timeZone: string;
  addressLines: string[];
  contactEmail: string;
  contactPhone: string;
  brandLogos?: { white: string; blue: string };
  primaryColor?: string;
  secondaryColor?: string;
};
export type VersionedProfile = {
  version: number;
  profile: TenantProfile & Partial<EditableProfile>;
};
export type CreateTenant = {
  organizationId: string;
  templateId: string;
  templateVersion: number;
  templateHash: string;
  jurisdiction: string;
  currency: string;
  tenantSlug: string;
  displayName: string;
  contactEmail: string;
  contactPhone: string;
  legalName: string;
  declaredRole: 'MGA' | 'BROKER' | 'COVERHOLDER';
  locale: string;
  timeZone: string;
  addressLines: string[];
  brandLogos?: { white: string; blue: string };
  primaryColor?: string;
  secondaryColor?: string;
  idempotencyKey: string;
};

export class PlatformError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

export async function platformRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const base = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
  const token = localStorage.getItem('platform_token');
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${base}/platform/${path.replace(/^\//, '')}`, {
    ...options,
    headers,
  });
  const body: unknown = await response.json().catch(() => null);
  const object = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  if (!response.ok || object?.success === false) {
    const error =
      object?.error && typeof object.error === 'object'
        ? (object.error as Record<string, unknown>)
        : null;
    throw new PlatformError(
      String(
        error?.message ||
          object?.message ||
          'Workspace request failed. Inspect the retained state before retrying.',
      ),
      response.status,
      String(error?.code || 'PLATFORM_REQUEST_FAILED'),
    );
  }
  if (!object)
    throw new PlatformError('The server returned no workspace data.', 502, 'INVALID_RESPONSE');
  return (object.success === true && object.data !== undefined ? object.data : object) as T;
}

export const platformApi = {
  authConfig: () =>
    platformRequest<{
      providers: Array<{ id: string; label: string }>;
      passwordLoginEnabled: boolean;
    }>('auth/config'),
  authSession: () =>
    platformRequest<{ token: string; user: AppUser }>('auth/session', {
      credentials: 'same-origin',
    }),
  logout: () =>
    platformRequest<{ ok: boolean }>('auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      body: '{}',
    }),
  session: (signal?: AbortSignal) => platformRequest<PlatformSession>('session', { signal }),
  tenants: (input: { cursor?: string; search?: string }, signal?: AbortSignal) =>
    platformRequest<{ tenants: SelectedTenant[]; hasMore: boolean; nextCursor: string | null }>(
      `tenants?${new URLSearchParams({ take: '50', ...input })}`,
      { signal },
    ),
  organizations: (input: { cursor?: string; search?: string }, signal?: AbortSignal) =>
    platformRequest<{ organizations: Organization[]; hasMore: boolean; nextCursor: string | null }>(
      `organizations?${new URLSearchParams({ take: '50', ...input })}`,
      { signal },
    ),
  templates: (organizationId: string, signal?: AbortSignal) =>
    platformRequest<{ templates: TenantTemplate[] }>(
      `organizations/${encodeURIComponent(organizationId)}/templates`,
      { signal },
    ),
  select: (id: string) =>
    platformRequest<SelectedSession>(`tenants/${encodeURIComponent(id)}/select`, {
      method: 'POST',
      body: '{}',
    }),
  create: (input: CreateTenant) =>
    platformRequest<{ tenant: SelectedTenant }>('tenants', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  profile: (id: string, signal?: AbortSignal) =>
    platformRequest<VersionedProfile>(`tenants/${encodeURIComponent(id)}/profile`, { signal }),
  saveProfile: (
    id: string,
    input: { expectedVersion: number; profile: EditableProfile; idempotencyKey: string },
  ) =>
    platformRequest<VersionedProfile>(`tenants/${encodeURIComponent(id)}/profile`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};

export function clearOperatingSession(): void {
  [
    'auth_token',
    'user_info',
    'active_tenant_id',
    'active_operating_tenant_id',
    'active_operating_tenant_slug',
    'facio.session.lastActivityAt',
  ].forEach((key) => localStorage.removeItem(key));
}

export function retainSelectedSession(result: SelectedSession): void {
  if (!result.token || !result.user?.name || !result.tenant?.id || !result.tenant.tenantSlug) {
    throw new PlatformError(
      'The server did not issue a valid selected-tenant session.',
      502,
      'INVALID_SELECTION',
    );
  }
  localStorage.setItem('auth_token', result.token);
  localStorage.setItem('user_info', JSON.stringify(result.user));
  if (result.accountScopeId) localStorage.setItem('active_tenant_id', result.accountScopeId);
  else localStorage.removeItem('active_tenant_id');
  localStorage.setItem('active_operating_tenant_id', result.tenant.id);
  localStorage.setItem('active_operating_tenant_slug', result.tenant.tenantSlug);
  localStorage.setItem('facio.session.lastActivityAt', String(Date.now()));
}
