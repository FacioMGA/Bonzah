import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { clientPortalClient as api } from '@/src/surfaces/client/api/clientPortalClient';
import { formatDateUI, formatMoneyUI, formatCompanyName } from '@/src/shared/lib/format';
import { getPaymentTransactionStatusLabel } from '@/src/modules/policies/model/policyDisplayLabels';

type ClientInvoiceRow = {
  id?: string;
  status?: string;
  amount?: number;
  dueDate?: string;
  createdAt?: string;
  landlord?: { name?: string };
  policy?: { policyHolder?: { name?: string } };
};

export default function ClientBillingPage() {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<ClientInvoiceRow[]>([]);

  const loadData = async () => {
    try {
      setLoading(true);
      const invRes = await api.listInvoices({ page: 1, pageSize: 200 });
      setInvoices(invRes.success && invRes.data ? (Array.isArray(invRes.data) ? (invRes.data as ClientInvoiceRow[]) : []) : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const totals = useMemo(() => {
    const open = invoices.filter((i) => i.status === 'OPEN' || i.status === 'SENT');
    const due = open.reduce((sum, i) => sum + Number(i.amount || 0), 0);
    const nextDue = open[0]?.dueDate || null;
    return { openCount: open.length, due, nextDue };
  }, [invoices]);

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-10">
      <PageHeader
        title="Billing"
        subtitle="Invoices and billing status."
        actions={<Button size="lg" onClick={() => void loadData()}>Refresh</Button>}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total due</div>
          <div className="mt-2 text-2xl font-black text-slate-900">{formatMoneyUI(totals.due, 'USD')}</div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Open invoices</div>
          <div className="mt-2 text-2xl font-black text-slate-900">{totals.openCount}</div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Next due</div>
          <div className="mt-2 text-2xl font-black text-slate-900">{totals.nextDue ? formatDateUI(totals.nextDue) : '—'}</div>
        </div>
      </div>

      <div className="ui-table-wrap">
        <table className="ui-table">
          <thead className="ui-thead">
            <tr>
              <th className="px-8 py-6 pl-10">Invoice</th>
              <th className="px-8 py-6">Policy holder</th>
              <th className="px-8 py-6">Issued</th>
              <th className="px-8 py-6">Due</th>
              <th className="px-8 py-6">Status</th>
              <th className="px-8 py-6 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="ui-tbody">
            {loading ? (
              <tr><td colSpan={6} className="px-8 py-16 text-center text-slate-400 font-medium">Loading…</td></tr>
            ) : invoices.length === 0 ? (
              <tr><td colSpan={6} className="px-8 py-16 text-center text-slate-400 font-medium">No invoices generated yet.</td></tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id} className="ui-row">
                  <td className="px-8 py-6 pl-10 font-black text-slate-900">{String(inv.id).slice(0, 8).toUpperCase()}</td>
                  <td className="px-8 py-6 text-sm font-semibold text-slate-700">
                    {formatCompanyName(inv.landlord?.name || inv.policy?.policyHolder?.name || '—')}
                  </td>
                  <td className="px-8 py-6 text-sm font-semibold text-slate-500">{inv.createdAt ? formatDateUI(inv.createdAt) : '—'}</td>
                  <td className="px-8 py-6 text-sm font-semibold text-slate-500">{inv.dueDate ? formatDateUI(inv.dueDate) : '—'}</td>
                  <td className="px-8 py-6">
                    <span className={`px-3 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${inv.status === 'PAID' ? 'bg-brand-primary/10 text-brand-primary'
                      : inv.status === 'OPEN' || inv.status === 'SENT' ? 'bg-amber-100/70 text-amber-900'
                        : 'bg-slate-100 text-slate-700'
                      }`}>
                      {getPaymentTransactionStatusLabel(String(inv.status || ''))}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-right font-black text-slate-900">{formatMoneyUI(inv.amount || 0, 'USD')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
