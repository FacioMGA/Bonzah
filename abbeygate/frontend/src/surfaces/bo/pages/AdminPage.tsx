import React from 'react';
import { Button, PageHeader } from '@/src/shared/ui';
import { AdminModals } from './admin/AdminModals';
import { AdminSidePanels } from './admin/AdminSidePanels';
import { AdminUsersTable } from './admin/AdminUsersTable';
import { useAdminPageController } from './admin/useAdminPageController';

const AdminPage: React.FC = () => {
  const controller = useAdminPageController();

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-10">
      <PageHeader
        title="Users & roles"
        subtitle="MGA-grade access control aligned to underwriting, finance, and claims workflows."
        actions={(
          <Button size="lg" onClick={() => controller.actions.setShowInviteModal(true)}>
            Invite user
          </Button>
        )}
      />

      <AdminUsersTable
        loadingUsers={controller.users.loading}
        users={controller.users.list}
        resettingPasswordId={controller.users.resettingPasswordId}
        onEdit={(user) => {
          controller.actions.setEditingUser({ ...user });
          controller.actions.setShowEditModal(true);
        }}
        onToggleStatus={controller.actions.handleToggleStatus}
        onResetPassword={(userId, email) => { void controller.actions.handleResetPassword(userId, email); }}
      />

      <AdminSidePanels rolePresets={controller.rolePresets} audit={controller.audit} />

      <AdminModals
        invite={controller.invite.form}
        editingUser={controller.users.editingUser}
        showInviteModal={controller.invite.showModal}
        showEditModal={controller.edit.showModal}
        showDeleteModal={controller.delete.showModal}
        onSetInvite={controller.actions.setInvite}
        onSetEditingUser={controller.actions.setEditingUser}
        onCloseInvite={() => controller.actions.setShowInviteModal(false)}
        onCloseEdit={() => {
          controller.actions.setShowEditModal(false);
          controller.actions.setEditingUser(null);
        }}
        onCloseDelete={() => {
          controller.actions.setShowDeleteModal(false);
          controller.actions.setUserToDelete(null);
        }}
        onInvite={() => { void controller.actions.handleInvite(); }}
        onEditSave={() => { void controller.actions.handleEditSave(); }}
        onDeleteConfirm={() => { void controller.actions.handleConfirmDeleteUser(); }}
      />
    </div>
  );
};

export default AdminPage;
