import { Role } from '@prisma/client';
import { prisma } from '../../../platform/db/connection.js';
import {
  ADMIN_PERMISSIONS,
  CUSTOMER_PERMISSIONS,
  UNDERWRITER_PERMISSIONS,
} from '../domain/permissionTaxonomy.js';
import { can } from '../domain/permissions.js';
import type { ResolvedPermission } from '../domain/permissions.js';
import { resolveUserPermissions } from '../infra/accessControlRepository.js';

export type { ResolvedPermission } from '../domain/permissions.js';

const SYSTEM_ROLE_NAME_BY_ROLE: Record<Role, string> = {
  ADMIN: 'Administrator',
  UNDERWRITER: 'Technician',
  CUSTOMER: 'Customer',
};

function baselinePermissionKeysForRole(role?: string | null): string[] {
  if (role === 'ADMIN') return Array.from(ADMIN_PERMISSIONS);
  if (role === 'UNDERWRITER') return Array.from(UNDERWRITER_PERMISSIONS);
  if (role === 'CUSTOMER') return Array.from(CUSTOMER_PERMISSIONS);
  return [];
}

export async function resolveEffectivePermissionsForUser(
  userId: string,
  role?: string | null,
): Promise<ResolvedPermission[]> {
  // Global legacy assignments must never expand a selected MGA membership role.
  const assigned = process.env.KERNEL_PLATFORM_MODE === 'true' ? [] : await resolveUserPermissions(userId);
  const merged = new Map<string, ResolvedPermission>();

  for (const permission of assigned) {
    merged.set(permission.key, permission);
  }

  for (const key of baselinePermissionKeysForRole(role)) {
    if (!merged.has(key)) {
      merged.set(key, { key });
    }
  }

  return Array.from(merged.values());
}

export async function resolveEffectivePermissionKeysForUser(
  userId: string,
  role?: string | null,
): Promise<string[]> {
  const permissions = await resolveEffectivePermissionsForUser(userId, role);
  return permissions.map((permission) => permission.key).sort();
}

export function hasEffectivePermission(
  permissions: ResolvedPermission[],
  key: string,
): boolean {
  return can(permissions, key);
}

export async function syncSystemAccessAssignmentsForUser(userId: string, role: Role): Promise<void> {
  const desiredRoleName = SYSTEM_ROLE_NAME_BY_ROLE[role];
  const systemRoles = await prisma.accessRole.findMany({
    where: { type: 'SYSTEM' },
    select: { id: true, name: true },
  });

  const desiredRole = systemRoles.find((candidate) => candidate.name === desiredRoleName);
  if (!desiredRole) return;

  const systemRoleIds = systemRoles.map((candidate) => candidate.id);
  await prisma.accessAssignment.deleteMany({
    where: {
      userId,
      roleId: { in: systemRoleIds },
    },
  });

  await prisma.accessAssignment.create({
    data: {
      userId,
      roleId: desiredRole.id,
      scopeType: 'GLOBAL',
    },
  });
}

export async function syncSystemAccessAssignmentsForAllUsers(): Promise<void> {
  const users = await prisma.user.findMany({
    select: { id: true, role: true },
  });

  for (const user of users) {
    await syncSystemAccessAssignmentsForUser(user.id, user.role);
  }
}

