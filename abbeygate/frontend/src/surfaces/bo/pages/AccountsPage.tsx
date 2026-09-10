/**
 * AccountsPage — CHAMPS Thin Shell
 *
 * Zero domain logic. Zero useState. Zero useEffect.
 * Delegates orchestration to controller, rendering to sub-components.
 */
import React from 'react';
import { Button } from '@/src/shared/ui';
import { RecordListView } from '@/src/shared/core/recordList/ui/RecordListView';

import { useAccountPageController } from '@/src/modules/accounts/hooks/useAccountPageController';
import { AccountDetailView } from '@/src/modules/accounts/views/AccountDetailView';
import { AccountWorkspaceView } from '@/src/modules/accounts/views/AccountWorkspaceView';
import { AccountDeleteModal } from '@/src/modules/accounts/views/AccountDeleteModal';

const AccountsPage = () => {
  const c = useAccountPageController();

  return (
    <div className="ui-page max-w-7xl mx-auto">
      {c.view === 'list' ? (
        <div className="max-w-7xl mx-auto">
          <div className="space-y-10">
            <RecordListView
              controller={c.listController}
              actions={(
                <Button onClick={c.navigateToNew} size="lg">
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  New account
                </Button>
              )}
            />
          </div>
        </div>
      ) : c.view === 'workspace' ? (
        <AccountWorkspaceView
          accountId={String(c.editingAccountId || '')}
          workspaceTab={c.workspaceTab}
          workspaceLoading={c.workspaceLoading}
          workspaceData={c.workspaceData}
          onNavigateToList={c.navigateToList}
          onTabChange={c.navigateToWorkspaceTab}
          onEditPrimaryContact={c.openPrimaryContactEditor}
        />
      ) : (
        <AccountDetailView
          form={c.form}
          errors={c.errors}
          activeTab={c.activeTab}
          editingAccountId={c.editingAccountId}
          isEditing={c.isEditing}
          onSetForm={c.setForm}
          onSetErrors={c.setErrors}
          onSetActiveTab={c.setActiveTab}
          onSetIsEditing={c.setIsEditing}
          onSave={c.handleSaveAccount}
          onNavigateToList={c.navigateToList}
        />
      )}

      <AccountDeleteModal
        isOpen={c.deleteModalOpen}
        accountName={c.accountToDelete?.name}
        onClose={c.closeDeleteModal}
        onConfirm={c.confirmDeleteAccount}
      />
    </div>
  );
};

export default AccountsPage;
