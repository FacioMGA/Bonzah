import React from 'react';

/**
 * Shape projected by `backend/modules/policy/domain/issueReadiness.ts` into
 * `blocker.details` for SANCTIONS_BLOCKED. Mirrors the canonical
 * `SanctionFirstHit` type owned by `backend/modules/compliance/domain/sanctionsTypes.ts`.
 */
export type SanctionsFirstHit = {
  matchScore?: number | null;
  name?: string;
  country?: string;
  dateOfBirth?: string;
  gender?: string;
  pepTier?: string;
  reasonsListed?: string;
  hitId?: string;
};

type SanctionsHitRowProps = {
  firstHit: SanctionsFirstHit;
  reportFilename?: string | null;
  providerSearchId?: string | null;
};

const COLUMNS: { key: keyof SanctionsFirstHit; label: string; render?: (value: unknown) => string }[] = [
  { key: 'matchScore', label: 'Match %', render: (v) => (v == null ? '—' : `${v}%`) },
  { key: 'name', label: 'Name' },
  { key: 'country', label: 'Country' },
  { key: 'dateOfBirth', label: 'Date Of Birth' },
  { key: 'gender', label: 'Gender' },
  { key: 'pepTier', label: 'PEP Tier' },
  { key: 'reasonsListed', label: 'Reason Listed' },
  { key: 'hitId', label: 'Hit ID' },
];

/**
 * Renders the single-row "top hit" table that mirrors Creditsafe KYC
 * Protect's AML search result UI — the BO never sees the full hit list
 * because compliance officers only need to triage the top match and open
 * the PDF for full evidence. This component is rendered both in the
 * Premium tab "Important notes" card and in the Underwriting readiness card
 * (when blockers are expanded).
 */
export function SanctionsHitRow({ firstHit, reportFilename, providerSearchId }: SanctionsHitRowProps): React.ReactElement | null {
  if (!firstHit || !firstHit.hitId) return null;
  const pdfHref = reportFilename ? `/api/documents/${encodeURIComponent(reportFilename)}?inline=1` : null;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-amber-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-amber-50">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wider text-amber-900"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {COLUMNS.map((col) => {
                const raw = firstHit[col.key];
                const display = col.render ? col.render(raw) : (raw == null || raw === '' ? '—' : String(raw));
                return (
                  <td key={col.key} className="px-3 py-2 text-slate-800 font-medium">
                    {display}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-amber-100 bg-amber-50/40 px-3 py-2">
        <div className="text-[10px] font-semibold text-amber-800">
          {providerSearchId ? <>Creditsafe search <span className="font-mono">{providerSearchId}</span></> : null}
        </div>
        {pdfHref ? (
          <a
            href={pdfHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-amber-900 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-amber-50 hover:bg-amber-800"
          >
            Download full report (PDF)
          </a>
        ) : (
          <span className="text-[10px] font-semibold text-amber-700/80">Report not yet available</span>
        )}
      </div>
    </div>
  );
}
