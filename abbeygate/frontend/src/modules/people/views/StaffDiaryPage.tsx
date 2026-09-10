import React from 'react';
import { PageHeader } from '@/src/shared/ui';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import type { StaffDiaryEntry, StaffDirectoryPerson } from '@/src/shared/api/boApiClient';
import { useSession } from '@/src/modules/auth/useSession';

function formatWhen(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function StaffDiaryPage() {
  const { user } = useSession();
  const [staff, setStaff] = React.useState<StaffDirectoryPerson[]>([]);
  const [entries, setEntries] = React.useState<StaffDiaryEntry[]>([]);
  const [ownerUserId, setOwnerUserId] = React.useState(user?.id || '');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [directory, diary] = await Promise.all([
        api.listStaffDirectory(),
        api.listDiaryEntries(ownerUserId || undefined),
      ]);
      if (directory.success && Array.isArray(directory.data)) setStaff(directory.data);
      if (diary.success && Array.isArray(diary.data)) setEntries(diary.data);
      if (!directory.success) setError(directory.error?.message || 'Failed to load staff directory.');
      if (!diary.success) setError(diary.error?.message || 'Failed to load diaries.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diaries.');
    } finally {
      setLoading(false);
    }
  }, [ownerUserId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!ownerUserId && user?.id) setOwnerUserId(user.id);
  }, [ownerUserId, user?.id]);

  return (
    <div className="ui-page max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Staff diaries"
        subtitle="Every member of staff can open each other's STAFF-visibility diary."
      />
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-500">
          View diary
        </label>
        <select
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
          value={ownerUserId}
          onChange={(event) => setOwnerUserId(event.target.value)}
        >
          {staff.map((person) => (
            <option key={person.id} value={person.id}>{person.name}</option>
          ))}
        </select>
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
        {loading ? (
          <div className="text-sm font-semibold text-slate-400">Loading diary…</div>
        ) : entries.length === 0 ? (
          <div className="text-sm font-semibold text-slate-400">No STAFF-visibility entries for this person.</div>
        ) : (
          <div className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
            {entries.map((entry) => (
              <div key={entry.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-black text-slate-800">{entry.title}</div>
                  <div className="text-[11px] font-semibold text-slate-400">{formatWhen(entry.startAt)}</div>
                </div>
                {entry.body && <div className="mt-1 text-sm text-slate-600">{entry.body}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
