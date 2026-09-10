import React from 'react';
import { asRecord } from '@/src/shared/lib/record';
import { filterOperatorVisibleBlockers } from '../../model/issueReadinessDisplay';
import { buildUnderwritingReadinessSummary } from '../model/underwritingState';
import { SanctionsHitRow, type SanctionsFirstHit } from '../../compliance/views/SanctionsHitRow';

type IssueBlocker = { code?: unknown; group?: unknown; message?: unknown; details?: unknown };

function blockerKey(blocker: IssueBlocker, index: number): string {
  return `${String(blocker.group || 'OTHER')}:${String(blocker.code || blocker.message || index)}`;
}

export function UnderwritingReadinessCard(props: {
  issueReadiness: unknown;
  completed: number;
  total: number;
  riskFlagCount: number;
}) {
  const [showBlockingIssues, setShowBlockingIssues] = React.useState(false);
  const readinessRecord = asRecord(props.issueReadiness);
  const readinessBlockers = Array.isArray(readinessRecord.blockers) ? filterOperatorVisibleBlockers(readinessRecord.blockers) as IssueBlocker[] : [];
  const readinessSummary = buildUnderwritingReadinessSummary({
    issueReadiness: { ...readinessRecord, blockers: readinessBlockers },
    completed: props.completed,
    total: props.total,
    riskFlagCount: props.riskFlagCount,
  });
  const readinessRows = [
    { label: 'Completed', value: `${readinessSummary.completed} / ${readinessSummary.total}`, show: readinessSummary.total > 0 },
    { label: 'Risk Flags', value: String(readinessSummary.riskFlags), show: readinessSummary.riskFlags > 0 },
    { label: 'Blocking Issues', value: String(readinessSummary.blockingIssues), show: readinessSummary.blockingIssues > 0 },
  ].filter((row) => row.show);

  // ABY-49: surface missing-issue-pack fields as expandable rows when
  // the upstream service reports them but no `blockers` are returned.
  // Without this the card showed e.g. "Blocking Issues: 3" with no way
  // to see which fields were actually missing.
  const missingForIssuedPack = readinessSummary.missingForIssuedPack;
  const hasExpandableBlockingIssues = readinessBlockers.length > 0 || missingForIssuedPack.length > 0;

  return (
    <div className="bg-white/60 border border-slate-200/60 rounded-3xl p-6 md:p-8">
      <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">Underwriting</div>
      <div className="mt-5 flex items-center justify-between gap-6">
        <div className="text-sm font-black text-slate-500">Readiness</div>
        <div className="text-sm font-black tabular-nums text-slate-900">{readinessSummary.readinessPct}%</div>
      </div>
      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-slate-900 transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, readinessSummary.readinessPct))}%` }} />
      </div>
      {readinessRows.length > 0 && (
        <div className="mt-6 space-y-3">
          {readinessRows.map((row) => {
            const isBlockingRow = row.label === 'Blocking Issues' && hasExpandableBlockingIssues;
            return (
              <div key={row.label} className="flex items-center justify-between gap-6">
                {isBlockingRow ? (
                  <button
                    type="button"
                    onClick={() => setShowBlockingIssues((value) => !value)}
                    aria-expanded={showBlockingIssues}
                    className="text-sm font-bold text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline"
                  >
                    Blocking Issues <span className="text-xs">{showBlockingIssues ? '▴' : '▾'}</span>
                  </button>
                ) : (
                  <div className="text-sm font-bold text-slate-500">{row.label}</div>
                )}
                <div className="text-sm font-black tabular-nums text-slate-900">{row.value}</div>
              </div>
            );
          })}
        </div>
      )}
      {showBlockingIssues && readinessBlockers.length > 0 && (
        <div className="mt-4 space-y-2">
          {readinessBlockers.slice(0, 4).map((blocker, index) => {
            const code = String((blocker as { code?: unknown }).code || '');
            const detailsRec = asRecord((blocker as { details?: unknown }).details);
            const firstHit = code === 'SANCTIONS_BLOCKED' ? (asRecord(detailsRec.firstHit) as SanctionsFirstHit) : null;
            return (
              <div key={blockerKey(blocker, index)} className="text-xs font-semibold text-amber-900/90">
                <span className="mr-2 text-[10px] font-black uppercase tracking-wider text-amber-700">{String(blocker.group || 'OTHER')}:</span>
                {String(blocker.message || blocker.code || 'Unknown blocker')}
                {firstHit?.hitId ? (
                  <SanctionsHitRow
                    firstHit={firstHit}
                    reportFilename={typeof detailsRec.reportFilename === 'string' ? detailsRec.reportFilename : null}
                    providerSearchId={typeof detailsRec.providerSearchId === 'string' ? detailsRec.providerSearchId : null}
                  />
                ) : null}
              </div>
            );
          })}
          {readinessBlockers.length > 4 && (
            <div className="mt-2 text-xs font-semibold text-amber-800">+{readinessBlockers.length - 4} more blockers</div>
          )}
        </div>
      )}
      {showBlockingIssues && readinessBlockers.length === 0 && missingForIssuedPack.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-[10px] font-black uppercase tracking-wider text-amber-700">Missing for issuance</div>
          {missingForIssuedPack.slice(0, 6).map((field) => (
            <div key={`missing-${field.slug}`} className="text-xs font-semibold text-amber-900/90">
              <span className="mr-2 text-[10px] font-black uppercase tracking-wider text-amber-700">FIELD:</span>
              {field.label}
              {field.label !== field.slug && (
                <span className="ml-2 text-[10px] font-mono text-slate-500">({field.slug})</span>
              )}
            </div>
          ))}
          {missingForIssuedPack.length > 6 && (
            <div className="mt-2 text-xs font-semibold text-amber-800">+{missingForIssuedPack.length - 6} more missing fields</div>
          )}
        </div>
      )}
    </div>
  );
}
