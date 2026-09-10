import { getSelectedTenant } from './runtimeProfile';

/** Forward server-issued scope for an authenticated operating journey. */
export function operatingRequestHeaders(): Record<string, string> {
  const tenant = getSelectedTenant();
  if (!tenant) return {};
  const token = localStorage.getItem('auth_token');
  if (!token) {
    return {
      'X-Tenant-Slug': tenant.tenantSlug,
      'x-tenant-id': tenant.id,
    };
  }
  if (localStorage.getItem('active_operating_tenant_id') !== tenant.id)
    throw new Error('The active workspace changed. Reload before continuing this journey.');
  return {
    Authorization: `Bearer ${token}`,
    'X-Tenant-Slug': tenant.tenantSlug,
    ...(tenant.accountScopeId ? { 'x-tenant-id': tenant.accountScopeId } : {}),
  };
}
