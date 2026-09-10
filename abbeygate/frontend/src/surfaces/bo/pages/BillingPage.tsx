import React, { useState, useEffect } from 'react';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { formatDateUI } from '@/src/shared/lib/format';
import type { PolicyOperationalReportRow } from '@/src/shared/api/boApiClient';

import { logger } from '@/src/shared/lib/logger';

type InvoiceRow = {
  id?: string;
  account?: string;
  amount?: number;
  status?: string;
  createdAt?: string;
  dueDate?: string;
  pdfUrl?: string | null;
  policy?: { policyHolder?: { name?: string } };
};

const BillingPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'Invoices' | 'Collections'>('Invoices');
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [collections, setCollections] = useState<PolicyOperationalReportRow[]>([]);
  const [collectionsTotalCount, setCollectionsTotalCount] = useState(0);
  const [collectionsLoading, setCollectionsLoading] = useState(true);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadInvoices();
    void loadCollections();
  }, []);

  const loadInvoices = async () => {
    try {
      const response = await api.listInvoices();
      if (response?.success) {
        setInvoices(Array.isArray(response.data) ? response.data : []);
      } else {
        setInvoices([]);
      }
    } catch (err) {
      logger.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadCollections = async () => {
    setCollectionsLoading(true);
    setCollectionsError(null);
    try {
      const response = await api.getDebtorsReport({ limit: 500, dateBasis: 'issuedAt' });
      if (response.success && response.data) {
        setCollections(response.data.items);
        setCollectionsTotalCount(response.data.totals.count);
      } else {
        setCollections([]);
        setCollectionsTotalCount(0);
        setCollectionsError(response.error?.message || 'Failed to load collections worklist.');
      }
    } catch (err) {
      logger.error(err);
      setCollections([]);
      setCollectionsTotalCount(0);
      setCollectionsError(err instanceof Error ? err.message : 'Failed to load collections worklist.');
    } finally {
      setCollectionsLoading(false);
    }
  };

  const formatCurrency = (value?: number) => `€${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Billing"
        subtitle="Invoices."
      />

      <div className="ui-tabsbar mb-6">
        {(['Invoices', 'Collections'] as const).map(tab => (
          <Button
            key={tab}
            type="button"
            variant="tab"
            size="tab"
            onClick={() => setActiveTab(tab)}
            className={`ui-tab ${activeTab === tab ? 'ui-tab-active' : 'ui-tab-inactive'}`}
          >
            {tab}
          </Button>
        ))}
      </div>

      {activeTab === 'Invoices' ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 font-bold text-slate-700 flex justify-between items-center">
            <span>Generated Invoices</span>
            <Button type="button" variant="link" size="none" onClick={() => void loadInvoices()} className="text-sm text-brand-primary hover:underline">Refresh</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-xs uppercase font-bold text-slate-400">
                <tr>
                  <th className="px-6 py-3">Invoice #</th>
                  <th className="px-6 py-3">Client</th>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Due Date</th>
                  <th className="px-6 py-3">Amount</th>
                  <th className="px-6 py-3">Net Amount (85%)</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-400">Loading invoices...</td></tr>
                ) : invoices.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-400">No invoices generated yet.</td></tr>
                ) : (
                  invoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-slate-50 transition">
                      <td className="px-6 py-4 font-mono font-bold text-slate-700">{invoice.id ? invoice.id.substring(0, 8).toUpperCase() : 'N/A'}</td>
                      <td className="px-6 py-4 font-bold text-slate-900">{invoice.policy?.policyHolder?.name || invoice.account || 'Unknown policyholder'}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{invoice.createdAt ? formatDateUI(invoice.createdAt) : '—'}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{invoice.dueDate ? formatDateUI(invoice.dueDate) : '—'}</td>
                      <td className="px-6 py-4 font-bold text-slate-900">${Number(invoice.amount || 0).toLocaleString()}</td>
                      <td className="px-6 py-4 font-bold text-slate-700">${(Number(invoice.amount || 0) * 0.85).toLocaleString()}</td>
                      <td className="px-6 py-4">
                        <span className={`text-[10px] font-black px-3 py-1.5 rounded-lg uppercase tracking-wide border ${invoice.status === 'PAID' ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/20' :
                          invoice.status === 'OPEN' || invoice.status === 'SENT' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                            'bg-slate-50 text-slate-500 border-slate-100'
                          }`}>
                          {invoice.status || 'DRAFT'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {invoice.pdfUrl ? (
                          <a
                            href={`/api/invoices/${invoice.id}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand-primary font-bold hover:underline text-sm mr-3"
                          >
                            Download PDF
                          </a>
                        ) : (
                          <span className="text-slate-300 text-sm mr-3">Generating...</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 font-bold text-slate-700 flex justify-between items-center">
            <div>
              <span>Collections worklist</span>
              <div className="text-xs font-medium text-slate-500 mt-1">Policies with outstanding or overdue balances from the Debtors report.</div>
            </div>
            <Button type="button" variant="link" size="none" onClick={() => void loadCollections()} className="text-sm text-brand-primary hover:underline">Refresh</Button>
          </div>
          {collectionsError && (
            <div className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{collectionsError}</div>
          )}
          {!collectionsLoading && collectionsTotalCount > collections.length && (
            <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              Showing the first {collections.length} of {collectionsTotalCount} collections items. Use Reporting &gt; Debtors for the full report.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-xs uppercase font-bold text-slate-400">
                <tr>
                  <th className="px-6 py-3">Policy</th>
                  <th className="px-6 py-3">Client</th>
                  <th className="px-6 py-3">Product</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Outstanding</th>
                  <th className="px-6 py-3">Overdue</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {collectionsLoading ? (
                  <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-400">Loading collections...</td></tr>
                ) : collections.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-400">No outstanding collections items.</td></tr>
                ) : (
                  collections.map((row) => (
                    <tr key={row.policyId} className="hover:bg-slate-50 transition">
                      <td className="px-6 py-4 font-mono font-bold text-slate-700">{row.policyNumber || row.policyId}</td>
                      <td className="px-6 py-4 font-bold text-slate-900">{row.insuredName}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{row.productType || '—'}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{row.boStatus || row.status}</td>
                      <td className="px-6 py-4 font-bold text-slate-900">{formatCurrency(row.outstandingBalance)}</td>
                      <td className="px-6 py-4">
                        <span className={`text-[10px] font-black px-3 py-1.5 rounded-lg uppercase tracking-wide border ${
                          row.invoiceOverdue ? 'bg-red-50 text-red-600 border-red-100' : 'bg-blue-50 text-blue-600 border-blue-100'
                        }`}>
                          {row.invoiceOverdue ? 'Overdue' : 'Outstanding'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <a className="text-brand-primary font-bold hover:underline text-sm" href={`/policies/${encodeURIComponent(row.policyId)}#billing`}>
                          Open policy
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingPage;
