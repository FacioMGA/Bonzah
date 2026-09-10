/**
 * Access Control API Client
 *
 * All calls to /api/access-control/* go through here.
 * CHAMPS: surfaces and views import this, never call http.request directly.
 *
 * Note on transport types: `http.request<T>()` returns `ApiResponse<T>` whose
 * runtime shape is the entire JSON payload when it carries a `success` field
 * (see `httpTransport.ts::isApiResponse`). Access-control endpoints return
 * flat shapes like `{ success, users }` rather than the canonical
 * `{ success, data }` envelope, so `req<T>` constrains `T` to share that
 * `success: boolean` discriminator and forwards the whole response. The
 * structural overlap on `success` is what lets TypeScript bridge
 * `ApiResponse<unknown>` and `T` with a single direct cast instead of the
 * double-laundered chain through `unknown` that the diff guard flags.
 */
import { http } from '@/src/shared/api/http';
import type {
  UserRecord,
  UserDetail,
  AccessRole,
  Permission,
  AuditEntry,
} from '../model/types';

type PaginatedResult<T> = {
  success: boolean;
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

async function req<T extends { success: boolean }>(path: string, init?: RequestInit): Promise<T> {
  const result = await http.request<unknown>(path, init);
  return result as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function normalizePaginatedResult<T>(payload: unknown): PaginatedResult<T> {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const items = asArray<T>(root.items).length > 0
    ? asArray<T>(root.items)
    : asArray<T>(data.items).length > 0
      ? asArray<T>(data.items)
      : asArray<T>(root.data);
  return {
    success: root.success !== false,
    items,
    nextCursor: typeof root.nextCursor === 'string'
      ? root.nextCursor
      : typeof data.nextCursor === 'string'
        ? data.nextCursor
        : null,
    hasMore: typeof root.hasMore === 'boolean'
      ? root.hasMore
      : typeof data.hasMore === 'boolean'
        ? data.hasMore
        : false,
  };
}

function normalizeEntityResult<T>(payload: unknown, keys: string[]): T | null {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  for (const key of keys) {
    if (root[key] && typeof root[key] === 'object') return root[key] as T;
    if (data[key] && typeof data[key] === 'object') return data[key] as T;
  }
  if (root.data && typeof root.data === 'object') return root.data as T;
  return null;
}

function normalizeCollectionResult<T>(payload: unknown, keys: string[]): T[] {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  for (const key of keys) {
    if (Array.isArray(root[key])) return root[key] as T[];
    if (Array.isArray(data[key])) return data[key] as T[];
  }
  if (Array.isArray(root.items)) return root.items as T[];
  if (Array.isArray(data.items)) return data.items as T[];
  if (Array.isArray(root.data)) return root.data as T[];
  return [];
}

export const accessControlApiClient = {
  // ── Users ─────────────────────────────────────────────────────────────────

  async listUsers(params: {
    search?: string;
    status?: string;
    role?: string;
    userType?: string;
    mfaEnabled?: boolean;
    cursor?: string;
    limit?: number;
  } = {}): Promise<PaginatedResult<UserRecord>> {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.status) q.set('status', params.status);
    if (params.role) q.set('role', params.role);
    if (params.userType) q.set('userType', params.userType);
    if (params.mfaEnabled !== undefined) q.set('mfaEnabled', String(params.mfaEnabled));
    if (params.cursor) q.set('cursor', params.cursor);
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    const primary = await req<{ success: boolean }>(`access-control/users${qs ? `?${qs}` : ''}`);
    return normalizePaginatedResult<UserRecord>(primary);
  },

  async getUser(id: string): Promise<{ success: boolean; user: UserDetail }> {
    const payload = await req<{ success: boolean }>(`access-control/users/${id}`);
    const user = normalizeEntityResult<UserDetail>(payload, ['user']);
    return { success: true, user: user as UserDetail };
  },

  async inviteUser(data: {
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    role?: string;
    userType?: string;
    assignmentRoleIds?: string[];
    note?: string;
  }) {
    return req<{ success: boolean }>('access-control/users/invite', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateUser(id: string, data: { firstName?: string; lastName?: string; phone?: string; role?: string; userType?: string }) {
    return req<{ success: boolean }>(`access-control/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async updateUserStatus(id: string, isActive: boolean, reason?: string) {
    return req<{ success: boolean }>(`access-control/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive, reason }),
    });
  },

  async revokeUserSessions(id: string) {
    return req<{ success: boolean }>(`access-control/users/${id}/revoke-sessions`, { method: 'POST' });
  },

  async resetUserPassword(id: string) {
    return req<{ success: boolean }>(`access-control/users/${id}/reset-password`, { method: 'POST' });
  },

  async createAssignment(userId: string, data: {
    roleId: string;
    scopeType?: string;
    scopeValue?: string;
    expiresAt?: string;
  }) {
    return req<{ success: boolean }>(`access-control/users/${userId}/assignments`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteAssignment(userId: string, assignmentId: string) {
    return req<{ success: boolean }>(`access-control/users/${userId}/assignments/${assignmentId}`, { method: 'DELETE' });
  },

  // ── Roles ─────────────────────────────────────────────────────────────────

  async listRoles(): Promise<{ success: boolean; roles: AccessRole[] }> {
    const payload = await req<{ success: boolean }>('access-control/roles');
    return {
      success: true,
      roles: normalizeCollectionResult<AccessRole>(payload, ['roles']),
    };
  },

  async getRole(id: string): Promise<{ success: boolean; role: AccessRole }> {
    const payload = await req<{ success: boolean }>(`access-control/roles/${id}`);
    const role = normalizeEntityResult<AccessRole>(payload, ['role']);
    return { success: true, role: role as AccessRole };
  },

  async createRole(data: { name: string; description?: string; permissionIds?: string[] }) {
    return req<{ success: boolean }>('access-control/roles', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateRole(id: string, data: { name?: string; description?: string; permissionIds?: string[] }) {
    return req<{ success: boolean }>(`access-control/roles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async duplicateRole(id: string, name: string) {
    return req<{ success: boolean }>(`access-control/roles/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  async archiveRole(id: string) {
    return req<{ success: boolean }>(`access-control/roles/${id}`, { method: 'DELETE' });
  },

  // ── Permissions ──────────────────────────────────────────────────────────

  async listPermissions(): Promise<{ success: boolean; permissions: Permission[] }> {
    return req<{ success: boolean; permissions: Permission[] }>('access-control/permissions');
  },

  // ── Audit ────────────────────────────────────────────────────────────────

  async queryAuditFeed(params: {
    userId?: string;
    actorId?: string;
    action?: string;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
  } = {}): Promise<PaginatedResult<AuditEntry>> {
    const q = new URLSearchParams();
    if (params.userId) q.set('userId', params.userId);
    if (params.actorId) q.set('actorId', params.actorId);
    if (params.action) q.set('action', params.action);
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.cursor) q.set('cursor', params.cursor);
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    const payload = await req<{ success: boolean }>(`access-control/audit${qs ? `?${qs}` : ''}`);
    return normalizePaginatedResult<AuditEntry>(payload);
  },
};
