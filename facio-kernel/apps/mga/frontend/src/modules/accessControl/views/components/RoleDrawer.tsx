/**
 * RoleDrawer
 *
 * Full role management panel — slide-in from the right.
 *
 * TABS:
 *   Permissions  — PermissionMatrix (editable for CUSTOM, read-only for SYSTEM)
 *   Members      — Assigned users list + assign/revoke
 *   Settings     — Name, description, duplicate, archive (CUSTOM only)
 *
 * SYSTEM roles: permissions read-only, no archive, no settings edit.
 */
import React from 'react';
import { Button, PageHeader } from '@/src/shared/ui';
import type { AccessRole, UserRecord } from '../../model/types';
import type { PermissionDef } from './PermissionMatrix';
import { PermissionMatrix } from './PermissionMatrix';
import { accessControlApiClient } from '../../api/accessControlApiClient';

interface Props {
  role: AccessRole;
  onClose: () => void;
  onMutated: () => void;
}

type DrawerTab = 'permissions' | 'members' | 'settings';

// ── Members sub-view ─────────────────────────────────────────────────────────

function MembersPanel({ role, onMutated }: { role: AccessRole; onMutated: () => void }) {
  const [users, setUsers] = React.useState<UserRecord[]>([]);
  const [search, setSearch] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<UserRecord[]>([]);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [assigning, setAssigning] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<string | null>(null);

  // Load members from role assignments
  React.useEffect(() => {
    if (role.assignments) {
      // Use existing assignment data if included
      const mapped = role.assignments.map((a) => ({
        id: a.userId,
        name: a.user.name,
        firstName: null,
        lastName: null,
        email: a.user.email,
        role: a.user.role,
        phone: null,
        userType: 'INTERNAL' as const,
        isActive: true,
        mfaEnabled: false,
        lastLogin: null,
        createdAt: a.assignedAt,
        inviteToken: null,
        inviteExpiresAt: null,
        suspendedAt: null,
        suspendedReason: null,
        invitedById: null,
        accessAssignments: [],
      }));
      setUsers(mapped);
    }
  }, [role.assignments]);

  // Typeahead search
  React.useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const r = await accessControlApiClient.listUsers({ search: search.trim(), limit: 8 });
        setSearchResults(r.items);
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const assignUser = async (user: UserRecord) => {
    setAssigning(user.id);
    try {
      await accessControlApiClient.createAssignment(user.id, { roleId: role.id });
      setSearch('');
      setSearchOpen(false);
      onMutated();
    } finally {
      setAssigning(null);
    }
  };

  // We need assignment IDs to revoke — reload role detail
  const revokeUser = async (userId: string) => {
    setRevoking(userId);
    try {
      const assignment = role.assignments?.find((a) => a.userId === userId);
      if (assignment) {
        await accessControlApiClient.deleteAssignment(userId, assignment.id);
        onMutated();
      }
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Assign User */}
      <div className="relative">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search users to assign…"
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-slate-50"
            />
          </div>
        </div>

        {/* Dropdown results */}
        {searchOpen && searchResults.length > 0 && (
          <div className="absolute top-12 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl z-30 overflow-hidden">
            {searchResults.map((u) => (
              <button
                key={u.id}
                onClick={() => assignUser(u)}
                disabled={!!assigning}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-indigo-50 transition-colors text-left border-b border-slate-100 last:border-0"
              >
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600 flex-shrink-0">
                  {(u.firstName?.[0] ?? u.name?.[0] ?? u.email[0]).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || u.email}
                  </p>
                  <p className="text-xs text-slate-400 truncate">{u.email}</p>
                </div>
                {assigning === u.id
                  ? <svg className="w-4 h-4 animate-spin text-indigo-400 ml-auto flex-shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  : <svg className="w-4 h-4 text-indigo-400 ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
                }
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Current members */}
      {users.length === 0 ? (
        <div className="text-center py-8 text-sm text-slate-400">
          <svg className="w-10 h-10 text-slate-200 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
          No explicitly assigned members.<br/>
          <span className="text-xs">Users with this coarse role have access via system role mapping.</span>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3 bg-slate-50 rounded-xl">
              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600 flex-shrink-0">
                {(u.firstName?.[0] ?? u.name?.[0] ?? u.email[0]).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800 truncate">
                  {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || u.email}
                </p>
                <p className="text-xs text-slate-400 truncate">{u.email}</p>
              </div>
              <button
                onClick={() => revokeUser(u.id)}
                disabled={!!revoking}
                className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0"
                title="Revoke assignment"
              >
                {revoking === u.id
                  ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                }
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Settings sub-view ─────────────────────────────────────────────────────────

function SettingsPanel({
  role,
  onClose,
  onMutated,
}: {
  role: AccessRole;
  onClose: () => void;
  onMutated: () => void;
}) {
  const isSystem = role.type === 'SYSTEM';
  const [name, setName] = React.useState(role.name);
  const [description, setDescription] = React.useState(role.description ?? '');
  const [saving, setSaving] = React.useState(false);
  const [duplicating, setDuplicating] = React.useState(false);
  const [archiving, setArchiving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dupName, setDupName] = React.useState(`Copy of ${role.name}`);
  const [dupOpen, setDupOpen] = React.useState(false);

  const save = async () => {
    if (isSystem) return;
    setSaving(true); setError(null);
    try {
      await accessControlApiClient.updateRole(role.id, { name: name.trim(), description: description.trim() });
      onMutated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const duplicate = async () => {
    setDuplicating(true); setError(null);
    try {
      await accessControlApiClient.duplicateRole(role.id, dupName.trim());
      setDupOpen(false);
      onMutated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Duplicate failed');
    } finally { setDuplicating(false); }
  };

  const archive = async () => {
    if (!confirm(`Archive "${role.name}"? This will prevent new assignments.`)) return;
    setArchiving(true); setError(null);
    try {
      await accessControlApiClient.archiveRole(role.id);
      onClose();
      onMutated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archive failed');
    } finally { setArchiving(false); }
  };

  return (
    <div className="space-y-5">
      {isSystem && (
        <div className="flex items-start gap-2.5 px-4 py-3 bg-violet-50 border border-violet-100 rounded-xl">
          <svg className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
          </svg>
          <p className="text-xs text-violet-700">System roles are managed by Facio and cannot be renamed or archived. Use <strong>Duplicate</strong> to create a customisable copy.</p>
        </div>
      )}

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Role Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isSystem}
          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isSystem}
          rows={3}
          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60 disabled:cursor-not-allowed transition-all resize-none"
        />
      </div>

      {error && <div className="text-sm text-red-600 px-4 py-3 bg-red-50 rounded-xl border border-red-100">{error}</div>}

      {/* Action buttons */}
      <div className="flex flex-col gap-2 pt-2">
        {!isSystem && (
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        )}

        {/* Duplicate */}
        {!dupOpen ? (
          <button
            onClick={() => setDupOpen(true)}
            className="w-full py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-semibold rounded-xl transition-colors"
          >
            Duplicate Role
          </button>
        ) : (
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-700">Name for duplicate</p>
            <input
              type="text"
              value={dupName}
              onChange={(e) => setDupName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={duplicate}
                disabled={duplicating || !dupName.trim()}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {duplicating ? 'Duplicating…' : 'Confirm'}
              </button>
              <button onClick={() => setDupOpen(false)} className="px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-xl hover:bg-slate-50 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {!isSystem && (
          <button
            onClick={archive}
            disabled={archiving}
            className="w-full py-2.5 border border-red-200 text-red-500 hover:bg-red-50 text-sm font-semibold rounded-xl transition-colors"
          >
            {archiving ? 'Archiving…' : 'Archive Role'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main RoleDrawer ────────────────────────────────────────────────────────────

export function RoleDrawer({ role, onClose, onMutated }: Props) {
  const [activeTab, setActiveTab] = React.useState<DrawerTab>('permissions');
  const [permissions, setPermissions] = React.useState<PermissionDef[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Controlled permission state (for CUSTOM roles)
  const [enabledIds, setEnabledIds] = React.useState<Set<string>>(() =>
    new Set(role.permissions.map((rp) => rp.permissionId))
  );
  const [constraintValues, setConstraintValues] = React.useState<Record<string, Record<string, unknown>>>({});
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const isSystem = role.type === 'SYSTEM';
  const isDirty = !isSystem && (
    enabledIds.size !== role.permissions.length ||
    role.permissions.some((rp) => !enabledIds.has(rp.permissionId)) ||
    [...enabledIds].some((id) => !role.permissions.find((rp) => rp.permissionId === id))
  );

  // Load full permission catalogue
  React.useEffect(() => {
    accessControlApiClient.listPermissions()
      .then((r) => {
        setPermissions(r.permissions.map((p) => ({
          id: p.id,
          resource: p.resource,
          action: p.action,
          displayName: p.displayName,
          description: p.description ?? '',
          constraints: p.constraints,
        })));
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  const savePermissions = async () => {
    if (isSystem) return;
    setSaving(true); setSaveError(null);
    try {
      await accessControlApiClient.updateRole(role.id, { permissionIds: Array.from(enabledIds) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onMutated();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const tabs: { id: DrawerTab; label: string }[] = [
    { id: 'permissions', label: 'Permissions' },
    { id: 'members', label: 'Members' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-24">
      <PageHeader
        breadcrumb={{
          label: 'Return to list',
          onClick: onClose,
        }}
        title={role.name}
        subtitle={role.description || 'Role permissions, members, and settings.'}
        status={{ label: role.type, tone: isSystem ? 'info' : 'neutral' }}
      />

      <div className="ui-card ui-card-flat bg-brand-canvas overflow-hidden">
        <div className="px-8 bg-brand-canvas">
          <div className="ui-tabsbar">
            {tabs.map((t) => (
              <Button
                key={t.id}
                type="button"
                variant="tab"
                size="tab"
                onClick={() => setActiveTab(t.id)}
                className={`ui-tab ${activeTab === t.id ? 'ui-tab-active' : 'ui-tab-inactive'}`}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="px-8 pt-6 pb-10 bg-brand-canvas min-h-[500px]">
          {activeTab === 'permissions' && (
            loading ? (
              <div className="flex justify-center py-12">
                <svg className="animate-spin w-6 h-6 text-slate-300" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              </div>
            ) : (
              <PermissionMatrix
                permissions={permissions}
                enabledIds={enabledIds}
                readOnly={isSystem}
                onChange={setEnabledIds}
                constraintValues={constraintValues}
                onConstraintChange={(permId, vals) =>
                  setConstraintValues((prev) => ({ ...prev, [permId]: vals }))
                }
              />
            )
          )}
          {activeTab === 'members' && (
            <MembersPanel role={role} onMutated={onMutated} />
          )}
          {activeTab === 'settings' && (
            <SettingsPanel role={role} onClose={onClose} onMutated={onMutated} />
          )}

          {activeTab === 'permissions' && !isSystem && (
            <div className="mt-10 border-t border-slate-100 pt-6">
              {saveError && (
                <p className="mb-3 text-xs text-red-600">{saveError}</p>
              )}
              <div className="flex items-center justify-end gap-3">
                {isDirty && !saving && (
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={() => setEnabledIds(new Set(role.permissions.map((rp) => rp.permissionId)))}
                  >
                    Revert
                  </Button>
                )}
                <Button
                  onClick={savePermissions}
                  disabled={saving || !isDirty}
                  size="lg"
                >
                  {saving ? 'Saving…' : saved ? 'Saved' : isDirty ? 'Save Permission Changes' : 'No changes'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
