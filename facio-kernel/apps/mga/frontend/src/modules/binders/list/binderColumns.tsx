import React from 'react';
import type { RecordListColumn } from '@/src/shared/core/recordList/types';
import type { BinderIndexRow } from '../model/readModels';

const EUR = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

function fmtDate(value: string | null): string {
  if (!value) return 'Invalid config';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid config';
  const month = date.toLocaleString(undefined, { month: 'short' });
  return `${month} ${date.getDate()} '${String(date.getFullYear()).slice(-2)}`;
}

function fmtRelative(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < hour) return rtf.format(Math.round(diffMs / minute), 'minute');
  if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
  return rtf.format(Math.round(diffMs / day), 'day');
}

function statusDot(statusRaw: string) {
  const status = String(statusRaw || '').toUpperCase();
  let fill = '#94a3b8';
  if (status === 'ACTIVE') fill = '#16a34a';
  else if (status === 'DRAFT' || status === 'PENDING') fill = '#2563eb';
  else if (status === 'SUSPENDED') fill = '#d97706';
  else if (status === 'EXPIRED' || status === 'ARCHIVED') fill = '#dc2626';
  return (
    <svg className="w-3 h-3" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="5" fill={fill} opacity="0.9" />
    </svg>
  );
}

function lifecycleLabel(startDate: string | null, endDate: string | null): string {
  if (!startDate || !endDate) return 'INVALID CONFIG';
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'INVALID CONFIG';
  const now = new Date();
  if (now < start) return 'UPCOMING';
  if (now > end) return 'EXPIRED';
  return 'ACTIVE';
}

function formatCapacity(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return EUR.format(value);
}

function gpiTone(pct: number | null, warnThreshold: number): string {
  if (!Number.isFinite(Number(pct))) return 'text-slate-500';
  const value = Number(pct);
  if (value > 85 || value >= warnThreshold) return 'text-rose-700';
  if (value >= 70) return 'text-amber-700';
  return 'text-emerald-700';
}

export function createBinderColumns(): Array<RecordListColumn<BinderIndexRow>> {
  return [
    {
      id: 'binder',
      header: 'BINDER',
      widthClass: 'w-col260',
      sortable: true,
      sortField: 'leadCapacityProviderName',
      render: (row) => (
        <div className="min-w-0">
          <div className="font-extrabold text-slate-900 tracking-tight truncate">{row.leadCapacityProviderName || '—'}</div>
          <div className="mt-1 text-xs text-slate-500 font-semibold truncate">
            {row.umr || 'No UMR'} • {row.productLabel || 'Motor'} • {row.regionLabel || 'Cyprus'}
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'STATUS',
      widthClass: 'w-col160',
      sortable: true,
      sortField: 'status',
      render: (row) => (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {statusDot(row.status)}
            <div className="text-sm font-black text-slate-800 truncate">{row.status || 'UNKNOWN'}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-wider">
            {Number.isFinite(Number(row.gpiUsagePct)) ? (
              <span className={gpiTone(row.gpiUsagePct, row.gpiWarnThresholdPct)}>
                ⚠ GPI {Number(row.gpiUsagePct).toFixed(1)}%
              </span>
            ) : null}
            {!row.hasReportingConfig ? <span className="text-amber-700">⚠ Missing reporting</span> : <span className="text-emerald-700">✓ Healthy</span>}
            {row.hasMissingConfig ? <span className="text-rose-700">INVALID CONFIG</span> : null}
          </div>
        </div>
      ),
    },
    {
      id: 'period',
      header: 'PERIOD',
      widthClass: 'w-col170',
      sortable: true,
      sortField: 'startDate',
      render: (row) => (
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-700">{fmtDate(row.startDate)} - {fmtDate(row.endDate)}</div>
          <div className={`mt-1 text-xs font-semibold ${row.hasMissingConfig ? 'text-rose-700' : 'text-slate-500'}`}>
            {lifecycleLabel(row.startDate, row.endDate)}
          </div>
        </div>
      ),
    },
    {
      id: 'capacity',
      header: 'CAPACITY',
      widthClass: 'w-col170',
      sortable: true,
      sortField: 'gpiUsagePct',
      render: (row) => (
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-700">
            {formatCapacity(row.grossPremiumWritten)} / {formatCapacity(row.grossPremiumLimit)}
          </div>
          <div className={`mt-1 text-xs font-semibold ${gpiTone(row.gpiUsagePct, row.gpiWarnThresholdPct)}`}>
            {Number.isFinite(Number(row.gpiUsagePct)) ? `${Number(row.gpiUsagePct).toFixed(1)}% used` : 'GPI not configured'}
          </div>
          <div className="mt-1 text-[10px] font-semibold text-slate-500">
            {Number(row.policyCount || 0)} policies • {formatCapacity(row.grossPremiumWritten)}
          </div>
        </div>
      ),
    },
    {
      id: 'scope',
      header: 'SCOPE',
      widthClass: 'w-col120',
      render: (row) => (
        <div className="text-sm font-bold text-slate-700">{row.scopeLabel || row.regionLabel || '—'}</div>
      ),
    },
    {
      id: 'reporting',
      header: 'REPORTING',
      widthClass: 'w-col140',
      sortable: true,
      sortField: 'lloydsReportingVer',
      render: (row) => (
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-700">{row.lloydsReportingVer || 'V5.2'}</div>
          <div className={`mt-1 text-xs font-semibold ${row.hasReportingConfig ? 'text-emerald-700' : 'text-amber-700'}`}>
            {row.hasReportingConfig ? 'Configured' : 'Missing config'}
          </div>
        </div>
      ),
    },
    {
      id: 'lastActivity',
      header: 'LAST ACTIVITY',
      widthClass: 'w-col170',
      sortable: true,
      sortField: 'lastUpdatedAt',
      render: (row) => (
        <div className="flex flex-col items-start gap-0.5">
          <div className="text-[13px] font-semibold text-slate-700 whitespace-nowrap">{fmtDate(row.lastUpdatedAt)}</div>
          <div className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">{fmtRelative(row.lastUpdatedAt)}</div>
        </div>
      ),
    },
  ];
}
