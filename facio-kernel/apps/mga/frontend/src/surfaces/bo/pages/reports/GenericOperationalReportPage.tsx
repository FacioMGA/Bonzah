import React, { useEffect, useState } from 'react';
import { PageHeader, Button, Input, Select, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/shared/ui';
import type { GenericOperationalReport, GenericOperationalReportRow, PolicyOperationalReportFilters } from '@/src/shared/api/boApiClient';
import { isReportDateRangeInvalid, REPORT_PRODUCT_OPTIONS } from './reportFilterHelpers';
import { useReportingBackBreadcrumb } from './reportNavigation';

type Props = {
  title: string;
  subtitle: string;
  load: (filters: PolicyOperationalReportFilters) => Promise<{ success?: boolean; data?: GenericOperationalReport; error?: { message?: string } }>;
  defaultProductType?: string;
};

const today = new Date();
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

export default function GenericOperationalReportPage({ title, subtitle, load, defaultProductType }: Props) {
  const reportingBack = useReportingBackBreadcrumb();
  const [filters, setFilters] = useState<PolicyOperationalReportFilters>({
    start: monthStart,
    end: monthEnd,
    dateBasis: 'inceptionDate',
    productType: defaultProductType,
    limit: 300,
  });
  const [payload, setPayload] = useState<GenericOperationalReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    const response = await load(filters);
    if (response.success && response.data) {
      setPayload(response.data);
    } else {
      setPayload(null);
      setError(response.error?.message || `Failed to load ${title}`);
    }
    setLoading(false);
  };

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  const rows: GenericOperationalReportRow[] = payload?.items || payload?.groups?.flatMap((group) => group.categories) || [];
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>())).slice(0, 10);
  const dateRangeInvalid = isReportDateRangeInvalid(filters.start, filters.end);

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-6">
      <PageHeader breadcrumb={reportingBack} title={title} subtitle={subtitle} />
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
        <Button type="button" variant="primary" size="md" onClick={() => void run()} disabled={loading || dateRangeInvalid}>{loading ? 'Loading...' : 'Run'}</Button>
      </div>
      {dateRangeInvalid && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          Start date must be on or before end date.
        </div>
      )}
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>}
      {payload?.actuals && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Actuals: {Object.entries(payload.actuals).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((header) => <TableHead key={header}>{header}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={Math.max(headers.length, 1)} className="text-center text-slate-400">No rows for these filters.</TableCell></TableRow>}
            {rows.map((row, index) => (
              <TableRow key={String(row.id || row.policyId || index)}>
                {headers.map((header) => <TableCell key={header}>{String(row[header] ?? '—')}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
