import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { BinderIndexRow, BinderStatus, BinderHealthFlag } from '../model/readModels';

/* ── Status colours ── */
const STATUS_TONE: Record<BinderStatus | string, { bg: string; dot: string; text: string }> = {
  ACTIVE:    { bg: 'bg-emerald-50', dot: 'bg-emerald-500', text: 'text-emerald-800' },
  DRAFT:     { bg: 'bg-slate-50',   dot: 'bg-slate-400',   text: 'text-slate-600' },
  PENDING:   { bg: 'bg-blue-50',    dot: 'bg-blue-500',    text: 'text-blue-800' },
  SUSPENDED: { bg: 'bg-amber-50',   dot: 'bg-amber-500',   text: 'text-amber-800' },
  EXPIRED:   { bg: 'bg-rose-50',    dot: 'bg-rose-400',    text: 'text-rose-700' },
  ARCHIVED:  { bg: 'bg-slate-50',   dot: 'bg-slate-300',   text: 'text-slate-500' },
};
const DEFAULT_STATUS_TONE = { bg: 'bg-slate-50', dot: 'bg-slate-400', text: 'text-slate-600' };

const HEALTH_COLOUR: Record<BinderHealthFlag | string, string> = {
  healthy:  'text-emerald-600',
  warning:  'text-amber-600',
  critical: 'text-rose-600',
};

function shortDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: '2-digit' });
  } catch { return '—'; }
}

type BinderCardProps = {
  binder: BinderIndexRow;
  index: number;
};

export function BinderCard({ binder, index }: BinderCardProps) {
  const navigate = useNavigate();
  const statusTone = STATUS_TONE[binder.status] ?? DEFAULT_STATUS_TONE;
  const healthColour = HEALTH_COLOUR[binder.healthFlag] ?? 'text-slate-400';
  const gpiPct = binder.gpiUsagePct != null ? Math.round(binder.gpiUsagePct) : null;
  const binderHref = binder.id ? `/configure/binders/${encodeURIComponent(binder.id)}/overview` : '';

  return (
    <button
      type="button"
      onClick={() => binderHref && navigate(binderHref)}
      className="w-full text-left bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md active:scale-[0.98] transition-all duration-200 p-4 sm:p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary animate-[card-appear_250ms_ease-out_both]"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Row 1: Coverholder + Status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900 truncate">{binder.coverholderName || '—'}</p>
          {binder.umr && <p className="text-xs text-slate-500 mt-0.5 font-mono truncate">{binder.umr}</p>}
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${statusTone.bg} ${statusTone.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusTone.dot}`} />
          {binder.status}
        </span>
      </div>

      {/* Row 2: Product + region */}
      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-500">
        {binder.productLabel && <span className="font-medium">{binder.productLabel}</span>}
        {binder.regionLabel && <span>· {binder.regionLabel}</span>}
        {binder.defaultCurrency && <span>· {binder.defaultCurrency}</span>}
      </div>

      {/* Row 3: GPI usage bar */}
      {gpiPct != null && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-slate-400 uppercase tracking-wide">GPI</span>
            <span className={`text-[11px] font-bold ${gpiPct >= (binder.gpiWarnThresholdPct ?? 80) ? 'text-amber-600' : 'text-slate-600'}`}>{gpiPct}%</span>
          </div>
          <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${gpiPct >= (binder.gpiWarnThresholdPct ?? 80) ? 'bg-amber-400' : 'bg-emerald-400'}`}
              style={{ width: `${Math.min(100, gpiPct)}%` }}
            />
          </div>
        </div>
      )}

      {/* Row 4: Dates + policy count + health */}
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-400">
        <span>{shortDate(binder.startDate)} → {shortDate(binder.endDate)}</span>
        <div className="flex items-center gap-2 shrink-0">
          {binder.policyCount > 0 && <span>{binder.policyCount} pol.</span>}
          <span className={`font-bold ${healthColour}`}>●</span>
        </div>
      </div>
    </button>
  );
}
