import React from 'react';
import { Button, Input, Modal, Select } from '@/src/shared/ui';
import type { EffectiveUser, InviteForm } from './admin.types';

type Props = {
  invite: InviteForm;
  editingUser: EffectiveUser | null;
  showInviteModal: boolean;
  showEditModal: boolean;
  showDeleteModal: boolean;
  onSetInvite: (next: InviteForm) => void;
  onSetEditingUser: (next: EffectiveUser | null) => void;
  onCloseInvite: () => void;
  onCloseEdit: () => void;
  onCloseDelete: () => void;
  onInvite: () => void;
  onEditSave: () => void;
  onDeleteConfirm: () => void;
};

export function AdminModals(props: Props) {
  const editingUser = props.editingUser;

  return (
    <>
      <Modal
        isOpen={props.showInviteModal}
        onClose={props.onCloseInvite}
        title="Invite user"
        actions={(
          <>
            <Button type="button" variant="ghost" size="md" onClick={props.onCloseInvite} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg bg-transparent">Cancel</Button>
            <Button type="button" variant="primary" size="md" onClick={props.onInvite} className="bg-brand-primary text-white px-4 py-2 rounded-lg font-bold hover:bg-brand-secondary transition">Send invite</Button>
          </>
        )}
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="invite-user-name" className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Name</label>
            <Input id="invite-user-name" name="name" variant="ui" className="ui-input" value={props.invite.name} onChange={(e) => props.onSetInvite({ ...props.invite, name: e.target.value })} placeholder="e.g., Evan Brooks" />
          </div>
          <div>
            <label htmlFor="invite-user-email" className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Email</label>
            <Input id="invite-user-email" name="email" variant="ui" className="ui-input" value={props.invite.email} onChange={(e) => props.onSetInvite({ ...props.invite, email: e.target.value })} placeholder="e.g., evan@facio.demo" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="invite-user-role" className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Role</label>
              <Select id="invite-user-role" name="role" variant="ui" className="ui-select" value={props.invite.role} onChange={(e) => props.onSetInvite({ ...props.invite, role: e.target.value as InviteForm['role'] })}>
                <option value="UNDERWRITER">Underwriter / Ops</option>
                <option value="ADMIN">Admin</option>
                <option value="CUSTOMER">Customer</option>
              </Select>
            </div>
            <div>
              <label htmlFor="invite-user-team" className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Team</label>
              <Input id="invite-user-team" name="team" variant="ui" className="ui-input" value={props.invite.team} onChange={(e) => props.onSetInvite({ ...props.invite, team: e.target.value })} placeholder="Optional" />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={props.showEditModal}
        onClose={props.onCloseEdit}
        title="Edit User"
        actions={(
          <>
            <Button type="button" variant="ghost" size="md" onClick={props.onCloseEdit} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg bg-transparent">Cancel</Button>
            <Button type="button" variant="primary" size="md" onClick={props.onEditSave} className="bg-brand-primary text-white px-4 py-2 rounded-lg font-bold hover:bg-brand-secondary transition">Save Changes</Button>
          </>
        )}
      >
        {editingUser && (
          <div className="space-y-4">
            <div>
              <label htmlFor="edit-user-name" className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Name</label>
              <Input id="edit-user-name" name="name" variant="ui" className="ui-input" value={editingUser.name} onChange={(e) => props.onSetEditingUser({ ...editingUser, name: e.target.value })} />
            </div>
            <div>
              <label htmlFor="edit-user-email" className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Email</label>
              <Input id="edit-user-email" name="email" variant="ui" className="ui-input" value={editingUser.email} onChange={(e) => props.onSetEditingUser({ ...editingUser, email: e.target.value })} />
            </div>
            <div>
              <label htmlFor="edit-user-phone" className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Phone</label>
              <Input id="edit-user-phone" name="phone" variant="ui" className="ui-input" value={editingUser.phone || ''} onChange={(e) => props.onSetEditingUser({ ...editingUser, phone: e.target.value })} placeholder="+1 ..." />
            </div>
            <div>
              <label htmlFor="edit-user-role" className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Role</label>
              <Select id="edit-user-role" name="role" variant="ui" className="ui-select" value={editingUser.role} onChange={(e) => props.onSetEditingUser({ ...editingUser, role: e.target.value as EffectiveUser['role'] })}>
                <option value="UNDERWRITER">Underwriter / Ops</option>
                <option value="ADMIN">Admin</option>
                <option value="CUSTOMER">Customer</option>
              </Select>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={props.showDeleteModal}
        onClose={props.onCloseDelete}
        title="Delete User?"
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={props.onCloseDelete}
              className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition bg-transparent"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              size="md"
              onClick={props.onDeleteConfirm}
              className="bg-red-500 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-red-500/20 hover:bg-red-600 transition"
            >
              Delete User
            </Button>
          </>
        }
      >
        <p className="text-slate-600 font-medium">Are you sure you want to delete this user? This action cannot be undone.</p>
      </Modal>
    </>
  );
}
