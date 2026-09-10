import { IconButton } from '@/src/shared/ui';

type Props = {
  caseMode: boolean;
  claimTypeLabel: string;
  anchorTitle: string;
  policyNumberLabel: string;
  claimReference: string;
  handlerName?: string;
  totalIncurredText: string;
  netExposureText: string;
  intakeStatusPill: string;
  awaitingFnolResponse: boolean;
  auditIndicator: { title: string; dotClass: string };
  onBack: () => void;
};

export function ClaimsDeskHeaderStrip({
  caseMode,
  claimTypeLabel,
  anchorTitle,
  policyNumberLabel,
  claimReference,
  handlerName,
  totalIncurredText,
  netExposureText,
  intakeStatusPill,
  awaitingFnolResponse,
  auditIndicator,
  onBack,
}: Props) {
  return (
    <section className={`space-y-3 rounded-2xl ${caseMode ? 'border border-blue-200 bg-blue-50/60 p-3' : ''}`}>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex items-center gap-4">
          <IconButton title="Back" variant="neutral" onClick={onBack}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </IconButton>
          <div className="min-w-0 space-y-1">
            <h1 className="min-w-0 text-3xl font-black text-slate-900 tracking-tight truncate">
              {caseMode ? 'Policy not linked' : `${claimTypeLabel} - ${anchorTitle}`}
            </h1>
          </div>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between gap-4 flex-wrap text-sm font-semibold text-slate-500">
        <div className="flex items-center gap-6 flex-wrap min-w-0">
          <span className="inline-flex items-center gap-1">
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 12h10M7 17h6" />
            </svg>
            {claimReference}
          </span>
          <span className="inline-flex items-center gap-1">
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l8 4v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4z" />
            </svg>
            {policyNumberLabel}
          </span>
          {handlerName ? (
            <span className="inline-flex items-center gap-1">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 21a8 8 0 10-16 0" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 13a4 4 0 100-8 4 4 0 000 8z" />
              </svg>
              <span>Handler {handlerName}</span>
            </span>
          ) : null}
        </div>
        <div className="ml-auto flex flex-col items-end gap-2">
          <div className="text-sm font-black text-slate-900 whitespace-nowrap">
            {totalIncurredText} Gross incurred
            <span className="mx-2 text-slate-300">•</span>
            {netExposureText} Net exposure
          </div>
          <div className="inline-flex items-center gap-2">
            <span className={`text-xs font-black uppercase tracking-wider px-3 py-1.5 rounded-xl ${
              awaitingFnolResponse ? 'bg-amber-100/70 text-amber-900' : 'bg-slate-100 text-slate-700'
            }`}>
              {intakeStatusPill}
            </span>
            <span className="inline-flex items-center justify-center w-6 h-6" title={auditIndicator.title} aria-label={auditIndicator.title}>
              <span className={`w-2.5 h-2.5 rounded-full ${auditIndicator.dotClass}`} />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
