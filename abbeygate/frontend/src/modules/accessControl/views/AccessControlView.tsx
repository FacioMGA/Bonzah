import React, { useState, useCallback } from 'react';
import type { MouseEvent } from 'react';
import { RecordListView } from '@/src/shared/core/recordList/ui/RecordListView';
import { useRecordListController } from '@/src/shared/core/recordList/useRecordListController';
import type { RecordListAdapter, RecordListConfig, RecordListFetchParams } from '@/src/shared/core/recordList/types';
import { Button } from '@/src/shared/ui';
import type { UserRecord, UserDetail, AuditEntry, AccessRole } from '../model/types';
import { deriveUserStatus } from '../model/types';
import { useStableUserListAdapter } from '../hooks/useUserList';
import { UserCard } from './components/UserCard';
import { UserDrawer } from './components/UserDrawer';
import { InviteUserModal } from './components/InviteUserModal';
import { RoleDrawer } from './components/RoleDrawer';
import { CreateRoleModal } from './components/CreateRoleModal';
import { accessControlApiClient } from '../api/accessControlApiClient';
import { logger } from '@/src/shared/lib/logger';

// ── Avatar helpers ─────────────────────────────────────────────────────────

const AVATAR_COLOURS = [
  'bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-indigo-500', 'bg-teal-500', 'bg-orange-500',
];
function avatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLOURS[Math.abs(hash) % AVATAR_COLOURS.length];
}
function displayName(user: { firstName?: string | null; lastName?: string | null; name?: string | null; email: string }): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return full || user.name || user.email;
}
function initials(user: { firstName?: string | null; lastName?: string | null; name?: string | null; email: string }): string {
  if (user.firstName && user.lastName) return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  const n = user.name || displayName(user);
  const parts = n.trim().split(' ');
  return parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : n.slice(0, 2).toUpperCase();
}

const ROLE_COLOUR: Record<string, string> = {
  ADMIN:       'bg-violet-100 text-violet-700',
  UNDERWRITER: 'bg-sky-100 text-sky-700',
  CUSTOMER:    'bg-teal-100 text-teal-700',
};

const STATUS_TONE = {
  active:    { bg: 'bg-emerald-50', dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Active' },
  suspended: { bg: 'bg-amber-50',   dot: 'bg-amber-500',   text: 'text-amber-700',   label: 'Suspended' },
  pending:   { bg: 'bg-slate-100',  dot: 'bg-slate-400',   text: 'text-slate-500',   label: 'Pending' },
};

// ── Users list config ──────────────────────────────────────────────────────

function buildUsersConfig(onRowClick: (user: UserRecord) => void): RecordListConfig<UserRecord> {
  return {
    id: 'access-control-users',
    entityLabel: 'Users',
    getRowId: (u) => u.id,
    searchPlaceholder: 'Search by name or email…',
    searchHint: 'Manage platform users, roles, and access permissions.',
    filters: [
      {
        id: 'status', label: 'Status', type: 'select',
        options: [
          { value: 'active', label: 'Active' },
          { value: 'suspended', label: 'Suspended' },
          { value: 'pending', label: 'Pending Invite' },
        ],
        placeholder: 'All statuses',
      },
      {
        id: 'role', label: 'Role', type: 'select',
        options: [
          { value: 'ADMIN', label: 'Administrator' },
          { value: 'UNDERWRITER', label: 'Underwriter' },
          { value: 'CUSTOMER', label: 'Customer' },
        ],
        placeholder: 'All roles',
      },
      {
        id: 'userType', label: 'User Type', type: 'select',
        options: [
          { value: 'INTERNAL', label: 'Internal Staff' },
          { value: 'BROKER', label: 'Broker' },
          { value: 'PARTNER', label: 'Partner' },
          { value: 'CUSTOMER', label: 'Customer' },
        ],
        placeholder: 'All types',
      },
    ],
    onRowClick: (user) => onRowClick(user),
    columns: [
      {
        id: 'identity',
        header: 'User',
        widthClass: 'w-[280px]',
        render: (user) => (
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${avatarColor(user.email)} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
              {initials(user)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{displayName(user)}</p>
              <p className="text-xs text-slate-400 truncate">{user.email}</p>
            </div>
          </div>
        ),
      },
      {
        id: 'roles',
        header: 'Role & Access',
        widthClass: 'flex-1',
        render: (user) => (
          <div className="flex flex-wrap gap-1.5">
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${ROLE_COLOUR[user.role] ?? 'bg-slate-100 text-slate-600'}`}>
              {user.role}
            </span>
            {user.accessAssignments.slice(0, 2).map((a) => (
              <span key={a.id} className="text-[10px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                {a.role.name}
              </span>
            ))}
          </div>
        ),
      },
      {
        id: 'userType',
        header: 'Type',
        widthClass: 'w-28',
        render: (user) => <span className="text-xs text-slate-500">{user.userType}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        widthClass: 'w-32',
        render: (user) => {
          const s = deriveUserStatus(user);
          const t = STATUS_TONE[s];
          return (
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${t.bg} ${t.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${t.dot} ${s === 'pending' ? 'animate-pulse' : ''}`} />
              {t.label}
            </span>
          );
        },
      },
      {
        id: 'mfa',
        header: 'MFA',
        widthClass: 'w-14',
        render: (user) => (
          <span title={user.mfaEnabled ? 'MFA enabled' : 'MFA disabled'}>
            <svg className={`w-4 h-4 ${user.mfaEnabled ? 'text-emerald-500' : 'text-slate-200'}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944z" clipRule="evenodd" />
            </svg>
          </span>
        ),
      },
      {
        id: 'lastLogin',
        header: 'Last Login',
        widthClass: 'w-28',
        render: (user) => {
          if (!user.lastLogin) return <span className="text-xs text-slate-400">Never</span>;
          const d = new Date(user.lastLogin);
          const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
          const text = mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
          return <span className="text-xs text-slate-500">{text}</span>;
        },
      },
    ],
    mobileCardSlot: (rows, opts) => (
      <div className="space-y-3">
        {rows.map((user, i) => (
          <UserCard key={user.id} user={user} index={i} onClick={onRowClick} />
        ))}
        {opts.hasMore && (
          <button
            className="w-full py-3 rounded-2xl border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
            onClick={() => void opts.loadMore()}
            disabled={opts.isFetchingMore}
          >
            {opts.isFetchingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    ),
  };
}

// ── Audit Feed ─────────────────────────────────────────────────────────────

function AuditFeedView() {
  const [entries, setEntries] = React.useState<AuditEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [filters, setFilters] = React.useState({
    userId: '',
    actorId: '',
    action: '',
    from: '',
    to: '',
  });

  const load = useCallback(async (reset = false, nextFilters = filters) => {
    setLoading(true);
    try {
      const r = await accessControlApiClient.queryAuditFeed({
        userId: nextFilters.userId || undefined,
        actorId: nextFilters.actorId || undefined,
        action: nextFilters.action || undefined,
        from: nextFilters.from || undefined,
        to: nextFilters.to || undefined,
        cursor: reset ? undefined : cursor ?? undefined,
        limit: 50,
      });
      const items = Array.isArray(r.items) ? r.items : [];
      setEntries((prev) => reset ? items : [...prev, ...items]);
      setCursor(r.nextCursor);
      setHasMore(r.hasMore);
    } finally {
      setLoading(false);
    }
  }, [cursor, filters]);

  React.useEffect(() => { void load(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Audit Log</h2>
        <p className="text-sm text-slate-500 mt-1">Immutable record of access-control events, role changes, and permission administration.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        <input
          type="text"
          value={filters.userId}
          onChange={(event) => setFilters((prev) => ({ ...prev, userId: event.target.value }))}
          placeholder="Target user ID"
          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <input
          type="text"
          value={filters.actorId}
          onChange={(event) => setFilters((prev) => ({ ...prev, actorId: event.target.value }))}
          placeholder="Actor ID"
          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <input
          type="text"
          value={filters.action}
          onChange={(event) => setFilters((prev) => ({ ...prev, action: event.target.value }))}
          placeholder="Action prefix"
          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <input
          type="datetime-local"
          value={filters.from}
          onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <input
          type="datetime-local"
          value={filters.to}
          onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setCursor(null);
            void load(true);
          }}
          className="px-4 py-2.5 rounded-xl bg-brand-primary text-white text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          Apply Filters
        </button>
        <button
          type="button"
          onClick={() => {
            const cleared = { userId: '', actorId: '', action: '', from: '', to: '' };
            setFilters(cleared);
            setCursor(null);
            setEntries([]);
            setHasMore(false);
            void load(true, cleared);
          }}
          className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Clear
        </button>
      </div>
      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <svg className="animate-spin w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200/80 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 w-36">When</th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 w-36">Actor</th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Event</th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 w-40 hidden lg:table-cell">Target</th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 w-44 hidden xl:table-cell">Integrity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => {
                const d = new Date(entry.occurredAt);
                const when = d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                const eventParts = entry.actionName.split('.');
                const domain = eventParts[0];
                const action = eventParts.slice(1).join('.').replace(/_/g, ' ');
                return (
                  <tr key={entry.id} className="hover:bg-slate-50 transition-colors duration-75">
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{when}</td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-semibold text-slate-700 truncate max-w-[120px]">{entry.actorName || entry.actorId}</div>
                      <div className="text-[10px] text-slate-400">{entry.actorType}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase tracking-wide">{domain}</span>
                        <span className="text-xs text-slate-700 capitalize">{action}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="font-mono text-[10px] text-slate-400">{entry.entityId.slice(0, 8)}…</span>
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell">
                      <span className="font-mono text-[10px] text-slate-400">{entry.hash ? `${entry.hash.slice(0, 10)}…` : 'n/a'}</span>
                    </td>
                  </tr>
                );
              })}
              {entries.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">No audit events found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && (
        <div className="flex justify-center">
          <button
            onClick={() => void load(false)}
            disabled={loading}
            className="px-6 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Roles View ─────────────────────────────────────────────────────────────

type RoleData = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  isActive: boolean;
  userCount?: number;
  permissions: { permission: { resource: string; action: string; displayName: string } }[];
};

type RoleListItem = RoleData & {
  permissionCount: number;
  domainCount: number;
};

function mapRoleListItem(role: AccessRole): RoleListItem {
  const permissions = Array.isArray(role.permissions) ? role.permissions : [];
  const domains = new Set(permissions.map((entry) => String(entry?.permission?.resource || '').trim()).filter(Boolean));
  return {
    ...role,
    userCount: role.userCount ?? role._count?.assignments ?? 0,
    permissions,
    permissionCount: permissions.length,
    domainCount: domains.size,
  };
}

function compareString(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function compareNumber(a: number, b: number): number {
  return a - b;
}

function sortRoleItems(items: RoleListItem[], params: RecordListFetchParams): RoleListItem[] {
  const sorts = Array.isArray(params.query.sorts) && params.query.sorts.length > 0
    ? params.query.sorts
    : [{ field: 'name', direction: 'asc' as const }];

  const sorted = [...items];
  sorted.sort((left, right) => {
    for (const rule of sorts) {
      const direction = rule.direction === 'asc' ? 1 : -1;
      let value = 0;
      switch (rule.field) {
        case 'name':
          value = compareString(left.name, right.name);
          break;
        case 'type':
          value = compareString(left.type, right.type);
          break;
        case 'permissionCount':
          value = compareNumber(left.permissionCount, right.permissionCount);
          break;
        case 'userCount':
          value = compareNumber(left.userCount ?? 0, right.userCount ?? 0);
          break;
        case 'domainCount':
          value = compareNumber(left.domainCount, right.domainCount);
          break;
        default:
          value = 0;
      }
      if (value !== 0) {
        return value * direction;
      }
    }
    return compareString(left.name, right.name);
  });
  return sorted;
}

function buildRolesConfig(
  onRowClick: (role: RoleListItem, evt: MouseEvent | null) => void,
): RecordListConfig<RoleListItem> {
  return {
    id: 'access-control-roles',
    entityLabel: 'Roles',
    getRowId: (role) => role.id,
    searchPlaceholder: 'Search by role name or description…',
    searchHint: 'Define access roles and assign granular permissions per domain.',
    filters: [
      {
        id: 'type',
        label: 'Type',
        type: 'select',
        options: [
          { value: 'SYSTEM', label: 'System' },
          { value: 'CUSTOM', label: 'Custom' },
        ],
        placeholder: 'All role types',
      },
      {
        id: 'status',
        label: 'Status',
        type: 'select',
        options: [
          { value: 'active', label: 'Active' },
          { value: 'archived', label: 'Archived' },
        ],
        placeholder: 'All statuses',
      },
    ],
    onRowClick,
    columns: [
      {
        id: 'role',
        header: 'Role',
        widthClass: 'w-[320px]',
        sortable: true,
        sortField: 'name',
        render: (role) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">{role.name}</p>
            <p className="mt-1 line-clamp-2 text-xs text-slate-500">{role.description || 'No description provided.'}</p>
          </div>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        widthClass: 'w-28',
        sortable: true,
        sortField: 'type',
        render: (role) => (
          <span className="text-sm font-semibold text-slate-700">{role.type}</span>
        ),
      },
      {
        id: 'permissions',
        header: 'Permissions',
        widthClass: 'w-36',
        sortable: true,
        sortField: 'permissionCount',
        render: (role) => (
          <span className="text-sm font-semibold text-slate-700">{role.permissionCount}</span>
        ),
      },
      {
        id: 'users',
        header: 'Users',
        widthClass: 'w-28',
        sortable: true,
        sortField: 'userCount',
        render: (role) => (
          <span className="text-sm font-semibold text-slate-700">{role.userCount ?? 0}</span>
        ),
      },
      {
        id: 'domains',
        header: 'Domains',
        widthClass: 'w-28',
        sortable: true,
        sortField: 'domainCount',
        render: (role) => (
          <span className="text-sm font-semibold text-slate-700">{role.domainCount}</span>
        ),
      },
    ],
    mobileCardSlot: (rows) => (
      <div className="space-y-4">
        {rows.map((role) => (
          <div
            key={role.id}
            role="button"
            tabIndex={0}
            onClick={() => onRowClick(role, null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onRowClick(role, null);
              }
            }}
            className="w-full text-left"
          >
            <RoleCard role={role} />
          </div>
        ))}
      </div>
    ),
  };
}

const rolesAdapter: RecordListAdapter<RoleListItem> = {
  capabilities: { serverSort: false },
  async fetchPage(params) {
    const response = await accessControlApiClient.listRoles();
    const search = String(params.query.search || '').trim().toLowerCase();
    const typeFilter = String(params.query.filters.type || '').trim().toUpperCase();
    const statusFilter = String(params.query.filters.status || '').trim().toLowerCase();

    let items = (response.roles || []).map(mapRoleListItem);

    if (search) {
      items = items.filter((role) =>
        role.name.toLowerCase().includes(search) ||
        String(role.description || '').toLowerCase().includes(search),
      );
    }

    if (typeFilter) {
      items = items.filter((role) => String(role.type).toUpperCase() === typeFilter);
    }

    if (statusFilter) {
      items = items.filter((role) => (statusFilter === 'active' ? role.isActive : !role.isActive));
    }

    items = sortRoleItems(items, params);

    const cursorOffset = Number(params.cursor || '0');
    const start = Number.isFinite(cursorOffset) ? cursorOffset : 0;
    const end = start + params.limit;
    const pageItems = items.slice(start, end);

    return {
      items: pageItems,
      nextCursor: end < items.length ? String(end) : null,
      hasMore: end < items.length,
      total: items.length,
    };
  },
};

function RoleCard({ role, loading = false }: { role: RoleData; loading?: boolean }) {
  const [expanded, setExpanded] = React.useState(false);

  // Group permissions by resource domain
  const byDomain = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const { permission: p } of role.permissions) {
      const existing = map.get(p.resource) ?? [];
      map.set(p.resource, [...existing, p.action]);
    }
    return map;
  }, [role.permissions]);

  const domains = Array.from(byDomain.keys());
  const visibleDomains = expanded ? domains : domains.slice(0, 3);
  const hiddenCount = domains.length - 3;

  return (
    <div className="relative bg-white rounded-2xl border border-slate-200/80 shadow-sm transition-all duration-200 p-5 w-full">
      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 bg-white/80 rounded-2xl flex items-center justify-center z-10">
          <svg className="animate-spin w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      )}
      {/* Header */}
      <div>
        <p className="text-sm font-bold text-slate-900">{role.name}</p>
        {role.description && <p className="text-xs text-slate-400 mt-0.5 leading-tight">{role.description}</p>}
      </div>

      {/* Stats */}
      <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
        <span><strong className="text-slate-800 text-sm">{role.permissions.length}</strong> permissions</span>
        <span className="text-slate-300">•</span>
        <span><strong className="text-slate-800 text-sm">{role.userCount ?? 0}</strong> users</span>
        <span className="text-slate-300">•</span>
        <span><strong className="text-slate-800 text-sm">{domains.length}</strong> domains</span>
      </div>

      {/* Permission breakdown by domain */}
      <div className="mt-4 space-y-2">
        {visibleDomains.map((domain) => {
          const actions = byDomain.get(domain) ?? [];
          return (
            <div key={domain} className="flex items-start gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 w-24 flex-shrink-0 pt-0.5">{domain}</span>
              <div className="flex flex-wrap gap-1">
                {actions.map((action) => (
                  <span key={action} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                    {action}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        {!expanded && hiddenCount > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold transition-colors"
          >
            + {hiddenCount} more domain{hiddenCount !== 1 ? 's' : ''}
          </button>
        )}
        {expanded && (
          <button
            onClick={() => setExpanded(false)}
            className="text-xs text-slate-400 hover:text-slate-600 font-semibold transition-colors"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
}

function RolesView({ onMutated }: { onMutated: () => void }) {
  const [selectedRole, setSelectedRole] = React.useState<AccessRole | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const rolesConfig = React.useMemo<RecordListConfig<RoleListItem>>(
    () => buildRolesConfig(async (role) => {
      try {
        const res = await accessControlApiClient.getRole(role.id);
        if (res.success && res.role) setSelectedRole(res.role);
      } catch (err) {
        // Network failure fetching the full role detail. The list row
        // (`RoleListItem`) is structurally incompatible with `AccessRole`
        // (different `permissions` shape, no `createdAt`/`updatedAt`,
        // no `_count`), so we deliberately don't substitute it as a
        // fallback — the previous laundered cast that bridged the list
        // row to AccessRole hid that gap and let `RoleDrawer` read
        // undefined fields. The user can retry; observability captures
        // the failure.
        logger.warn(`Failed to load role detail for ${role.id}`, err);
      }
    }),
    [],
  );
  const rolesController = useRecordListController<RoleListItem>({
    adapter: rolesAdapter,
    config: rolesConfig,
    limit: 12,
  });

  const handleMutated = async () => {
    onMutated();
    await rolesController.invalidate();
  };

  if (selectedRole) {
    return (
      <RoleDrawer
        role={selectedRole}
        onClose={() => setSelectedRole(null)}
        onMutated={handleMutated}
      />
    );
  }

  return (
    <div className="ui-page max-w-none pt-8">
      <RecordListView
        controller={rolesController}
        actions={(
          <Button onClick={() => setCreateOpen(true)} size="lg">
            + New role
          </Button>
        )}
      />

      {/* Create role modal */}
      {createOpen && (
        <CreateRoleModal
          onClose={() => setCreateOpen(false)}
          onSuccess={() => { setCreateOpen(false); handleMutated(); }}
        />
      )}
    </div>
  );
}

// ── RoleCard (extracted to accept loading state) ───────────────────────────
// (Defined below RolesView body but referenced above — moved to top of section)

type Tab = 'users' | 'roles' | 'audit';

type AccessControlViewProps = {
  activeTab?: Tab;
};

export function AccessControlView({ activeTab = 'users' }: AccessControlViewProps) {
  if (activeTab === 'users') {
    return <UsersView />;
  }
  if (activeTab === 'roles') {
    return <RolesView onMutated={() => undefined} />;
  }
  return <AuditFeedView />;
}

function UsersView() {
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [listKey, setListKey] = useState(0);

  const adapter = useStableUserListAdapter();
  const config = React.useMemo(
    () => buildUsersConfig(async (user: UserRecord) => {
      // PR5: do not silently widen the list row to a UserDetail when the
      // detail fetch fails — that produces a drawer with stale/incomplete
      // fields that look authoritative. Surface the error and let the user
      // retry or close the drawer.
      try {
        const res = await accessControlApiClient.getUser(user.id);
        if (res.success && res.user) {
          setSelectedUser(res.user as UserDetail);
          return;
        }
        setSelectedUser(null);
        window.alert('Failed to load user detail. Please try again.');
      } catch (err) {
        setSelectedUser(null);
        window.alert(`Failed to load user detail: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }),
    []
  );
  const controller = useRecordListController({ config, adapter });

  const handleMutate = useCallback(() => {
    setListKey((k) => k + 1);
    setSelectedUser(null);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50/50">
      <div className="px-6 sm:px-10 py-8">
        <RecordListView
          key={listKey}
          controller={controller}
          actions={(
            <Button
              id="invite-user-btn"
              onClick={() => setInviteOpen(true)}
              size="lg"
            >
              + New user
            </Button>
          )}
        />
      </div>

      {/* Drawer */}
      {selectedUser && (
        <UserDrawer
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onMutated={handleMutate}
        />
      )}

      {/* Invite Modal */}
      {inviteOpen && (
        <InviteUserModal
          onClose={() => setInviteOpen(false)}
          onSuccess={() => { setInviteOpen(false); handleMutate(); }}
        />
      )}
    </div>
  );
}
