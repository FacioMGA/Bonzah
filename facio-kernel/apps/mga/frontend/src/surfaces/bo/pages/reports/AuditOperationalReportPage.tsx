import React, { useEffect, useMemo, useState } from 'react';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import type { AuditOperationalReport, AuditOperationalReportFilters } from '@/src/shared/api/boApiClient';
import { PageHeader, Button, Input, Select, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/shared/ui';
import { formatDateUI } from '@/src/shared/lib/format';
import { isReportDateRangeInvalid } from './reportFilterHelpers';
import { useReportingBackBreadcrumb } from './reportNavigation';

type ReportKind = 'activity-log' | 'view-tracks';

type Props = {
  kind: ReportKind;
};

const today = new Date();
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

export default function AuditOperationalReportPage({ kind }: Props) {
  const reportingBack = useReportingBackBreadcrumb();
  const [filters, setFilters] = useState<AuditOperationalReportFilters>({
    start: monthStart,
    end: monthEnd,
    limit: 100,
  });
  const [report, setReport] = useState<AuditOperationalReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = useMemo(() => kind === 'activity-log'
    ? {
      title: 'Activity Log',
      subtitle: 'Staff activity by actor, period, record and action from AuditAction.',
      load: api.getActivityLogReport,
    }
    : {
      title: 'View Tracks',
      subtitle: 'Detailed view/read tracks from AuditAction, kept separate from the wider activity log.',
      load: api.getViewTracksReport,
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

  const updateFilter = (key: keyof AuditOperationalReportFilters, value: string | boolean) => {
    setFilters((current) => ({
      ...current,
      [key]: key === 'limit' ? Number(value || 100) : value,
    }));
  };

  const dateRangeInvalid = isReportDateRangeInvalid(filters.start, filters.end);

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-6">
      <PageHeader breadcrumb={reportingBack} title={copy.title} subtitle={copy.subtitle} />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 grid grid-cols-1 md:grid-cols-7 gap-3 items-end">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Start</label>
          <Input variant="ui" type="date" aria-label="Start date" value={filters.start || ''} onChange={(e) => updateFilter('start', e.target.value)} />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">End</label>
          <Input variant="ui" type="date" aria-label="End date" value={filters.end || ''} onChange={(e) => updateFilter('end', e.target.value)} />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Actor ID</label>
          <Input variant="ui" placeholder="staff user id" value={filters.actorId || ''} onChange={(e) => updateFilter('actorId', e.target.value)} />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Entity</label>
          <Input variant="ui" placeholder="POLICY / USER" value={filters.entityType || ''} onChange={(e) => updateFilter('entityType', e.target.value)} />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Changed</label>
          <Select variant="ui" value={filters.changedOnly ? 'true' : 'false'} onChange={(e) => updateFilter('changedOnly', e.target.value === 'true')}>
            <option value="false">All actions</option>
            <option value="true">Changed only</option>
          </Select>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Rows</label>
          <Input variant="ui" type="number" min={1} max={500} value={String(filters.limit || 100)} onChange={(e) => updateFilter('limit', e.target.value)} />
        </div>
        <Button type="button" variant="primary" size="md" onClick={() => void loadReport()} disabled={loading || dateRangeInvalid}>
          {loading ? 'Loading...' : 'Run'}
        </Button>
      </div>

      {dateRangeInvalid && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          Start date must be on or before end date.
        </div>
      )}

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>}

      {report && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold text-slate-400 uppercase">Rows</p>
          <p className="text-2xl font-black">{report.totals.count}</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Changed</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={6} className="text-center text-slate-400">Loading report...</TableCell></TableRow>}
            {!loading && (!report || report.items.length === 0) && <TableRow><TableCell colSpan={6} className="text-center text-slate-400">No audit rows for these filters.</TableCell></TableRow>}
            {report?.items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{formatDateUI(row.occurredAt)}</TableCell>
                <TableCell>
                  <div className="font-semibold">{row.actorName || row.actorId}</div>
                  <div className="text-xs text-slate-400">{row.actorType}</div>
                </TableCell>
                <TableCell className="font-mono text-xs">{row.actionName}</TableCell>
                <TableCell>
                  <div className="font-semibold">{row.entityType}</div>
                  <div className="text-xs text-slate-400">{row.entityId}</div>
                </TableCell>
                <TableCell>{row.changed ? 'Yes' : 'No'}</TableCell>
                <TableCell>{row.result || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
