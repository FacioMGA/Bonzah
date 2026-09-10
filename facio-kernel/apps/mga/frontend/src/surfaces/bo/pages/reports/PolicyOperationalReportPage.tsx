import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import type { PolicyOperationalReport, PolicyOperationalReportFilters } from '@/src/shared/api/boApiClient';
import { PageHeader, Button, Input, Select, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/shared/ui';
import { formatDateUI } from '@/src/shared/lib/format';
import { hasPermission } from '@/src/modules/auth/session';
import { useSession } from '@/src/modules/auth/useSession';
import { isReportDateRangeInvalid, REPORT_PRODUCT_OPTIONS } from './reportFilterHelpers';
import { useReportingBackBreadcrumb } from './reportNavigation';

type ReportKind = 'cash-sheet' | 'debtors';

type Props = {
  kind: ReportKind;
};

const today = new Date();
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

function formatCurrency(value: number): string {
  return `€${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  // Safari can drop the download if the object URL is revoked in the same
  // turn (ABY-419). Give the browser a beat to start the save.
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 2000);
}

export default function PolicyOperationalReportPage({ kind }: Props) {
  const reportingBack = useReportingBackBreadcrumb();
  const { user } = useSession();
  const canExport = hasPermission(user, 'reports.export');
  const [filters, setFilters] = useState<PolicyOperationalReportFilters>({
    start: monthStart,
    end: monthEnd,
    dateBasis: 'inceptionDate',
    limit: 200,
  });
  const [report, setReport] = useState<PolicyOperationalReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const copy = useMemo(() => kind === 'cash-sheet'
    ? {
      title: 'Cash Sheet',
      subtitle: 'Policy premium and outstanding balance summary from PolicyListIndex.',
      load: api.getCashSheet,
    }
    : {
      title: 'Debtors',
      subtitle: 'Outstanding and overdue policy balances from PolicyListIndex.',
      load: api.getDebtorsReport,
    }, [kind]);

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    const response = await copy.load(filters);
    if (response.success && response.data) {
      setReport(response.data);
    } else {
      setReport(null);
      setError(response.error?.message || `Failed to load ${copy.title}`);
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const updateFilter = (key: keyof PolicyOperationalReportFilters, value: string) => {
    setFilters((current) => ({
      ...current,
      [key]: key === 'limit' ? Number(value || 200) : value,
    }));
  };

  const exportCsv = async () => {
    if (!canExport) return;
    setExporting(true);
    try {
      const download = await api.downloadCashSheetCsv(filters);
      downloadBlob(download.blob, download.filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export CSV');
    } finally {
      setExporting(false);
    }
  };

  const dateRangeInvalid = isReportDateRangeInvalid(filters.start, filters.end);

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-6">
      <PageHeader breadcrumb={reportingBack} title={copy.title} subtitle={copy.subtitle} />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Start</label>
          <Input variant="ui" type="date" aria-label="Start date" value={filters.start || ''} onChange={(e) => updateFilter('start', e.target.value)} />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">End</label>
          <Input variant="ui" type="date" aria-label="End date" value={filters.end || ''} onChange={(e) => updateFilter('end', e.target.value)} />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Date basis</label>
          <Select variant="ui" value={filters.dateBasis || 'inceptionDate'} onChange={(e) => updateFilter('dateBasis', e.target.value)}>
            <option value="inceptionDate">Inception</option>
            <option value="createdAt">Created</option>
            <option value="issuedAt">Issued</option>
          </Select>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Product</label>
          <Select variant="ui" aria-label="Product" value={filters.productType || ''} onChange={(e) => updateFilter('productType', e.target.value)}>
            <option value="">All products</option>
            {REPORT_PRODUCT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Rows</label>
          <Input variant="ui" type="number" min={1} max={500} value={String(filters.limit || 200)} onChange={(e) => updateFilter('limit', e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="primary" size="md" onClick={() => void loadReport()} disabled={loading || dateRangeInvalid}>
            {loading ? 'Loading...' : 'Run'}
          </Button>
          {kind === 'cash-sheet' && (
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => void exportCsv()}
              disabled={!canExport || exporting || dateRangeInvalid}
              title={canExport ? 'Download CSV' : 'CSV export needs the reports.export permission'}
            >
              {exporting ? 'Exporting...' : 'CSV'}
            </Button>
          )}
        </div>
      </div>

      {dateRangeInvalid && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          Start date must be on or before end date.
        </div>
      )}

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>}

      {report && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-400 uppercase">Policies</p><p className="text-2xl font-black">{report.totals.count}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-400 uppercase">Premium</p><p className="text-2xl font-black">{formatCurrency(report.totals.totalPremium)}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-400 uppercase">Outstanding</p><p className="text-2xl font-black">{formatCurrency(report.totals.outstandingBalance)}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-400 uppercase">Overdue</p><p className="text-2xl font-black">{report.totals.invoiceOverdueCount}</p></div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Policy</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Premium</TableHead>
              <TableHead>Outstanding</TableHead>
              <TableHead>Overdue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={8} className="text-center text-slate-400">Loading report...</TableCell></TableRow>}
            {!loading && (!report || report.items.length === 0) && <TableRow><TableCell colSpan={8} className="text-center text-slate-400">No rows for these filters.</TableCell></TableRow>}
            {report?.items.map((row) => (
              <TableRow key={row.policyId}>
                <TableCell className="font-mono font-bold">
                  <Link
                    to={`/policies/${encodeURIComponent(row.policyId)}`}
                    className="text-brand-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
                    aria-label={`Open policy ${row.policyNumber}`}
                  >
                    {row.policyNumber}
                  </Link>
                </TableCell>
                <TableCell className="font-semibold">{row.insuredName}</TableCell>
                <TableCell>{row.productType || '—'}</TableCell>
                <TableCell>{row.boStatus || row.status}</TableCell>
                <TableCell>{row.date ? formatDateUI(row.date) : '—'}</TableCell>
                <TableCell>{formatCurrency(row.totalPremium)}</TableCell>
                <TableCell>{formatCurrency(row.outstandingBalance)}</TableCell>
                <TableCell>{row.invoiceOverdue ? 'Yes' : 'No'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
