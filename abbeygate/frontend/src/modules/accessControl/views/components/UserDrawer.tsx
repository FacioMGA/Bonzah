/**
 * UserDrawer
 *
 * Slide-in panel for user management.
 * Two modes: VIEW (default) and EDIT (inline edit form).
 * Actions: Suspend/Reactivate, Revoke Sessions, Send Password Reset.
 */
import React from 'react';
import { PhoneInputField } from '@/src/shared/ui/primitives/PhoneInputField';
import { DateInput } from '@/src/shared/ui/primitives/DateInput';
import type { E164Number } from 'libphonenumber-js';
import type { AccessRole, UserDetail } from '../../model/types';
import { deriveUserStatus } from '../../model/types';
import { accessControlApiClient } from '../../api/accessControlApiClient';
import {
  boApiClient as peopleApi,
  type PersonnelFilePayload,
  type StaffAbsencePayload,
  type StaffDiaryEntry,
} from '@/src/shared/api/boApiClient';

interface Props {
  user: UserDetail;
  onClose: () => void;
  onMutated: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'text-emerald-600',
  suspended: 'text-amber-600',
  pending: 'text-blue-600',
};

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-gray-100 last:border-0">
      <span className="text-sm font-medium text-gray-500 w-32 flex-shrink-0">{label}</span>
      <span className="text-sm text-gray-900 text-right flex-1 ml-4">{value ?? <span className="text-gray-400">—</span>}</span>
    </div>
  );
}

const ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'Administrator' },
  { value: 'UNDERWRITER', label: 'Underwriter' },
  { value: 'CUSTOMER', label: 'Customer' },
];

const USER_TYPE_OPTIONS = [
  { value: 'INTERNAL', label: 'Internal Staff' },
  { value: 'BROKER', label: 'Broker / Agent' },
  { value: 'PARTNER', label: 'Partner' },
  { value: 'CUSTOMER', label: 'Customer' },
];

const INPUT_CLASS = 'w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all';

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function HrPersonnelPanel({ userId }: { userId: string }) {
  const [file, setFile] = React.useState<PersonnelFilePayload | null>(null);
  const [form, setForm] = React.useState({ staffNumber: '', jobTitle: '', office: '', phone: '', notes: '' });
  const [absences, setAbsences] = React.useState<StaffAbsencePayload[]>([]);
  const [diaryEntries, setDiaryEntries] = React.useState<StaffDiaryEntry[]>([]);
  const [absenceForm, setAbsenceForm] = React.useState({ absenceType: 'HOLIDAY', startDate: '', endDate: '', notes: '' });
  const [diaryForm, setDiaryForm] = React.useState({ title: '', body: '', startAt: '' });
  const [payslipPeriod, setPayslipPeriod] = React.useState('');
  const [payslipFile, setPayslipFile] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [working, setWorking] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fileResponse, whoResponse, diaryResponse] = await Promise.all([
        peopleApi.getStaffPersonnelFile(userId),
        peopleApi.getWhoIsIn(),
        peopleApi.listDiaryEntries(),
      ]);
      if (fileResponse.success) {
        const payload = fileResponse.data || null;
        setFile(payload);
        setForm({
          staffNumber: String(payload?.staffNumber || ''),
          jobTitle: String(payload?.jobTitle || ''),
          office: String(payload?.office || ''),
          phone: String(payload?.phone || ''),
          notes: String(payload?.notes || ''),
        });
      } else {
        setFile(null);
        setForm({ staffNumber: '', jobTitle: '', office: '', phone: '', notes: '' });
        setError(fileResponse.error?.message || 'Failed to load personnel file.');
      }
      setAbsences(whoResponse.success ? whoResponse.data?.absent || [] : []);
      setDiaryEntries(diaryResponse.success && Array.isArray(diaryResponse.data) ? diaryResponse.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load HR records.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const savePersonnel = async () => {
    setWorking('personnel');
    setError(null);
    setMessage(null);
    try {
      const response = await peopleApi.saveStaffPersonnelFile(userId, form);
      if (!response.success) {
        setError(response.error?.message || 'Failed to save personnel file.');
        return;
      }
      setFile(response.data || null);
      setMessage('Personnel file saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save personnel file.');
    } finally {
      setWorking(null);
    }
  };

  const recordAbsence = async () => {
    if (!absenceForm.startDate || !absenceForm.endDate) {
      setError('Start and end dates are required.');
      return;
    }
    if (absenceForm.endDate < absenceForm.startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    setWorking('absence');
    setError(null);
    setMessage(null);
    try {
      const response = await peopleApi.createStaffAbsence({ ...absenceForm, userId });
      if (!response.success) {
        setError(response.error?.message || 'Failed to record absence.');
        return;
      }
      setMessage('Absence recorded.');
      setAbsenceForm({ absenceType: 'HOLIDAY', startDate: '', endDate: '', notes: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record absence.');
    } finally {
      setWorking(null);
    }
  };

  const createDiaryEntry = async () => {
    if (!diaryForm.title.trim() || !diaryForm.startAt) {
      setError('Diary title and start time are required.');
      return;
    }
    setWorking('diary');
    setError(null);
    setMessage(null);
    try {
      const response = await peopleApi.createDiaryEntry({ ...diaryForm, ownerUserId: userId });
      if (!response.success) {
        setError(response.error?.message || 'Failed to create diary entry.');
        return;
      }
      setMessage('Diary entry created.');
      setDiaryForm({ title: '', body: '', startAt: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create diary entry.');
    } finally {
      setWorking(null);
    }
  };

  const uploadPayslip = async () => {
    if (!payslipPeriod.trim() || !payslipFile) {
      setError('Payslip period and file are required.');
      return;
    }
    setWorking('payslip');
    setError(null);
    setMessage(null);
    try {
      const response = await peopleApi.uploadPayslipFile({ userId, periodLabel: payslipPeriod.trim(), file: payslipFile });
      if (!response.success) {
        setError(response.error?.message || 'Failed to upload payslip.');
        return;
      }
      setMessage('Payslip uploaded.');
      setPayslipPeriod('');
      setPayslipFile(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload payslip.');
    } finally {
      setWorking(null);
    }
  };

  const payslips = file?.payslips || [];
  const userAbsences = absences.filter((absence) => absence.userId === userId);
  const userDiary = diaryEntries.filter((entry) => entry.ownerUserId === userId);

  if (loading) {
    return <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-5 text-sm font-semibold text-gray-500">Loading HR records...</div>;
  }

  return (
    <div className="space-y-5">
      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-400">Personnel File</div>
        <div className="grid grid-cols-2 gap-3">
          <input className={INPUT_CLASS} placeholder="Staff number" value={form.staffNumber} onChange={(event) => setForm((current) => ({ ...current, staffNumber: event.target.value }))} />
          <input className={INPUT_CLASS} placeholder="Job title" value={form.jobTitle} onChange={(event) => setForm((current) => ({ ...current, jobTitle: event.target.value }))} />
          <input className={INPUT_CLASS} placeholder="Office" value={form.office} onChange={(event) => setForm((current) => ({ ...current, office: event.target.value }))} />
          <input className={INPUT_CLASS} placeholder="Phone" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
          <textarea className={`${INPUT_CLASS} col-span-2 min-h-20`} placeholder="Notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        </div>
        <button type="button" onClick={savePersonnel} disabled={working === 'personnel'} className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {working === 'personnel' ? 'Saving...' : 'Save personnel file'}
        </button>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-widest text-gray-400">Absence</div>
          <span className="text-xs font-semibold text-gray-400">{absences.length} people currently marked out</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <select className={INPUT_CLASS} value={absenceForm.absenceType} onChange={(event) => setAbsenceForm((current) => ({ ...current, absenceType: event.target.value }))}>
            <option value="HOLIDAY">Holiday</option>
            <option value="SICK">Sick</option>
            <option value="OUT_OF_OFFICE">Out of office</option>
          </select>
          <input className={INPUT_CLASS} placeholder="Notes" value={absenceForm.notes} onChange={(event) => setAbsenceForm((current) => ({ ...current, notes: event.target.value }))} />
          <DateInput aria-label="Absence start date" value={absenceForm.startDate} onChange={(next) => setAbsenceForm((current) => ({ ...current, startDate: next }))} inputClassName={INPUT_CLASS} />
          <DateInput aria-label="Absence end date" value={absenceForm.endDate} onChange={(next) => setAbsenceForm((current) => ({ ...current, endDate: next }))} inputClassName={INPUT_CLASS} />
        </div>
        <button type="button" onClick={recordAbsence} disabled={working === 'absence'} className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {working === 'absence' ? 'Recording...' : 'Record absence'}
        </button>
        <div className="mt-4 space-y-2">
          {userAbsences.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-400">No current approved absence for this user.</div>
          ) : userAbsences.map((absence) => (
            <div key={absence.id} className="rounded-xl bg-gray-50 px-4 py-3 text-sm">
              <div className="font-semibold text-gray-700">{absence.absenceType}</div>
              <div className="text-gray-500">{formatDate(absence.startDate)} - {formatDate(absence.endDate)}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Who is out now</div>
          <div className="mt-2 space-y-1">
            {absences.length === 0 ? (
              <div className="text-sm font-semibold text-slate-400">No approved absences are active today.</div>
            ) : absences.slice(0, 8).map((absence) => (
              <div key={absence.id} className="text-sm text-slate-600">
                <span className="font-mono text-xs">{absence.userId}</span>
                <span className="mx-2">·</span>
                <span className="font-semibold">{absence.absenceType}</span>
                <span className="mx-2">·</span>
                <span>{formatDate(absence.startDate)} - {formatDate(absence.endDate)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-400">Payslips</div>
        <div className="grid grid-cols-1 gap-3">
          <input className={INPUT_CLASS} placeholder="Period, e.g. Aug 2026" value={payslipPeriod} onChange={(event) => setPayslipPeriod(event.target.value)} />
          <input className={INPUT_CLASS} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => setPayslipFile(event.target.files?.[0] || null)} />
        </div>
        <button type="button" onClick={uploadPayslip} disabled={working === 'payslip'} className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {working === 'payslip' ? 'Uploading...' : 'Upload payslip'}
        </button>
        <div className="mt-4 space-y-2">
          {payslips.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-400">No payslips uploaded yet.</div>
          ) : payslips.map((payslip) => (
            <div key={payslip.id} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3 text-sm">
              <div>
                <div className="font-semibold text-gray-700">{payslip.periodLabel}</div>
                <div className="text-gray-500">{payslip.fileName} - {formatDate(payslip.uploadedAt)}</div>
              </div>
              {payslip.storageKey && (
                <a className="font-semibold text-indigo-600 hover:underline" href={`/api/documents/${encodeURIComponent(payslip.storageKey)}`} target="_blank" rel="noreferrer">Open</a>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-400">Diary</div>
        <div className="grid grid-cols-1 gap-3">
          <input className={INPUT_CLASS} placeholder="Title" value={diaryForm.title} onChange={(event) => setDiaryForm((current) => ({ ...current, title: event.target.value }))} />
          <input className={INPUT_CLASS} type="datetime-local" value={diaryForm.startAt} onChange={(event) => setDiaryForm((current) => ({ ...current, startAt: event.target.value }))} />
          <textarea className={`${INPUT_CLASS} min-h-20`} placeholder="Body" value={diaryForm.body} onChange={(event) => setDiaryForm((current) => ({ ...current, body: event.target.value }))} />
        </div>
        <button type="button" onClick={createDiaryEntry} disabled={working === 'diary'} className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {working === 'diary' ? 'Creating...' : 'Create diary entry'}
        </button>
        <div className="mt-4 space-y-2">
          {userDiary.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-400">No diary entries for this user.</div>
          ) : userDiary.slice(0, 8).map((entry) => (
            <div key={entry.id} className="rounded-xl bg-gray-50 px-4 py-3 text-sm">
              <div className="font-semibold text-gray-700">{entry.title}</div>
              <div className="text-gray-500">{formatDate(entry.startAt)} - {entry.visibility}</div>
              {entry.body && <div className="mt-1 text-gray-600">{entry.body}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function UserDrawer({ user, onClose, onMutated }: Props) {
  const status = deriveUserStatus(user);
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || user.email;

  // Edit state
  const [mode, setMode] = React.useState<'view' | 'edit'>('view');
  const [editFirstName, setEditFirstName] = React.useState(user.firstName ?? '');
  const [editLastName, setEditLastName] = React.useState(user.lastName ?? '');
  const [editPhone, setEditPhone] = React.useState<E164Number | undefined>(user.phone as E164Number | undefined);
  const [editRole, setEditRole] = React.useState(user.role);
  const [editUserType, setEditUserType] = React.useState(user.userType);
  const [editLoading, setEditLoading] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [activeViewTab, setActiveViewTab] = React.useState<'account' | 'hr'>('account');

  // Action state
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [availableRoles, setAvailableRoles] = React.useState<AccessRole[]>([]);
  const [assignmentRoleId, setAssignmentRoleId] = React.useState('');

  React.useEffect(() => {
    void accessControlApiClient.listRoles()
      .then((response) => setAvailableRoles(response.roles))
      .catch(() => setAvailableRoles([]));
  }, []);

  const handleSaveEdit = async () => {
    setEditLoading(true);
    setEditError(null);
    try {
      await accessControlApiClient.updateUser(user.id, {
        firstName: editFirstName.trim() || undefined,
        lastName: editLastName.trim() || undefined,
        phone: editPhone || undefined,
        role: editRole,
        userType: editUserType,
      });
      onMutated();
      setMode('view');
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Update failed. Please try again.');
    } finally {
      setEditLoading(false);
    }
  };

  const withAction = async (key: string, fn: () => Promise<unknown>) => {
    setActionLoading(key);
    setActionError(null);
    try {
      await fn();
      onMutated();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setActionLoading(null);
    }
  };

  const assignedRoleIds = new Set(user.accessAssignments.map((assignment) => assignment.roleId));
  const assignableRoles = availableRoles.filter((roleOption) => !assignedRoleIds.has(roleOption.id));

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">User Profile</h2>
          <div className="flex items-center gap-2">
            {mode === 'view' ? (
              <button
                onClick={() => setMode('edit')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit
              </button>
            ) : (
              <button
                onClick={() => { setMode('view'); setEditError(null); }}
                className="px-3 py-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Hero */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white shadow-lg flex-shrink-0"
              style={{ background: `hsl(${Math.abs(user.email.charCodeAt(0) * 15 + user.email.charCodeAt(1) * 7) % 360}, 55%, 48%)` }}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-xl font-bold text-gray-900 truncate">{displayName}</div>
              <div className="text-sm text-gray-500 truncate">{user.email}</div>
              <div className="flex items-center gap-3 mt-1.5">
                <span className={`flex items-center gap-1 text-sm font-semibold capitalize ${STATUS_COLORS[status]}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {status}
                </span>
                {user.mfaEnabled && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7L12 2zm-1 14l-3-3 1.41-1.41L11 13.17l4.59-4.58L17 10l-6 6z"/>
                    </svg>
                    MFA ON
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Body — View or Edit */}
        <div className="flex-1 overflow-y-auto">
          {mode === 'view' ? (
            <div className="px-6 py-4">
              <div className="mb-4 flex rounded-2xl bg-gray-50 p-1">
                {(['account', 'hr'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveViewTab(tab)}
                    className={`flex-1 rounded-xl px-3 py-2 text-sm font-bold transition-colors ${
                      activeViewTab === tab ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab === 'account' ? 'Account' : 'HR / Personnel'}
                  </button>
                ))}
              </div>

              {activeViewTab === 'hr' ? (
                <HrPersonnelPanel userId={user.id} />
              ) : (
                <>
                  <p className="text-xs font-bold tracking-widest text-gray-400 uppercase mb-3">Account Details</p>
                  <div>
                    <DetailRow label="User ID" value={<span className="font-mono text-xs text-gray-500">{user.id}</span>} />
                    <DetailRow label="First Name" value={user.firstName} />
                    <DetailRow label="Last Name" value={user.lastName} />
                    <DetailRow label="Role" value={user.role} />
                    <DetailRow label="User Type" value={user.userType} />
                    <DetailRow label="Phone" value={user.phone} />
                    <DetailRow label="Joined" value={new Date(user.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />
                    <DetailRow label="Last Login" value={user.lastLogin ? new Date(user.lastLogin).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never'} />
                    {user.invitedBy && (
                      <DetailRow label="Invited By" value={
                        [user.invitedBy.firstName, user.invitedBy.lastName].filter(Boolean).join(' ') ||
                        user.invitedBy.name || user.invitedBy.email
                      } />
                    )}
                    {user.suspendedAt && (
                      <>
                        <DetailRow label="Suspended" value={new Date(user.suspendedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />
                        {user.suspendedReason && <DetailRow label="Reason" value={user.suspendedReason} />}
                      </>
                    )}
                  </div>

                  <div className="mt-5">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <p className="text-xs font-bold tracking-widest text-gray-400 uppercase">Role Assignments</p>
                      <div className="flex items-center gap-2">
                        <select
                          value={assignmentRoleId}
                          onChange={(event) => setAssignmentRoleId(event.target.value)}
                          className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="">Assign role…</option>
                          {assignableRoles.map((roleOption) => (
                            <option key={roleOption.id} value={roleOption.id}>{roleOption.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => withAction('assign', () => accessControlApiClient.createAssignment(user.id, { roleId: assignmentRoleId }))}
                          disabled={!assignmentRoleId || !!actionLoading}
                          className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold disabled:opacity-50"
                        >
                          {actionLoading === 'assign' ? 'Assigning…' : 'Assign'}
                        </button>
                      </div>
                    </div>
                    {user.accessAssignments?.length > 0 ? (
                      <div className="space-y-2">
                        {user.accessAssignments.map(a => (
                          <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 bg-indigo-50 rounded-xl">
                            <div>
                              <span className="text-sm font-semibold text-indigo-700">{a.role.name}</span>
                              <div className="text-xs text-indigo-400 uppercase">{a.scopeType}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => withAction(`revoke-${a.id}`, () => accessControlApiClient.deleteAssignment(user.id, a.id))}
                              disabled={!!actionLoading}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50"
                            >
                              {actionLoading === `revoke-${a.id}` ? 'Removing…' : 'Remove'}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-gray-200 px-4 py-4 text-sm text-gray-400">
                        No explicit access-role assignments yet.
                      </div>
                    )}
                  </div>

                  {actionError && (
                    <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{actionError}</div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="px-6 py-4 space-y-4">
              <p className="text-xs font-bold tracking-widest text-gray-400 uppercase mb-2">Edit Profile</p>

              {/* Name row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">First Name</label>
                  <input
                    type="text"
                    value={editFirstName}
                    onChange={e => setEditFirstName(e.target.value)}
                    placeholder="First name"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Last Name</label>
                  <input
                    type="text"
                    value={editLastName}
                    onChange={e => setEditLastName(e.target.value)}
                    placeholder="Last name"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </div>
              </div>

              {/* Phone */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Phone Number</label>
                <div className="text-sm">
                  <PhoneInputField
                    value={editPhone}
                    onChange={(val: E164Number | undefined) => setEditPhone(val)}
                    defaultCountry="GB"
                    placeholder="+44 20 7946 0958"
                  />
                </div>
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Role</label>
                <select
                  value={editRole}
                  onChange={e => setEditRole(e.target.value as typeof editRole)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all appearance-none"
                >
                  {ROLE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* User Type */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">User Type</label>
                <select
                  value={editUserType}
                  onChange={e => setEditUserType(e.target.value as typeof editUserType)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all appearance-none"
                >
                  {USER_TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {editError && (
                <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{editError}</div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-gray-100 bg-gray-50 px-6 py-4">
          {mode === 'edit' ? (
            <button
              onClick={handleSaveEdit}
              disabled={editLoading}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold rounded-xl transition-colors shadow-sm"
            >
              {editLoading ? (
                <><svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Saving…</>
              ) : (
                'Save Changes'
              )}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => withAction('status', () =>
                    status === 'suspended'
                      ? accessControlApiClient.updateUserStatus(user.id, true)
                      : accessControlApiClient.updateUserStatus(user.id, false)
                  )}
                  disabled={!!actionLoading}
                  className={`px-4 py-2.5 text-sm font-semibold rounded-xl border transition-colors disabled:opacity-60 ${
                    status === 'suspended'
                      ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                      : 'border-amber-300 text-amber-700 hover:bg-amber-50'
                  }`}
                >
                  {actionLoading === 'status' ? '…' : status === 'suspended' ? 'Reactivate' : 'Suspend'}
                </button>
                <button
                  onClick={() => withAction('revoke', () => accessControlApiClient.revokeUserSessions(user.id))}
                  disabled={!!actionLoading}
                  className="px-4 py-2.5 text-sm font-semibold rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-60"
                >
                  {actionLoading === 'revoke' ? '…' : 'Revoke Sessions'}
                </button>
              </div>
              <button
                onClick={() => withAction('reset', () => accessControlApiClient.resetUserPassword(user.id))}
                disabled={!!actionLoading}
                className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm disabled:opacity-60"
              >
                {actionLoading === 'reset' ? 'Sending…' : 'Send Password Reset'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
