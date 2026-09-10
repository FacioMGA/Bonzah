import React from 'react';
import { useNavigate } from 'react-router-dom';
import { asRecord, fmtDate } from './workspaceTableUtils';

type Props = {
  rows: unknown[];
};

type WorkspaceRow = ReturnType<typeof asRecord>;

// Quote vs policy split (Theo, Aug 2026). The backend tags each row with
// `kind` ('POLICY' | 'QUOTE') from the canonical numbering predicate. Fall back
// to the coarse `group` ('DRAFT' === pre-bind quote) only if `kind` is absent.
function isQuoteRow(rec: WorkspaceRow): boolean {
  const kind = String(rec.kind || '').toUpperCase();
  if (kind === 'QUOTE') return true;
  if (kind === 'POLICY') return false;
  return String(rec.group || '').toUpperCase() === 'DRAFT';
}

function PolicyRowsTable({
  title,
  rows,
  numberHeader,
  emptyLabel,
}: {
  title: string;
  rows: WorkspaceRow[];
  numberHeader: string;
  emptyLabel: string;
}) {
  const navigate = useNavigate();

  return (
    <div className="ui-table-wrap">
      <div className="px-6 py-4 bg-slate-50/60 border-b border-slate-200/60 flex items-center gap-2">
        <div className="text-xs font-black text-slate-600 uppercase tracking-widest">{title}</div>
        <span className="text-xs font-black text-slate-400">({rows.length})</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-6 py-8 text-sm font-semibold text-slate-400">{emptyLabel}</div>
      ) : (
        <div className="overflow-auto">
          <table className="ui-table min-w-full">
            <thead className="ui-thead">
              <tr>
                <th className="px-6 py-4">{numberHeader}</th>
                <th className="px-6 py-4">Product</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Coverage period</th>
                <th className="px-6 py-4">Premium</th>
                <th className="px-6 py-4">Last activity</th>
              </tr>
            </thead>
            <tbody className="ui-tbody">
              {rows.slice(0, 50).map((rec, idx) => {
                const coverage = asRecord(rec.coveragePeriod);
                const premium = Number(rec.premium || 0) || 0;
                const policyId = String(rec.id || '').trim();
                return (
                  <tr
                    key={policyId || String(idx)}
                    className={`ui-row ${policyId ? 'cursor-pointer' : ''}`}
                    onClick={() => {
                      if (!policyId) return;
                      navigate(`/policies/${encodeURIComponent(policyId)}`);
                    }}
                  >
                    <td className="px-6 py-4 font-black text-slate-900 text-[14px]">{String(rec.policyNumber || '—')}</td>
                    <td className="px-6 py-4 text-slate-700 font-semibold text-[13px]">{String(rec.product || '—')}</td>
                    <td className="px-6 py-4 text-slate-700 font-semibold text-[13px]">{String(rec.status || '—')}</td>
                    <td className="px-6 py-4 text-slate-700 font-semibold text-[13px]">{`${fmtDate(coverage.start)} - ${fmtDate(coverage.end)}`}</td>
                    <td className="px-6 py-4 text-slate-700 font-semibold text-[13px]">
                      {new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(premium)}
                    </td>
                    <td className="px-6 py-4 text-slate-700 font-semibold text-[13px]">{fmtDate(rec.lastActivityAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AccountPoliciesTable({ rows }: Props) {
  const records = rows.map(asRecord);
  const policies = records.filter((rec) => !isQuoteRow(rec));
  const quotes = records.filter((rec) => isQuoteRow(rec));

  return (
    <div className="space-y-6">
      <PolicyRowsTable
        title="Policies"
        rows={policies}
        numberHeader="Policy number"
        emptyLabel="No policies."
      />
      <PolicyRowsTable
        title="Quotes"
        rows={quotes}
        numberHeader="Quote number"
        emptyLabel="No quotes."
      />
    </div>
  );
}
