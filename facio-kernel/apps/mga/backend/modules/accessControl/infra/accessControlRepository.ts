import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { ResolvedPermission } from '../domain/permissions.js';

/**
 * Access Control Repository
 *
 * Infrastructure layer — all DB queries for roles, permissions, and assignments.
 * The app layer calls these; domain layer stays pure.
 */

// ──────────────────────────────────────────────────────────────────────────────
// User queries
// ──────────────────────────────────────────────────────────────────────────────

export type UserListFilters = {
  search?: string;
  status?: 'active' | 'suspended' | 'pending';
  role?: string;
  userType?: string;
  mfaEnabled?: boolean;
  cursor?: string;
  limit?: number;
};

export async function listUsers(filters: UserListFilters = {}) {
  const { search, status, role, userType, mfaEnabled, cursor, limit = 50 } = filters;

  const where: Record<string, unknown> = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (status === 'active') where.isActive = true;
  if (status === 'suspended') {
    where.isActive = false;
    where.inviteToken = null;
  }
  if (status === 'pending') {
    where.isActive = false;
    where.NOT = { inviteToken: null };
  }
  if (role) where.role = role;
  if (userType) where.userType = userType;
  if (mfaEnabled !== undefined) where.mfaEnabled = mfaEnabled;

  const users = await prisma.user.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      userType: true,
      isActive: true,
      mfaEnabled: true,
      phone: true,
      lastLogin: true,
      createdAt: true,
      inviteToken: true,
      inviteExpiresAt: true,
      suspendedAt: true,
      suspendedReason: true,
      invitedById: true,
      accessAssignments: {
        include: { role: { select: { id: true, name: true, type: true } } },
      },
    },
  });

  const hasMore = users.length > limit;
  const items = hasMore ? users.slice(0, limit) : users;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor, hasMore };
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      role: true,
      userType: true,
      isActive: true,
      mfaEnabled: true,
      lastLogin: true,
      createdAt: true,
      updatedAt: true,
      inviteToken: true,
      inviteExpiresAt: true,
      suspendedAt: true,
      suspendedReason: true,
      invitedById: true,
      invitedBy: { select: { id: true, name: true, firstName: true, lastName: true, email: true } },
      accessAssignments: {
        include: {
          role: {
            select: { id: true, name: true, type: true, description: true },
          },
        },
      },
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Role queries
// ──────────────────────────────────────────────────────────────────────────────

export async function listRoles() {
  // Count users by their coarse role field for system roles (legacy mapping)
  const [roles, legacyRoleCounts] = await Promise.all([
    prisma.accessRole.findMany({
      where: { isActive: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { assignments: true } },
        permissions: {
          include: { permission: { select: { id: true, resource: true, action: true, displayName: true } } },
        },
      },
    }),
    prisma.user.groupBy({
      by: ['role'],
      _count: { role: true },
    }),
  ]);

  // Map legacy role → count
  const legacyCountMap: Record<string, number> = {};
  for (const row of legacyRoleCounts) {
    legacyCountMap[String(row.role)] = row._count.role;
  }

  // Merge: system roles map to their legacy role enum
  const SYSTEM_ROLE_LEGACY_MAP: Record<string, string> = {
    'Administrator': 'ADMIN',
    'Underwriter': 'UNDERWRITER',
    'Customer': 'CUSTOMER',
  };

  return roles.map(role => ({
    ...role,
    userCount: SYSTEM_ROLE_LEGACY_MAP[role.name]
      ? (legacyCountMap[SYSTEM_ROLE_LEGACY_MAP[role.name]] ?? 0)
      : role._count.assignments,
  }));
}

export async function getRoleById(id: string) {
  return prisma.accessRole.findUnique({
    where: { id },
    include: {
      permissions: {
        include: { permission: true },
      },
      assignments: {
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { assignedAt: 'desc' },
      },
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Permission queries
// ──────────────────────────────────────────────────────────────────────────────

export async function getAllPermissions() {
  return prisma.permission.findMany({ orderBy: [{ resource: 'asc' }, { action: 'asc' }] });
}

export async function resolveUserPermissions(userId: string): Promise<ResolvedPermission[]> {
  const assignments = await prisma.accessAssignment.findMany({
    where: { userId, role: { isActive: true } },
    include: {
      role: {
        include: {
          permissions: { include: { permission: { select: { resource: true, action: true } } } },
        },
      },
    },
  });

  const seen = new Map<string, ResolvedPermission>();
  for (const assignment of assignments) {
    for (const rp of assignment.role.permissions) {
      const key = `${rp.permission.resource}.${rp.permission.action}`;
      if (!seen.has(key)) {
        const constraints = (rp.constraints as Record<string, unknown> | null) ?? undefined;
        seen.set(key, { key, constraints });
      }
    }
  }
  return Array.from(seen.values());
}

// ──────────────────────────────────────────────────────────────────────────────
// Assignment mutations
// ──────────────────────────────────────────────────────────────────────────────

export async function createAssignment(data: {
  userId: string;
  roleId: string;
  scopeType?: string;
  scopeValue?: string | null;
  assignedById?: string;
  expiresAt?: Date | null;
}) {
  return prisma.accessAssignment.create({
    data: {
      userId: data.userId,
      roleId: data.roleId,
      scopeType: (data.scopeType ?? 'GLOBAL') as never,
      scopeValue: data.scopeValue ?? null,
      assignedById: data.assignedById ?? null,
      expiresAt: data.expiresAt ?? null,
    },
  });
}

export async function deleteAssignment(id: string) {
  return prisma.accessAssignment.delete({ where: { id } });
}

// ──────────────────────────────────────────────────────────────────────────────
// Audit queries (reads AuditAction WHERE entityType='USER')
// ──────────────────────────────────────────────────────────────────────────────

export type AuditFeedFilters = {
  targetUserId?: string;
  actorId?: string;
  actionNamePrefix?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
};

export async function queryUserAuditFeed(filters: AuditFeedFilters = {}) {
  const { targetUserId, actorId, actionNamePrefix, from, to, cursor, limit = 50 } = filters;

  const where: Record<string, unknown> = { entityType: 'USER' };
  if (targetUserId) where.entityId = targetUserId;
  if (actorId) where.actorId = actorId;
  if (actionNamePrefix) where.actionName = { startsWith: actionNamePrefix };
  if (from || to) {
    where.occurredAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  const rows = await tenantScopedPrisma.auditAction.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { occurredAt: 'desc' },
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor, hasMore };
}
