import React from 'react';
import { useParams } from 'react-router-dom';
import { StatusPill, type StatusTone } from '@/src/shared/ui/feedback/StatusPill';
import { useClaimStatutoryTimetable } from '@/src/modules/claims/desk/hooks/useClaimStatutoryTimetable';
import type { StatutoryDeadlineStatus } from '@/src/modules/claims/model/statutoryTimetableTypes';

const STATUS_META: Record<StatutoryDeadlineStatus, { tone: StatusTone; label: string }> = {
  OVERDUE: { tone: 'danger', label: 'Overdue' },
  DUE_SOON: { tone: 'warning', label: 'Due soon' },
  ON_TRACK: { tone: 'success', label: 'On track' },
  NOT_STARTED: { tone: 'neutral', label: 'Not started' },
};

function formatDueDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ClaimsDeskDeadlinesPanel() {
  const params = useParams<{ id?: string }>();
  const claimId = params.id ? String(params.id) : undefined;
  const { loading, error, data } = useClaimStatutoryTimetable(claimId);

  if (!claimId) return null;

  const body = (() => {
    if (loading) {
      return <div className="text-sm font-semibold text-slate-500">Loading statutory timetable…</div>;
    }
    if (error) {
      return (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
          {error}
        </div>
      );
    }
    if (!data) return null;

    if (!data.applicable) {
      return (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
          No statutory claims-handling timetable applies to this claim.
          {data.countryCode && data.productCode ? (
            <span className="ml-1 text-slate-500">
              ({data.countryCode} · {data.productCode})
            </span>
          ) : null}
        </div>
      );
    }

    if (!data.anchored) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-600">
            The statutory clock starts once the responsible third-party insurer is first notified.
          </div>
          <StatusPill label={data.regulatoryReference} tone="info" dot={false} />
        </div>
      );
    }

    const { timetable } = data;

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-600">
            Anchored on <span className="font-black text-slate-900">{formatDueDate(timetable.anchorDate)}</span>
            <span className="ml-1 text-slate-500">(third-party insurer notification)</span>
          </div>
          <div className="flex items-center gap-2">
            {timetable.daaaSigned ? <StatusPill label="DAAA signed" tone="info" dot={false} /> : null}
            {timetable.dismantlingRequired ? <StatusPill label="Dismantling" tone="info" dot={false} /> : null}
            <StatusPill label={`${data.countryCode} · ${timetable.regulatoryReference}`} tone="neutral" dot={false} />
          </div>
        </div>

        <ol className="space-y-2">
          {timetable.items.map((item) => {
            const meta = STATUS_META[item.status];
            return (
              <li
                key={item.key}
                className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900">{item.label}</div>
                  <div className="text-[11px] font-semibold text-slate-500">{item.basis}</div>
                  {item.articles && item.articles.length > 0 ? (
                    <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {item.articles.join(' · ')}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <div className="text-sm font-black text-slate-900">{formatDueDate(item.dueDate)}</div>
                  <StatusPill label={meta.label} tone={meta.tone} />
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    );
  })();

  return (
    <section className="rounded-3xl bg-white p-5 space-y-4 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
      <div className="text-xs font-black uppercase tracking-wider text-slate-500">Statutory deadlines</div>
      {body}
    </section>
  );
}
