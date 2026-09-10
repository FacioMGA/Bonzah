import { StatusPill } from '@/src/shared/ui';
import type { BinderDetailBundle } from '../model/readModels';
import { deriveBinderDetailState } from '../model/binderDerivedState';

export function BinderSummaryStrip({ bundle }: { bundle: BinderDetailBundle }) {
  const derived = deriveBinderDetailState(bundle);
  const tone = derived.isUsableForBind ? 'success' : derived.isUsableForAssignment ? 'warning' : 'danger';
  const statusLabel = derived.isUsableForBind ? 'Bind ready' : derived.isUsableForAssignment ? 'Assignment only' : 'Blocked';

  const formatDate = (raw: string | null) => {
    if (!raw) return 'Not set';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return 'Not set';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <div className="mt-1 flex items-center justify-between gap-4 flex-wrap text-sm font-semibold text-slate-500">
      <div className="flex items-center gap-6 flex-wrap min-w-0">
        <span className="inline-flex items-center gap-1">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 12h10M7 17h6" />
          </svg>
          {bundle.binder.agreementNumber || 'No agreement'}
        </span>
        <span className="inline-flex items-center gap-1">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l8 4v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4z" />
          </svg>
          {bundle.binder.umr || 'No UMR'}
        </span>
        <span className="inline-flex items-center gap-1">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3M5 11h14M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {formatDate(bundle.binder.startDate)} — {formatDate(bundle.binder.endDate)}
        </span>
        <span className="inline-flex items-center gap-1">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 1.343-3 3 0 1.657 1.343 3 3 3 1.657 0 3-1.343 3-3 0-1.657-1.343-3-3-3z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {bundle.binder.defaultCurrency || 'EUR'}/{bundle.binder.settlementCurrency || 'EUR'}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs font-bold text-slate-500">{bundle.programLinks.length} linked programs</span>
        <StatusPill label={statusLabel} tone={tone} />
      </div>
    </div>
  );
}
