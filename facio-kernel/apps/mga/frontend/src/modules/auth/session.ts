import type { AppUser } from '@/src/shared/types/session';

export const INTERNAL_ROLES = ['ADMIN', 'UNDERWRITER', 'Program Administrator'] as const;
export type { AppUser };

export function parseUser(value: unknown): AppUser | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name : '';
  const role = typeof record.role === 'string' ? record.role : '';
  if (!name || !role) return null;
  return {
    id: typeof record.id === 'string' ? record.id : undefined,
    name,
    role,
    email: typeof record.email === 'string' ? record.email : undefined,
    primaryAccountId:
      typeof record.primaryAccountId === 'string'
        ? record.primaryAccountId
        : record.primaryAccountId === null
          ? null
          : undefined,
    effectivePermissions: Array.isArray(record.effectivePermissions)
      ? record.effectivePermissions.filter((value): value is string => typeof value === 'string')
      : undefined,
  };
}

export function isInternalRole(role: unknown): boolean {
  return INTERNAL_ROLES.includes(String(role || '') as (typeof INTERNAL_ROLES)[number]);
}

export function hasPermission(user: AppUser | null | undefined, permissionKey: string): boolean {
  return Boolean(user?.effectivePermissions?.includes(permissionKey));
}

export function hasAnyPermission(user: AppUser | null | undefined, permissionKeys: string[]): boolean {
  return permissionKeys.some((permissionKey) => hasPermission(user, permissionKey));
}

export function canAccessControl(user: AppUser | null | undefined): boolean {
  return hasPermission(user, 'settings.configure')
    || hasAnyPermission(user, [
      'users.view',
      'roles.view',
      'audit.view',
    ])
    || user?.role === 'ADMIN'
    || user?.role === 'Program Administrator';
}

export function canAccessConfigureMode(user: AppUser | null | undefined): boolean {
  return hasPermission(user, 'settings.configure')
    || user?.role === 'ADMIN'
    || user?.role === 'Program Administrator';
}
