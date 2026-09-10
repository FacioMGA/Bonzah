import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import { Modal } from '@/src/shared/ui';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/shared/ui';
import { StatusPill } from '@/src/shared/ui/feedback/StatusPill';
import { formatDateUI } from '@/src/shared/lib/format';
import { resolveReportExecutionConfig } from './reportingFlow';
import { hasPermission } from '@/src/modules/auth/session';
import { useSession } from '@/src/modules/auth/useSession';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

type ReportingBinder = {
  id: string;
  agreementNumber?: string;
  umr?: string;
  status?: string;
  productAuthorities?: Array<{ productCode?: string; status?: string }>;
};

type PreviewIssue = {
  severity?: 'error' | 'warning' | 'info';
  code?: string;
  message?: string;
  field?: string;
};

type PreviewRow = {
  row: number;
  status: 'valid' | 'warning' | 'error';
  suppressionCandidate?: boolean;
  policyRef?: string;
  certificateRef?: string;
  values: Record<string, unknown>;
  issues: PreviewIssue[];
};

type PreviewPayload = {
  headers: string[];
  rows: PreviewRow[];
  summary: {
    totalRows: number;
    validRows: number;
    warningRows: number;
    errorRows: number;
    suppressionCandidates: number;
  };
  blocking: boolean;
  groupedIssueCounts: Record<string, number>;
};

function formatBinderLabel(binder: ReportingBinder | null): string {
  if (!binder) return 'Select a binder';
  const primary = binder.umr || binder.agreementNumber || binder.id;
  const suffix = binder.agreementNumber && binder.agreementNumber !== primary ? ` (${binder.agreementNumber})` : '';
  return `${primary}${suffix}`;
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(downloadUrl);
}

const ReportingPage: React.FC = () => {
  const { user } = useSession();
  const [generating, setGenerating] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewPayload | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'VALID' | 'WARNING' | 'ERROR' | 'BLOCKING'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [includeZeroFinancialRows, setIncludeZeroFinancialRows] = useState(false);
  const [binders, setBinders] = useState<ReportingBinder[]>([]);
  const [bindersLoading, setBindersLoading] = useState(false);
  const [bindersError, setBindersError] = useState<string | null>(null);
  const [selectedBinderId, setSelectedBinderId] = useState('');
  const [selectedProductType, setSelectedProductType] = useState('');
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);

  const periodStart = new Date(selectedYear, selectedMonth - 1, 1);
  const periodEnd = new Date(selectedYear, selectedMonth, 0, 23, 59, 59, 999);
  const yearOptions = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i);
  const canExportReports = hasPermission(user, 'reports.export');
  const canViewStaffActivity = hasPermission(user, 'people.activity.view');
  const selectedBinder = useMemo(
    () => binders.find((binder) => binder.id === selectedBinderId) || null,
    [binders, selectedBinderId],
  );
  const productTypeOptions = useMemo(() => {
    const source = selectedBinder ? [selectedBinder] : binders;
    const values = new Set<string>();
    for (const binder of source) {
      for (const authority of binder.productAuthorities || []) {
        if (String(authority.status || '').toUpperCase() !== 'ACTIVE') continue;
        const productType = String(authority.productCode || '').trim().toUpperCase();
        if (productType) values.add(productType);
      }
    }
    return Array.from(values).sort();
  }, [binders, selectedBinder]);

  const applyMonthPreset = (offsetMonths: number) => {
    const base = new Date();
    const preset = new Date(base.getFullYear(), base.getMonth() + offsetMonths, 1);
    setSelectedYear(preset.getFullYear());
    setSelectedMonth(preset.getMonth() + 1);
  };

  const handleRunReport = async (reportName: string) => {
    setPreviewData(null);
    setPreviewError(null);
    setStatusFilter('ALL');
    setSearchTerm('');
    setIncludeZeroFinancialRows(false);
    const config = resolveReportExecutionConfig(reportName);
    if (config.productType) setSelectedProductType(config.productType);
    setGenerating(reportName);
  };

  useEffect(() => {
    let cancelled = false;
    setBindersLoading(true);
    setBindersError(null);
    void api.listBinders()
      .then((response) => {
        if (cancelled) return;
        if (!response.success) {
          setBindersError(response.error?.message || 'Failed to load binders');
          setBinders([]);
          return;
        }
        const list = Array.isArray(response.data) ? response.data as ReportingBinder[] : [];
        setBinders(list.filter((binder) => String(binder.id || '').trim()));
      })
      .catch((error) => {
        if (cancelled) return;
        setBindersError(error instanceof Error ? error.message : 'Failed to load binders');
        setBinders([]);
      })
      .finally(() => {
        if (!cancelled) setBindersLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (selectedBinderId && binders.some((binder) => binder.id === selectedBinderId)) return;
    setSelectedBinderId(binders[0]?.id || '');
  }, [binders, selectedBinderId]);

  useEffect(() => {
    if (selectedProductType && productTypeOptions.includes(selectedProductType)) return;
    setSelectedProductType(productTypeOptions[0] || '');
  }, [productTypeOptions, selectedProductType]);

  const reports = [
    { name: 'Premium Bordereau', format: 'Lloyds v5.2', frequency: 'Monthly' },
    { name: 'Claims Bordereau', format: 'Lloyds v5.2', frequency: 'Monthly' },
    { name: 'Risk Bordereau', format: 'Lloyds v5.2', frequency: 'Monthly' },
    { name: 'Travel Bordereau', format: 'Lloyds v5.2 · Travel premium', frequency: 'Monthly' },
  ];

  const operationalReports = [
    { name: 'Cash Sheet', description: 'Policy premium and outstanding balance summary.', path: '/reporting/cash-sheet' },
    { name: 'Debtors', description: 'Outstanding and overdue policy balances.', path: '/reporting/debtors' },
    { name: 'Office Target', description: 'Office new business and renewal targets compared with in-force actuals.', path: '/reporting/office-targets' },
    { name: 'Origin & Conversion', description: 'Enquiry source conversion and premium by origin.', path: '/reporting/origin-conversion' },
    { name: 'Cyprus Demographic', description: 'Cyprus demographic breakdowns for policy portfolios.', path: '/reporting/cyprus-demographic' },
    { name: 'DNO', description: 'Declined / not-outbound policies requiring review.', path: '/reporting/dno' },
    ...(canViewStaffActivity
      ? [{ name: 'Activity Log', description: 'Operational audit activity across records.', path: '/reporting/activity-log' }]
      : []),
    { name: 'View Tracks', description: 'View-only audit trail for tracked records.', path: '/reporting/view-tracks' },
  ];

  const previewable = useMemo(() => {
    if (!generating) return null;
    const config = resolveReportExecutionConfig(generating);
    if (config.lane !== 'LLOYDS_MONTHLY_EXPORT' || !config.stream) return null;
    return config;
  }, [generating]);

  const loadPreview = async () => {
    if (!previewable?.stream) return;
    if (!selectedBinder) {
      setPreviewError('Select a binder before loading the BDX preview.');
      setPreviewData(null);
      return;
    }
    if (!selectedProductType) {
      setPreviewError('Select a product before loading the BDX preview.');
      setPreviewData(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const response = await api.previewLloydsBdxV52Export({
        stream: previewable.stream,
        binderId: selectedBinder.id,
        productType: selectedProductType,
        year: selectedYear,
        month: selectedMonth,
      });
      if (!response.success) {
        setPreviewError(response.error?.message || 'Failed to load preview');
        setPreviewData(null);
        return;
      }
      const payload = (response.data || {}) as Record<string, unknown>;
      const summary = (payload.summary || {}) as Record<string, unknown>;
      const rowsRaw = Array.isArray(payload.rows) ? payload.rows as Array<Record<string, unknown>> : [];
      const rows: PreviewRow[] = rowsRaw.map((item) => ({
        row: Number(item.row || 0),
        status: (String(item.status || 'valid').toLowerCase() as 'valid' | 'warning' | 'error'),
        suppressionCandidate: Boolean(item.suppressionCandidate),
        policyRef: String(item.policyRef || ''),
        certificateRef: String(item.certificateRef || ''),
        values: (item.values && typeof item.values === 'object') ? (item.values as Record<string, unknown>) : {},
        issues: Array.isArray(item.issues) ? (item.issues as PreviewIssue[]) : [],
      }));
      setPreviewData({
        headers: Array.isArray(payload.headers) ? payload.headers.map((h) => String(h)) : [],
        rows,
        blocking: Boolean(payload.blocking),
        groupedIssueCounts: (payload.groupedIssueCounts && typeof payload.groupedIssueCounts === 'object')
          ? payload.groupedIssueCounts as Record<string, number>
          : {},
        summary: {
          totalRows: Number(summary.totalRows || rows.length),
          validRows: Number(summary.validRows || rows.filter((row) => row.status === 'valid').length),
          warningRows: Number(summary.warningRows || rows.filter((row) => row.status === 'warning').length),
          errorRows: Number(summary.errorRows || rows.filter((row) => row.status === 'error').length),
          suppressionCandidates: Number(summary.suppressionCandidates || rows.filter((row) => row.suppressionCandidate).length),
        },
      });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Failed to load preview');
      setPreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!generating || !previewable) return;
    void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating, selectedYear, selectedMonth, selectedBinderId, selectedProductType]);

  const filteredPreviewRows = useMemo(() => {
    if (!previewData) return [];
    const needle = searchTerm.trim().toLowerCase();
    return previewData.rows.filter((row) => {
      if (statusFilter === 'VALID' && row.status !== 'valid') return false;
      if (statusFilter === 'WARNING' && row.status !== 'warning') return false;
      if (statusFilter === 'ERROR' && row.status !== 'error') return false;
      if (statusFilter === 'BLOCKING' && !row.issues.some((issue) => issue.severity === 'error')) return false;
      if (!needle) return true;
      const codeHit = row.issues.some((issue) => String(issue.code || '').toLowerCase().includes(needle));
      const policyHit = String(row.policyRef || '').toLowerCase().includes(needle);
      const certHit = String(row.certificateRef || '').toLowerCase().includes(needle);
      return codeHit || policyHit || certHit;
    });
  }, [previewData, statusFilter, searchTerm]);

  const canConfirmRun = Boolean(canExportReports && previewable && selectedBinder && selectedProductType && previewData && !previewData.blocking && !confirming);

  const onConfirmRun = async () => {
    if (!generating || !previewable) return;
    setRunMessage(null);
    setRunError(null);
    if (!canExportReports) {
      setRunError('Report export permission is required.');
      return;
    }
    const stream = previewable.stream;
    if (!stream) return;
    if (!selectedBinder) {
      setRunError('Select a binder before running the BDX export.');
      return;
    }
    if (!selectedProductType) {
      setRunError('Select a product before running the BDX export.');
      return;
    }
    setConfirming(true);
    try {
      const download = await api.downloadLloydsBdxV52Export({
        stream,
        binderId: selectedBinder.id,
        productType: selectedProductType,
        year: selectedYear,
        month: selectedMonth,
        format: previewable.format || 'xlsx',
        validate: true,
        includeZeroFinancialRows,
      });
      triggerBrowserDownload(download.blob, download.filename);
      const suppressedSuffix = download.zeroRowsSuppressed > 0 ? ` Suppressed zero rows: ${download.zeroRowsSuppressed}.` : '';
      const hashSuffix = download.exportHash ? ` Export hash: ${download.exportHash}.` : '';
      setRunMessage(`Report generated and download started.${suppressedSuffix}${hashSuffix}`);
      setGenerating(null);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setConfirming(false);
    }
  };

  const toneForStatus = (status: PreviewRow['status']) => {
    if (status === 'error') return 'danger';
    if (status === 'warning') return 'warning';
    return 'success';
  };

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-10">
      <PageHeader
        title="Reporting"
        subtitle="Operational reporting, audit trails, and Lloyd's V5.2 BDX preview/export."
      />

      {runMessage && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{runMessage}</div>}
      {runError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{runError}</div>}

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-black text-slate-900">Operational reports</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">The former reporting sidebar entries are now reachable here as report cards.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {operationalReports.map((report) => (
            <Link
              key={report.path}
              to={report.path}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <div className="text-sm font-black text-slate-900">{report.name}</div>
              <p className="mt-2 min-h-12 text-xs font-semibold leading-5 text-slate-500">{report.description}</p>
              <div className="mt-4 text-[11px] font-black uppercase tracking-widest text-brand-primary">Open report</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-black text-slate-900">BDX exports</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Preview validation and download immutable monthly bordereaux.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {reports.map((report) => (
          <div key={report.name} className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm hover:shadow-xl hover:scale-[1.02] transition-all duration-300">
            <div className="flex justify-between items-start mb-6">
              <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 border border-slate-100">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-3 py-1.5 rounded-full uppercase tracking-widest">{report.frequency}</span>
            </div>
            <h3 className="font-black text-slate-800 text-xl mb-1">{report.name}</h3>
            <p className="text-slate-400 text-xs font-bold mb-6 italic">{report.format}</p>
            <div className="flex items-center justify-between pt-6 border-t border-slate-50">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Validated before export</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { void handleRunReport(report.name); }}
                disabled={!canExportReports || generating === report.name}
                title={!canExportReports ? 'Report export permission required' : undefined}
                className="text-brand-primary font-black text-sm hover:underline disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wide"
              >
                {!canExportReports ? 'Restricted' : generating === report.name ? 'Generating...' : 'Run Now'}
              </Button>
            </div>
          </div>
        ))}
        </div>
      </section>

      <Modal
        isOpen={!!generating}
        onClose={() => setGenerating(null)}
        title={`Run ${generating}`}
        actions={
          <>
            <Button type="button" variant="ghost" size="md" onClick={() => setGenerating(null)} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg bg-transparent">Cancel</Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={onConfirmRun}
              disabled={!canConfirmRun}
              className="bg-brand-primary text-white px-4 py-2 rounded-lg font-bold hover:bg-brand-secondary transition"
            >
              {confirming ? 'Running...' : `Confirm Run (${MONTH_NAMES[selectedMonth - 1]} ${selectedYear})`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {runError && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {runError}
            </div>
          )}
          <div className="p-4 bg-white border border-slate-200 rounded-lg">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Select Reporting Month</p>
            <div className="flex flex-wrap gap-2 mb-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs font-bold uppercase tracking-wide"
                onClick={() => applyMonthPreset(0)}
              >
                Current month
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs font-bold uppercase tracking-wide"
                onClick={() => applyMonthPreset(-1)}
              >
                Previous month
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Month</label>
                <Select
                  variant="ui"
                  className="w-full rounded-lg p-2 text-sm"
                  value={String(selectedMonth)}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                >
                  {MONTH_NAMES.map((monthName, idx) => (
                    <option key={monthName} value={String(idx + 1)}>
                      {monthName}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Year</label>
                <Select
                  variant="ui"
                  className="w-full rounded-lg p-2 text-sm"
                  value={String(selectedYear)}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={String(year)}>
                      {year}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Selected: {formatDateUI(periodStart)} - {formatDateUI(periodEnd)}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              Export is executed for the full calendar month.
            </p>
          </div>
          <div className="p-4 bg-white border border-slate-200 rounded-lg">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Select Binder</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select
                variant="ui"
                className="w-full rounded-lg p-2 text-sm"
                value={selectedBinderId}
                onChange={(event) => {
                  setSelectedBinderId(event.target.value);
                  setPreviewData(null);
                  setPreviewError(null);
                }}
                disabled={bindersLoading || binders.length === 0}
              >
                {binders.length === 0 && <option value="">No binders available</option>}
                {binders.map((binder) => (
                  <option key={binder.id} value={binder.id}>
                    {formatBinderLabel(binder)}{binder.status ? ` — ${binder.status}` : ''}
                  </option>
                ))}
              </Select>
              <Select
                variant="ui"
                className="w-full rounded-lg p-2 text-sm"
                value={selectedProductType}
                onChange={(event) => {
                  setSelectedProductType(event.target.value);
                  setPreviewData(null);
                  setPreviewError(null);
                }}
                disabled={productTypeOptions.length === 0}
              >
                {productTypeOptions.length === 0 && <option value="">No active products</option>}
                {productTypeOptions.map((productType) => (
                  <option key={productType} value={productType}>{productType}</option>
                ))}
              </Select>
            </div>
            {bindersError && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mt-3">
                {bindersError}
              </div>
            )}
          </div>
          <div className="p-4 bg-white border border-slate-200 rounded-lg space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Validation preview</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { void loadPreview(); }}
                disabled={previewLoading || !previewable}
                className="text-xs font-bold uppercase tracking-wide"
              >
                {previewLoading ? 'Refreshing...' : 'Refresh preview'}
              </Button>
            </div>
            {previewError && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {previewError}
              </div>
            )}
            {previewData && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div className="rounded-md border border-slate-200 px-3 py-2 text-xs"><span className="font-bold">Total:</span> {previewData.summary.totalRows}</div>
                  <div className="rounded-md border border-emerald-200 px-3 py-2 text-xs"><span className="font-bold">Valid:</span> {previewData.summary.validRows}</div>
                  <div className="rounded-md border border-amber-200 px-3 py-2 text-xs"><span className="font-bold">Warnings:</span> {previewData.summary.warningRows}</div>
                  <div className="rounded-md border border-red-200 px-3 py-2 text-xs"><span className="font-bold">Errors:</span> {previewData.summary.errorRows}</div>
                  <div className="rounded-md border border-slate-200 px-3 py-2 text-xs"><span className="font-bold">Zero-row candidates:</span> {previewData.summary.suppressionCandidates}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    variant="ui"
                    className="w-44 rounded-lg p-2 text-sm"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                  >
                    <option value="ALL">All rows</option>
                    <option value="VALID">Valid only</option>
                    <option value="WARNING">Warnings only</option>
                    <option value="ERROR">Errors only</option>
                    <option value="BLOCKING">Blocking issues only</option>
                  </Select>
                  <Input
                    type="text"
                    variant="ui"
                    className="w-64 rounded-lg p-2 text-sm"
                    placeholder="Search policy, certificate, issue code"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                  {previewable?.stream === 'premium' && (
                    <label className="text-xs text-slate-600 font-semibold flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={includeZeroFinancialRows}
                        onChange={(event) => setIncludeZeroFinancialRows(event.target.checked)}
                      />
                      Include zero-financial rows in export
                    </label>
                  )}
                </div>
                <div className="max-h-72 overflow-auto border border-slate-200 rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Policy</TableHead>
                        <TableHead>Certificate</TableHead>
                        <TableHead>Issues</TableHead>
                        <TableHead>Top issue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPreviewRows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-slate-400 font-medium">No rows for selected filters.</TableCell>
                        </TableRow>
                      )}
                      {filteredPreviewRows.map((row) => (
                        <TableRow key={`${row.row}-${row.policyRef || ''}`}>
                          <TableCell className="font-bold">{row.row}</TableCell>
                          <TableCell><StatusPill label={row.status.toUpperCase()} tone={toneForStatus(row.status)} /></TableCell>
                          <TableCell className="font-semibold text-slate-700">{row.policyRef || '—'}</TableCell>
                          <TableCell className="font-semibold text-slate-700">{row.certificateRef || '—'}</TableCell>
                          <TableCell>{row.issues.length}</TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {row.issues[0] ? `${row.issues[0].code}: ${row.issues[0].message}` : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="text-xs text-slate-500">
                  {previewData.blocking
                    ? 'Export is blocked until all error-level issues are resolved or explicitly waived.'
                    : 'No blocking issues detected. Export can proceed.'}
                </div>
              </>
            )}
          </div>
          <div className="p-4 bg-slate-50 border border-slate-100 rounded-lg">
            <p className="text-sm text-slate-600 mb-2"><strong>Binder:</strong> {formatBinderLabel(selectedBinder)}</p>
            <p className="text-sm text-slate-600 mb-2"><strong>Product:</strong> {selectedProductType || 'Select a product'}</p>
            <p className="text-sm text-slate-600 mb-2">
              <strong>Period:</strong> {formatDateUI(periodStart)} - {formatDateUI(periodEnd)}
            </p>
            <p className="text-sm text-slate-600 mb-2"><strong>Target:</strong> Lloyd's V5.2 {generating || 'Bordereau'}</p>
            <div className="mt-4 text-xs text-slate-400 italic">
              * This will lock the reporting period and generate an immutable audit log.
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ReportingPage;
