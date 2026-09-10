import {
  createAssignment,
  deleteAssignment,
  getAllPermissions,
  getRoleById,
  getUserById,
  listRoles,
  listUsers,
  queryUserAuditFeed,
  type AuditFeedFilters,
  type UserListFilters,
} from '../infra/accessControlRepository.js';

/**
 * Access Control Service
 *
 * Application layer facade for access-control reads and assignment writes.
 * HTTP handlers import this service instead of reaching into infra directly.
 */

export type { UserListFilters, AuditFeedFilters };

export async function listAccessUsers(filters: UserListFilters = {}) {
  return listUsers(filters);
}

export async function getAccessUserById(id: string) {
  return getUserById(id);
}

export async function listAccessRoles() {
  return listRoles();
}

export async function getAccessRoleById(id: string) {
  return getRoleById(id);
}

export async function listAccessPermissions() {
  return getAllPermissions();
}

export async function createAccessAssignment(data: {
  userId: string;
  roleId: string;
  scopeType?: string;
  scopeValue?: string | null;
  assignedById?: string;
  expiresAt?: Date | null;
}) {
  return createAssignment(data);
}

export async function deleteAccessAssignment(id: string) {
  return deleteAssignment(id);
}

export async function queryAccessUserAuditFeed(filters: AuditFeedFilters = {}) {
  return queryUserAuditFeed(filters);
}
