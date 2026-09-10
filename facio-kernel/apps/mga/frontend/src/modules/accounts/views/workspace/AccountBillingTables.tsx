import React from 'react';
import {
  asRecord,
  fmtDate,
  fmtDateTime,
  invoiceStatusClass,
  paymentStatusClass,
} from './workspaceTableUtils';

type Props = {
  billing: Record<string, unknown>;
  policyNumberById: Map<string, string>;
};

export function AccountBillingTables({ billing, policyNumberById }: Props) {
  const invoices = Array.isArray(billing.invoices) ? billing.invoices : [];
  const payments = Array.isArray(billing.payments) ? billing.payments : [];

  return (
    <div className="space-y-4">
      <div className="ui-table-wrap">
        <div className="px-10 py-6 bg-slate-50/60 border-b border-slate-200/60 flex items-center justify-between gap-4">
          <div className="text-xs font-black text-slate-600 uppercase tracking-widest">Invoices</div>
          <div className="text-xs font-bold text-slate-400">{invoices.length} items</div>
        </div>
        {invoices.length === 0 ? (
          <div className="px-10 py-10 text-sm font-semibold text-slate-400">No invoices.</div>
        ) : (
          <div className="overflow-auto">
            <table className="ui-table min-w-full">
              <thead className="ui-thead">
                <tr>
                  <th className="px-10 py-6">Policy</th>
                  <th className="px-10 py-6">Amount</th>
                  <th className="px-10 py-6">Currency</th>
                  <th className="px-10 py-6">Status</th>
                  <th className="px-10 py-6">Due date</th>
                </tr>
              </thead>
              <tbody className="ui-tbody">
                {invoices.slice(0, 100).map((row, idx) => {
                  const rec = asRecord(row);
                  const status = String(rec.status || '').toUpperCase();
                  return (
                    <tr key={String(rec.id || idx)} className="ui-row">
                      <td className="px-10 py-6 text-slate-700 font-semibold">
                        {policyNumberById.get(String(rec.policyId || '').trim()) || '—'}
                      </td>
                      <td className="px-10 py-6 text-slate-700 font-semibold">
                        {Number(rec.amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-10 py-6 text-slate-700 font-semibold">{String(rec.currency || 'EUR')}</td>
                      <td className="px-10 py-6">
                        <span className={`inline-flex items-center gap-2 px-3 py-2 rounded-2xl text-xs font-black uppercase tracking-widest ${invoiceStatusClass(status)}`}>
                          {status || '—'}
                        </span>
                      </td>
                      <td className="px-10 py-6 text-slate-700 font-semibold">{fmtDate(rec.dueDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="ui-table-wrap">
        <div className="px-10 py-6 bg-slate-50/60 border-b border-slate-200/60 flex items-center justify-between gap-4">
          <div className="text-xs font-black text-slate-600 uppercase tracking-widest">Transactions</div>
          <div className="text-xs font-bold text-slate-400">{payments.length} items</div>
        </div>
        {payments.length === 0 ? (
          <div className="px-10 py-10 text-sm font-semibold text-slate-400">No transactions.</div>
        ) : (
          <div className="overflow-auto">
            <table className="ui-table min-w-full">
              <thead className="ui-thead">
                <tr>
                  <th className="px-10 py-6">Date</th>
                  <th className="px-10 py-6">Type</th>
                  <th className="px-10 py-6">Provider</th>
                  <th className="px-10 py-6">Status</th>
                  <th className="px-10 py-6">Details</th>
                  <th className="px-10 py-6 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="ui-tbody">
                {payments.slice(0, 100).map((row, idx) => {
                  const rec = asRecord(row);
                  const status = String(rec.status || '').toUpperCase();
                  const isOk = ['PAID', 'CAPTURED', 'AUTHORIZED'].includes(status);
                  const isFail = ['FAILED', 'CANCELLED'].includes(status);
                  const amount = Number(rec.amount || 0) || 0;
                  return (
                    <tr key={String(rec.id || idx)} className="ui-row">
                      <td className="px-10 py-6 text-slate-700 font-semibold">{fmtDateTime(rec.updatedAt || rec.createdAt)}</td>
                      <td className="px-10 py-6 text-slate-700 font-semibold">{String(rec.type || 'Payment')}</td>
                      <td className="px-10 py-6 text-slate-700 font-semibold">{String(rec.provider || '—')}</td>
                      <td className="px-10 py-6">
                        <span className={`inline-flex items-center gap-2 px-3 py-2 rounded-2xl text-xs font-black uppercase tracking-widest ${paymentStatusClass(status)}`}>
                          {status || '—'}
                        </span>
                      </td>
                      <td className="px-10 py-6 text-slate-700 font-semibold">{String(rec.purpose || rec.initiator || '—')}</td>
                      <td className={`px-10 py-6 text-right font-black tabular-nums ${isOk ? 'text-emerald-800' : isFail ? 'text-red-800' : 'text-slate-900'}`}>
                        €{Math.abs(amount).toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
