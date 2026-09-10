/**
 * Access Control domain types
 *
 * Mirrors the backend API response shapes.
 * Shared across the accessControl product.
 */

export type UserStatus = 'active' | 'suspended' | 'pending';

export type UserType = 'INTERNAL' | 'BROKER' | 'CUSTOMER' | 'PARTNER';

export type CoarseRole = 'ADMIN' | 'UNDERWRITER' | 'CUSTOMER';

export type AccessRoleType = 'SYSTEM' | 'CUSTOM';

export type ScopeType = 'GLOBAL' | 'PRODUCT' | 'BINDER' | 'OWN_RECORDS';

export type AccessRoleBrief = {
  id: string;
  name: string;
  type: AccessRoleType;
};

export type AccessAssignment = {
  id: string;
  roleId: string;
  scopeType: ScopeType;
  scopeValue: string | null;
  assignedAt: string;
  expiresAt: string | null;
  role: AccessRoleBrief;
};

export type UserRecord = {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  role: CoarseRole;
  userType: UserType;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLogin: string | null;
  createdAt: string;
  inviteToken: string | null;
  inviteExpiresAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  invitedById: string | null;
  accessAssignments: AccessAssignment[];
};

export type UserDetail = UserRecord & {
  updatedAt: string;
  invitedBy: { id: string; name: string | null; firstName: string | null; lastName: string | null; email: string } | null;
};

export type Permission = {
  id: string;
  resource: string;
  action: string;
  displayName: string;
  description: string | null;
  constraints: Record<string, unknown> | null;
};

export type RolePermissionEntry = {
  roleId: string;
  permissionId: string;
  constraints: Record<string, unknown> | null;
  permission: Permission;
};

export type AccessRole = {
  id: string;
  name: string;
  description: string | null;
  type: AccessRoleType;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { assignments: number };
  userCount?: number;
  permissions: RolePermissionEntry[];
  assignments?: Array<{
    id: string;
    userId: string;
    scopeType: ScopeType;
    scopeValue: string | null;
    assignedAt: string;
    user: { id: string; name: string | null; email: string; role: CoarseRole };
  }>;
};

export type AuditEntry = {
  id: string;
  actorType: string;
  actorId: string;
  actorName: string | null;
  actionName: string;
  entityType: string;
  entityId: string;
  diff: Record<string, unknown> | null;
  hash: string | null;
  occurredAt: string;
};

/** Derive a human-readable user status. */
export function deriveUserStatus(user: Pick<UserRecord, 'isActive' | 'inviteToken'>): UserStatus {
  if (!user.isActive && user.inviteToken) return 'pending';
  if (!user.isActive) return 'suspended';
  return 'active';
}
