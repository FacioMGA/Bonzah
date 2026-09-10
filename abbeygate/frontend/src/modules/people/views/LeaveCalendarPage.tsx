import React from 'react';
import { Button, Input, PageHeader } from '@/src/shared/ui';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import type { StaffAbsencePayload, StaffDirectoryPerson } from '@/src/shared/api/boApiClient';
import { hasPermission } from '@/src/modules/auth/session';
import { useSession } from '@/src/modules/auth/useSession';
import {
  absenceOverlapsColumn,
  buildLeaveCalendarColumns,
  calendarAnchorLabel,
  LEAVE_CALENDAR_VIEWS,
  shiftLeaveCalendarAnchor,
  todayIso,
  type LeaveCalendarView,
} from './leaveCalendarModel';

function formatDay(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function LeaveCalendarPage() {
  const { user } = useSession();
  const canInputLeave = hasPermission(user, 'people.leave.edit');
  const canCancelLeave = hasPermission(user, 'people.leave.cancel');
  const [staff, setStaff] = React.useState<StaffDirectoryPerson[]>([]);
  const [absences, setAbsences] = React.useState<StaffAbsencePayload[]>([]);
  const [form, setForm] = React.useState({ userId: user?.id || '', absenceType: 'HOLIDAY', startDate: '', endDate: '', notes: '' });
  const [loading, setLoading] = React.useState(true);
  const [working, setWorking] = React.useState(false);
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [view, setView] = React.useState<LeaveCalendarView>('month');
  const [anchorDate, setAnchorDate] = React.useState(todayIso);

  const calendarColumns = React.useMemo(() => buildLeaveCalendarColumns(view, anchorDate), [anchorDate, view]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const visibleFrom = calendarColumns[0]?.startDate;
      const visibleTo = calendarColumns[calendarColumns.length - 1]?.endDate;
      const [directory, firstLeavePage] = await Promise.all([
        api.listStaffDirectory(),
        api.listStaffAbsences({ from: visibleFrom, to: visibleTo, offset: 0, limit: 100 }),
      ]);
      const leaveRows = firstLeavePage.success && Array.isArray(firstLeavePage.data) ? [...firstLeavePage.data] : [];
      // Keep each response within the 100-record API budget while exhausting the visible range.
      while (firstLeavePage.success && leaveRows.length > 0 && leaveRows.length % 100 === 0) {
        const nextPage = await api.listStaffAbsences({ from: visibleFrom, to: visibleTo, offset: leaveRows.length, limit: 100 });
        if (!nextPage.success || !Array.isArray(nextPage.data)) {
          setError(nextPage.error?.message || 'Failed to load leave calendar.');
          break;
        }
        leaveRows.push(...nextPage.data);
        if (nextPage.data.length < 100) break;
      }
      if (directory.success && Array.isArray(directory.data)) setStaff(directory.data);
      if (firstLeavePage.success) setAbsences(leaveRows);
      if (!directory.success) setError(directory.error?.message || 'Failed to load staff directory.');
      if (!firstLeavePage.success) setError(firstLeavePage.error?.message || 'Failed to load leave calendar.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leave calendar.');
    } finally {
      setLoading(false);
    }
  }, [calendarColumns]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const recordAbsence = async () => {
    if (!form.userId || !form.startDate || !form.endDate) {
      setError('Staff member, start date and end date are required.');
      return;
    }
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const response = await api.createStaffAbsence(form);
      if (!response.success) {
        setError(response.error?.message || 'Failed to record leave.');
        return;
      }
      setMessage('Leave recorded.');
      setForm((current) => ({ ...current, startDate: '', endDate: '', notes: '' }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record leave.');
    } finally {
      setWorking(false);
    }
  };

  const cancelAbsence = async (absence: StaffAbsencePayload) => {
    const label = `${absenceLabel(absence).toLowerCase()} for ${nameById.get(absence.userId) || absence.userId}`;
    if (!window.confirm(`Cancel ${label} from ${formatDay(absence.startDate)} to ${formatDay(absence.endDate)}?`)) return;
    setCancellingId(absence.id);
    setError(null);
    setMessage(null);
    try {
      const response = await api.cancelStaffAbsence(absence.id);
      if (!response.success) {
        setError(response.error?.message || 'Failed to cancel leave.');
        return;
      }
      setMessage('Leave cancelled.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel leave.');
    } finally {
      setCancellingId(null);
    }
  };

  const nameById = new Map(staff.map((person) => [person.id, person.name]));
  const staffRows = React.useMemo(() => {
    const rows = new Map(staff.map((person) => [person.id, person.name]));
    absences.forEach((absence) => {
      if (!rows.has(absence.userId)) rows.set(absence.userId, absence.userId);
    });
    return [...rows.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [absences, staff]);
  const absenceLabel = (absence: StaffAbsencePayload) => {
    if (absence.absenceType === 'SICK') return 'Sick';
    if (absence.absenceType === 'OUT_OF_OFFICE') return 'Out of office';
    if (absence.absenceType === 'HOLIDAY') return 'Holiday';
    return 'Other';
  };

  const absenceCellClass = (absence?: StaffAbsencePayload) => {
    if (!absence) return 'bg-white';
    if (absence.absenceType === 'SICK') return 'bg-rose-100 text-rose-800';
    if (absence.absenceType === 'OUT_OF_OFFICE') return 'bg-amber-100 text-amber-800';
    if (absence.absenceType === 'HOLIDAY') return 'bg-sky-100 text-sky-800';
    return 'bg-violet-100 text-violet-800';
  };

  return (
    <div className="ui-page max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Leave calendar"
        subtitle="All staff can view leave. Peter and Danny can add it; Danny, Peter and Andy can cancel it."
      />
      {canInputLeave && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Record leave or sick</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
              value={form.userId}
              onChange={(event) => setForm((current) => ({ ...current, userId: event.target.value }))}
            >
              {staff.map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </select>
            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
              value={form.absenceType}
              onChange={(event) => setForm((current) => ({ ...current, absenceType: event.target.value }))}
            >
              <option value="HOLIDAY">Holiday</option>
              <option value="SICK">Sick</option>
              <option value="OUT_OF_OFFICE">Out of office</option>
            </select>
            <Input variant="ui" type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} />
            <Input variant="ui" type="date" value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} />
          </div>
          <Button type="button" variant="primary" size="md" disabled={working} onClick={() => { void recordAbsence(); }}>
            {working ? 'Saving…' : 'Add leave'}
          </Button>
        </div>
      )}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-fit rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Calendar view">
            {LEAVE_CALENDAR_VIEWS.map((calendarView) => (
              <button
                key={calendarView}
                type="button"
                role="tab"
                aria-selected={view === calendarView}
                className={`rounded-lg px-3 py-2 text-xs font-bold capitalize transition ${view === calendarView ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                onClick={() => setView(calendarView)}
              >
                {calendarView}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setAnchorDate((current) => shiftLeaveCalendarAnchor(view, current, -1))}>Previous</Button>
            <div className="min-w-44 text-center text-sm font-black text-slate-800">{calendarAnchorLabel(view, anchorDate)}</div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setAnchorDate((current) => shiftLeaveCalendarAnchor(view, current, 1))}>Next</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setAnchorDate(todayIso())}>Today</Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-xs font-bold text-slate-600" aria-label="Absence legend">
          <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-800">Holiday</span>
          <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-800">Sick</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Out of office</span>
          <span className="rounded-full bg-violet-100 px-3 py-1 text-violet-800">Other</span>
        </div>
        {loading ? (
          <div className="text-sm font-semibold text-slate-400">Loading leave calendar…</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full border-collapse text-xs" data-testid="leave-calendar-grid">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-44 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-black text-slate-700">Staff</th>
                  {calendarColumns.map((column) => (
                    <th key={column.key} className="min-w-10 border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-center font-bold text-slate-500 last:border-r-0">{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staffRows.map((person) => (
                  <tr key={person.id}>
                    <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 text-left font-bold text-slate-800">{person.name}</th>
                    {calendarColumns.map((column) => {
                      const matching = absences.filter((absence) => absence.userId === person.id && absenceOverlapsColumn(absence, column));
                      const primary = matching.find((absence) => absence.absenceType === 'SICK') ?? matching[0];
                      const description = matching.map((absence) => `${absenceLabel(absence)}: ${formatDay(absence.startDate)} – ${formatDay(absence.endDate)}`).join('; ');
                      return (
                        <td
                          key={`${person.id}-${column.key}`}
                          className={`h-9 border-b border-r border-slate-200 text-center font-black last:border-r-0 ${absenceCellClass(primary)}`}
                          title={description || undefined}
                          aria-label={description || 'Available'}
                        >
                          {primary ? absenceLabel(primary).charAt(0) : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {staffRows.length === 0 && (
                  <tr><td colSpan={calendarColumns.length + 1} className="px-4 py-6 text-center font-semibold text-slate-400">No staff found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</div>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
        {absences.length === 0 ? (
          <div className="text-sm font-semibold text-slate-400">No leave recorded.</div>
        ) : (
          <div className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
            {absences.map((absence) => (
              <div key={absence.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-slate-800">{nameById.get(absence.userId) || absence.userId}</div>
                  <div className="text-xs font-semibold text-slate-500">{absence.absenceType}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xs font-semibold text-slate-400">
                    {formatDay(absence.startDate)} – {formatDay(absence.endDate)}
                  </div>
                  {canCancelLeave && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={cancellingId === absence.id}
                      onClick={() => { void cancelAbsence(absence); }}
                    >
                      {cancellingId === absence.id ? 'Cancelling…' : 'Cancel leave'}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
