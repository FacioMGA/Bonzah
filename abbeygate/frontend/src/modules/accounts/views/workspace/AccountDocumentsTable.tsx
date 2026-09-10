import React from 'react';
import { asRecord, fmtDate, toDocName } from './workspaceTableUtils';

type Props = {
  rows: unknown[];
  policyNumberById: Map<string, string>;
};

export function AccountDocumentsTable({ rows, policyNumberById }: Props) {
  return (
    <div className="ui-table-wrap">
      <div className="px-10 py-6 bg-slate-50/60 border-b border-slate-200/60 flex items-center justify-between gap-4">
        <div className="text-xs font-black text-slate-600 uppercase tracking-widest">Documents</div>
        <div className="text-xs font-bold text-slate-400">{rows.length} items</div>
      </div>
      {rows.length === 0 ? (
        <div className="px-10 py-10 text-sm font-semibold text-slate-400">No documents.</div>
      ) : (
        <div className="overflow-auto">
          <table className="ui-table min-w-full">
            <thead className="ui-thead">
              <tr>
                <th className="px-10 py-6">Name</th>
                <th className="px-10 py-6">Issue date</th>
                <th className="px-10 py-6">Version</th>
                <th className="px-10 py-6">Policy</th>
              </tr>
            </thead>
            <tbody className="ui-tbody">
              {rows.slice(0, 150).map((row, idx) => {
                const rec = asRecord(row);
                const version = Number(rec.version || 0);
                return (
                  <tr key={String(rec.id || idx)} className="ui-row">
                    <td className="px-10 py-6 font-black text-slate-900">{toDocName(rec.type)}</td>
                    <td className="px-10 py-6 text-slate-700 font-semibold">{fmtDate(rec.createdAt)}</td>
                    <td className="px-10 py-6 text-slate-700 font-semibold">#{Number.isFinite(version) ? version : 0}</td>
                    <td className="px-10 py-6 text-slate-700 font-semibold">
                      {policyNumberById.get(String(rec.policyId || '').trim()) || '—'}
                    </td>
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
