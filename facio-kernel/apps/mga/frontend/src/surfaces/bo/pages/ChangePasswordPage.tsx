import React, { useState } from 'react';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import { PageHeader, Button, Input } from '@/src/shared/ui';

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    const response = await api.changePassword({ currentPassword, newPassword });
    if (response.success) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage('Password changed. Please sign in again if your current session expires.');
    } else {
      setError(response.error?.message || 'Failed to change password.');
    }
    setSubmitting(false);
  };

  return (
    <div className="ui-page max-w-2xl mx-auto space-y-6">
      <PageHeader title="Change Password" subtitle="Update your own signed-in workspace password." />

      <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">{error}</div>}
        {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{message}</div>}

        <div>
          <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">Current password</label>
          <Input
            variant="ui"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">New password</label>
          <Input
            variant="ui"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">Confirm new password</label>
          <Input
            variant="ui"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </div>
        <Button type="submit" variant="primary" size="md" disabled={submitting}>
          {submitting ? 'Changing...' : 'Change Password'}
        </Button>
      </form>
    </div>
  );
}
