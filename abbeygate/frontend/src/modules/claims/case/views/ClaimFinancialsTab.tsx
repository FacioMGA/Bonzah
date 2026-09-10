import React from 'react';
import type { Worksheet } from '../model/worksheetTypes';

export function ClaimFinancialsTab({ worksheet }: { worksheet: Worksheet }) {
  const bucketRows = Object.entries(worksheet.summary.financials.buckets || {});
  const intakeLocked = worksheet.intake?.status !== 'FNOL_CONFIRMED';
  const formatMoney = (value: number) => {
    const currency = String(worksheet.summary.cr0109_original_currency || 'EUR').toUpperCase();
    const symbol = currency === 'EUR' ? '€' : `${currency} `;
    return `${symbol}${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  };
  const prettyBucketName = (raw: string) => {
    const normalized = String(raw || '').toUpperCase();
    const labels: Record<string, string> = {
      INDEMNITY: 'Indemnity',
      LEGAL_FEES: 'Legal fees',
      DEFENCE_COSTS: 'Defence costs',
      ADJUSTER_FEES: 'Adjuster fees',
      OTHER: 'Other',
    };
    return labels[normalized] || normalized.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  };
  return (
    <div className="space-y-4">
      {intakeLocked ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Financial actions are locked until FNOL is confirmed.
        </div>
      ) : null}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          ['Paid', worksheet.summary.financials.totalPaid],
          ['Outstanding', worksheet.summary.financials.totalOutstanding],
          ['Incurred', worksheet.summary.financials.totalIncurred],
          ['Recovered', worksheet.summary.financials.totalRecovered],
          ['Net Incurred', worksheet.summary.financials.netIncurred],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-slate-200 p-3 bg-white">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</div>
            <div className="text-lg font-black text-slate-900">{formatMoney(Number(value || 0))}</div>
          </div>
        ))}
      </div>

      <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-black uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <th className="py-2 px-3">Bucket</th>
              <th className="py-2 px-3">Paid</th>
              <th className="py-2 px-3">Outstanding</th>
              <th className="py-2 px-3">Recovered</th>
              <th className="py-2 px-3">Recovery Expected</th>
            </tr>
          </thead>
          <tbody>
            {bucketRows.map(([name, bucket]) => (
              <tr key={name} className="border-t border-slate-200 text-slate-700 font-semibold">
                <td className="py-2 px-3">{prettyBucketName(name)}</td>
                <td className="py-2 px-3">{formatMoney(Number(bucket.paid || 0))}</td>
                <td className="py-2 px-3">{formatMoney(Number(bucket.outstanding || 0))}</td>
                <td className="py-2 px-3">{formatMoney(Number(bucket.recovered || 0))}</td>
                <td className="py-2 px-3">{formatMoney(Number(bucket.recoveryExpected || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

