import React from 'react';
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/src/shared/ui';
import { formatDateUI } from '@/src/shared/lib/format';
import type { EffectiveUser } from './admin.types';

type Props = {
  loadingUsers: boolean;
  users: EffectiveUser[];
  resettingPasswordId: string | null;
  onEdit: (user: EffectiveUser) => void;
  onToggleStatus: (user: EffectiveUser) => void;
  onResetPassword: (userId: string, email: string) => void;
};

export function AdminUsersTable(props: Props) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="p-6 border-b border-slate-100 bg-slate-50/50">
        <h2 className="text-xl font-black text-slate-900 tracking-tight">Users</h2>
      </div>
      <div className="p-6">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead>MFA</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.loadingUsers ? (
                <TableRow><TableCell colSpan={7} className="text-center text-slate-400">Loading user database...</TableCell></TableRow>
              ) : (
                props.users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-black text-slate-900">{user.name}</TableCell>
                    <TableCell className="text-sm text-slate-600 font-medium">{user.email}</TableCell>
                    <TableCell>
                      <span className="text-[10px] font-black px-2 py-1 rounded bg-slate-50 text-slate-600 border border-slate-200 uppercase tracking-wide">
                        {user.role}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm font-bold">
                      <span className={user.isActive ? 'text-emerald-600' : 'text-rose-600'}>
                        {user.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{formatDateUI(user.lastLogin)}</TableCell>
                    <TableCell className="text-sm text-slate-600 font-bold">{user.mfa}</TableCell>
                    <TableCell className="text-sm text-slate-600">{user.phone || '-'}</TableCell>
                    <TableCell className="text-right space-x-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => props.onEdit(user)}
                        className="text-slate-400 hover:text-brand-primary transition font-bold text-xs bg-transparent !p-0"
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => props.onToggleStatus(user)}
                        className={`transition font-bold text-xs bg-transparent !p-0 ${user.isActive ? 'text-slate-400 hover:text-rose-600' : 'text-emerald-500 hover:text-emerald-700'}`}
                      >
                        {user.isActive ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => props.onResetPassword(user.id, user.email)}
                        disabled={!!props.resettingPasswordId}
                        className="text-slate-400 hover:text-brand-primary transition font-bold text-xs bg-transparent !p-0"
                      >
                        {props.resettingPasswordId === user.id ? 'Sending...' : 'Reset Pwd'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
