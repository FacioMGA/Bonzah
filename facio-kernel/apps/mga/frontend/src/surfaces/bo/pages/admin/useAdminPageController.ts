import { useCallback, useEffect, useMemo, useState } from 'react';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import { logger } from '@/src/shared/lib/logger';
import { ROLE_PRESETS } from './admin.constants';
import type { AuditEntry, EffectiveUser, InviteForm, RolePreset, UserRow } from './admin.types';

function toEffectiveUser(row: UserRow): EffectiveUser {
  return {
    id: String(row.id || ''),
    name: row.name || '-',
    email: row.email || '-',
    role: row.role === 'ADMIN' || row.role === 'CUSTOMER' ? row.role : 'UNDERWRITER',
    team: row.team || (row.role === 'ADMIN' ? 'Admin' : 'Ops'),
    isActive: Boolean(row.isActive),
    status: row.isActive ? 'Active' : 'Disabled',
    lastLogin: row.lastLogin || row.updatedAt || null,
    mfa: row.mfaEnabled ? 'Enabled' : 'Disabled',
    phone: row.phone || '',
  };
}

export function useAdminPageController() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [invite, setInvite] = useState<InviteForm>({ name: '', email: '', role: 'UNDERWRITER', team: 'Ops' });
  const [resettingPasswordId, setResettingPasswordId] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<EffectiveUser | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([
    { at: new Date().toISOString(), actor: 'Admin', action: 'Role preset updated', detail: 'Finance/Reconciliation -> can finalize invoices and export journals.' },
    { at: new Date(Date.now() - 86400000).toISOString(), actor: 'Admin', action: 'User invited', detail: 'Claims Adjuster (claims-only + on-risk verification).' },
  ]);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setLoadingUsers(true);
      const response = await api.listUsers();
      if (response.success) setUsers((response.data || []) as UserRow[]);
    } catch (err) {
      logger.error(err);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const effectiveUsers = useMemo<EffectiveUser[]>(() => {
    return users.map(toEffectiveUser);
  }, [users]);

  const rolePresets: RolePreset[] = ROLE_PRESETS;

  const handleInvite = useCallback(async () => {
    if (!invite.email || !invite.role) {
      window.alert('Email and Role are required');
      return;
    }
    try {
      const res = await api.inviteUser(invite);
      if (res.success) {
        setShowInviteModal(false);
        setAudit((prev) => ([
          { at: new Date().toISOString(), actor: 'Admin', action: 'User invited', detail: `${invite.name} (${invite.role}) • ${invite.email}` },
          ...prev,
        ]));
        void fetchUsers();
        setInvite({ name: '', email: '', role: 'UNDERWRITER', team: 'Ops' });
      } else {
        window.alert(res.error?.message || 'Failed to invite user');
      }
    } catch (e) {
      logger.error(e);
      window.alert('Error inviting user');
    }
  }, [fetchUsers, invite]);

  const handleEditSave = useCallback(async () => {
    if (!editingUser) return;
    try {
      const res = await api.updateUser(editingUser.id, {
        name: editingUser.name,
        email: editingUser.email,
        role: editingUser.role,
        phone: editingUser.phone,
      });
      if (res.success) {
        setShowEditModal(false);
        setEditingUser(null);
        void fetchUsers();
      } else {
        window.alert(res.error?.message || 'Failed to update user');
      }
    } catch (e) {
      logger.error(e);
      window.alert('Error updating user');
    }
  }, [editingUser, fetchUsers]);

  const handleToggleStatus = useCallback(async (user: EffectiveUser) => {
    const newStatus = !user.isActive;
    try {
      const res = await api.updateUserStatus(user.id, newStatus);
      if (res.success) {
        setAudit((prev) => ([
          { at: new Date().toISOString(), actor: 'Admin', action: newStatus ? 'User enabled' : 'User disabled', detail: `${user.name} (${user.email})` },
          ...prev,
        ]));
        void fetchUsers();
      } else {
        window.alert(res.error?.message || 'Failed to update status');
      }
    } catch (e) {
      logger.error(e);
      window.alert('Error updating status');
    }
  }, [fetchUsers]);

  const handleConfirmDeleteUser = useCallback(async () => {
    if (!userToDelete) return;
    try {
      const res = await api.deleteUser(userToDelete);
      if (res.success) {
        setShowDeleteModal(false);
        setUserToDelete(null);
        void fetchUsers();
      } else {
        window.alert(res.error?.message || 'Failed to delete user');
      }
    } catch (err) {
      logger.error(err);
      window.alert('Error deleting user');
    }
  }, [fetchUsers, userToDelete]);

  const handleResetPassword = useCallback(async (userId: string, email: string) => {
    if (!window.confirm(`Send password reset email to ${email}?`)) return;
    try {
      setResettingPasswordId(userId);
      const res = await api.adminResetPassword(userId);
      if (res.success) {
        window.alert('Password reset email sent.');
        setAudit((prev) => ([
          { at: new Date().toISOString(), actor: 'Admin', action: 'Password reset sent', detail: `For ${email}` },
          ...prev,
        ]));
      } else {
        window.alert(res.error?.message || 'Failed to send reset email');
      }
    } catch (e) {
      logger.error(e);
      window.alert('Error sending reset email');
    } finally {
      setResettingPasswordId(null);
    }
  }, []);

  return {
    users: {
      loading: loadingUsers,
      list: effectiveUsers,
      resettingPasswordId,
      editingUser,
      userToDelete,
    },
    invite: {
      showModal: showInviteModal,
      form: invite,
    },
    edit: {
      showModal: showEditModal,
    },
    delete: {
      showModal: showDeleteModal,
    },
    audit,
    rolePresets,
    actions: {
      setShowInviteModal,
      setInvite,
      setShowEditModal,
      setEditingUser,
      setShowDeleteModal,
      setUserToDelete,
      handleInvite,
      handleEditSave,
      handleToggleStatus,
      handleConfirmDeleteUser,
      handleResetPassword,
    },
  };
}
