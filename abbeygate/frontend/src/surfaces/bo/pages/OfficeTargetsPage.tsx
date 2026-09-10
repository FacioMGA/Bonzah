import React, { useEffect, useMemo, useState } from 'react';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import type { OfficeTargetBundleInput, OfficeTargetCategoryRow, OfficeTargetReport, PolicyOperationalReportFilters } from '@/src/shared/api/boApiClient';
import { PageHeader, Button, Input, Select, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/shared/ui';
import { formatDateUI } from '@/src/shared/lib/format';
import { isReportDateRangeInvalid, REPORT_PRODUCT_OPTIONS } from './reports/reportFilterHelpers';
import { useReportingBackBreadcrumb } from './reports/reportNavigation';

const today = new Date();
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

function formatCurrency(value: number): string {
  return `€${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatVariance(value: number, currency = false): string {
  const prefix = value > 0 ? '+' : '';
  return currency ? `${prefix}${formatCurrency(value)}` : `${prefix}${value}`;
}

function varianceClass(value: number): string {
  if (value > 0) return 'text-emerald-700';
  if (value < 0) return 'text-rose-700';
  return 'text-slate-600';
}

function CategoryTable({ rows }: { rows: OfficeTargetCategoryRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead>Premium target</TableHead>
          <TableHead>Premium actual</TableHead>
          <TableHead>Premium variance</TableHead>
          <TableHead>Policy target</TableHead>
          <TableHead>Policy actual</TableHead>
          <TableHead>Policy variance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.category} className={row.category === 'TOTAL' ? 'bg-slate-50 font-semibold' : undefined}>
            <TableCell>{row.label}</TableCell>
            <TableCell>{formatCurrency(row.premiumTarget)}</TableCell>
            <TableCell>{formatCurrency(row.premiumActual)}</TableCell>
            <TableCell className={varianceClass(row.premiumVariance)}>{formatVariance(row.premiumVariance, true)}</TableCell>
            <TableCell>{row.policyCountTarget}</TableCell>
            <TableCell>{row.policyCountActual}</TableCell>
            <TableCell className={varianceClass(row.policyCountVariance)}>{formatVariance(row.policyCountVariance)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function OfficeTargetsPage() {
  const reportingBack = useReportingBackBreadcrumb();
  const [form, setForm] = useState<OfficeTargetBundleInput>({
    periodStart: monthStart,
    periodEnd: monthEnd,
    newBusiness: { premiumTarget: 0, policyCountTarget: 0 },
    renewal: { premiumTarget: 0, policyCountTarget: 0 },
  });
  const [filters, setFilters] = useState<PolicyOperationalReportFilters>({
    start: monthStart,
    end: monthEnd,
    dateBasis: 'inceptionDate',
    limit: 300,
  });
  const [report, setReport] = useState<OfficeTargetReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalTargets = useMemo(() => ({
    premiumTarget: form.newBusiness.premiumTarget + form.renewal.premiumTarget,
    policyCountTarget: form.newBusiness.policyCountTarget + form.renewal.policyCountTarget,
  }), [form.newBusiness, form.renewal]);

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    const response = await api.getOfficeTargetReport(filters);
    if (response.success && response.data) {
      setReport(response.data);
    } else {
      setReport(null);
      setError(response.error?.message || 'Failed to load Office Target report');
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setMessage(null);
    setError(null);
    const response = await api.saveOfficeTarget(form);
    if (response.success) {
      setMessage('Office targets saved.');
      await loadReport();
    } else {
      setError(response.error?.message || 'Failed to save office targets.');
    }
  };

  const dateRangeInvalid = isReportDateRangeInvalid(filters.start, filters.end);

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-6">
      <PageHeader
        breadcrumb={reportingBack}
        title="Office Target"
        subtitle="Office-level new business and renewal targets with total actuals for the selected period."
      />

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        <h2 className="text-lg font-black text-slate-900">Enter office targets</h2>
        <p className="text-sm text-slate-600">
          Targets are configured at office level. Enter new business and renewal separately; total is the sum of both.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Product</label>
            <Select variant="ui" aria-label="Product" value={form.productCode || ''} onChange={(event) => setForm((current) => ({ ...current, productCode: event.target.value || undefined }))}>
              <option value="">All products</option>
              {REPORT_PRODUCT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Period start</label>
            <Input variant="ui" type="date" aria-label="Period start" value={form.periodStart} onChange={(event) => setForm((current) => ({ ...current, periodStart: event.target.value }))} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Period end</label>
            <Input variant="ui" type="date" aria-label="Period end" value={form.periodEnd} onChange={(event) => setForm((current) => ({ ...current, periodEnd: event.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 p-3 space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">New business</p>
            <Input variant="ui" type="number" min={0} placeholder="Premium target" value={String(form.newBusiness.premiumTarget)} onChange={(event) => setForm((current) => ({ ...current, newBusiness: { ...current.newBusiness, premiumTarget: Number(event.target.value || 0) } }))} />
            <Input variant="ui" type="number" min={0} placeholder="Policy count target" value={String(form.newBusiness.policyCountTarget)} onChange={(event) => setForm((current) => ({ ...current, newBusiness: { ...current.newBusiness, policyCountTarget: Number(event.target.value || 0) } }))} />
          </div>
          <div className="rounded-xl border border-slate-200 p-3 space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Renewal</p>
            <Input variant="ui" type="number" min={0} placeholder="Premium target" value={String(form.renewal.premiumTarget)} onChange={(event) => setForm((current) => ({ ...current, renewal: { ...current.renewal, premiumTarget: Number(event.target.value || 0) } }))} />
            <Input variant="ui" type="number" min={0} placeholder="Policy count target" value={String(form.renewal.policyCountTarget)} onChange={(event) => setForm((current) => ({ ...current, renewal: { ...current.renewal, policyCountTarget: Number(event.target.value || 0) } }))} />
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Total</p>
            <p className="text-sm text-slate-600">Premium target</p>
            <p className="text-xl font-black text-slate-900">{formatCurrency(totalTargets.premiumTarget)}</p>
            <p className="text-sm text-slate-600">Policy count target</p>
            <p className="text-xl font-black text-slate-900">{totalTargets.policyCountTarget}</p>
          </div>
        </div>
        <Button type="button" variant="primary" size="md" onClick={() => void save()}>Save office targets</Button>
        {message && <p className="text-sm font-semibold text-emerald-700">{message}</p>}
        {error && <p className="text-sm font-semibold text-rose-700">{error}</p>}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <Input variant="ui" type="date" aria-label="Start date" value={filters.start || ''} onChange={(event) => setFilters((current) => ({ ...current, start: event.target.value }))} />
        <Input variant="ui" type="date" aria-label="End date" value={filters.end || ''} onChange={(event) => setFilters((current) => ({ ...current, end: event.target.value }))} />
        <Select variant="ui" aria-label="Product" value={filters.productType || ''} onChange={(event) => setFilters((current) => ({ ...current, productType: event.target.value || undefined }))}>
          <option value="">All products</option>
          {REPORT_PRODUCT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
        <Input variant="ui" type="number" value={String(filters.limit || 300)} onChange={(event) => setFilters((current) => ({ ...current, limit: Number(event.target.value || 300) }))} />
        <Button type="button" variant="primary" size="md" onClick={() => void loadReport()} disabled={loading || dateRangeInvalid}>{loading ? 'Loading...' : 'Run'}</Button>
      </div>

      {dateRangeInvalid && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          Start date must be on or before end date.
        </div>
      )}

      {report && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-400 uppercase">New business premium</p><p className="text-2xl font-black">{formatCurrency(report.actuals.newBusinessPremium)}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-400 uppercase">Renewal premium</p><p className="text-2xl font-black">{formatCurrency(report.actuals.renewalPremium)}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-400 uppercase">Total premium</p><p className="text-2xl font-black">{formatCurrency(report.actuals.premium)}</p></div>
        </div>
      )}

      {report?.groups.length === 0 && !loading && (
        <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
          No office targets saved for these filters. Enter targets above to compare against actuals.
        </div>
      )}

      {report?.groups.map((group) => (
        <div key={`${group.periodStart}-${group.periodEnd}-${group.productCode || 'ALL'}`} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3 p-4">
          <div className="flex flex-wrap gap-4 text-sm text-slate-600">
            <span><strong>Period:</strong> {formatDateUI(group.periodStart)} – {formatDateUI(group.periodEnd)}</span>
            <span><strong>Product:</strong> {group.productCode || 'All products'}</span>
          </div>
          <CategoryTable rows={group.categories} />
        </div>
      ))}
    </div>
  );
}
