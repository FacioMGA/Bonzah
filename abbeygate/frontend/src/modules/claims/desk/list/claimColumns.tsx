import React from 'react';
import type { RecordListColumn } from '../../../../shared/core/recordList/types';
import type { BoClaimListItem } from './claimsAdapter';
import { getClaimStatusLabel, humanizeClaimCode } from '../../model/claimDisplayLabels';

function fmtDate(value: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const month = d.toLocaleString(undefined, { month: 'short' });
  return `${month} ${d.getDate()} '${String(d.getFullYear()).slice(-2)}`;
}

function fmtRelative(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = d.getTime() - Date.now();
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
  const s = String(statusRaw || '').toUpperCase();
  let fill = '#94a3b8';
  if (['OPEN', 'REOPENED'].includes(s)) fill = '#2563eb';
  else if (['CLOSED_THIS_MONTH', 'CLOSED'].includes(s)) fill = '#16a34a';
  else if (['WITHDRAWN'].includes(s)) fill = '#dc2626';
  return (
    <svg className="w-3 h-3" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="5" fill={fill} opacity="0.9" />
    </svg>
  );
}

function incidentMeta(countryRaw: string, causeRaw: string): string {
  const country = String(countryRaw || '').trim().toUpperCase();
  const cause = humanizeClaimCode(causeRaw);
  if (country && cause) return `${country} • ${cause}`;
  if (country) return country;
  if (cause) return cause;
  return '—';
}

export function createClaimColumns(): Array<RecordListColumn<BoClaimListItem>> {
  return [
    {
      id: 'claim',
      header: 'CLAIM',
      widthClass: 'w-col220',
      sortable: true,
      sortField: 'claimNumber',
      render: (c) => (
        <div className="min-w-0">
          <div className="font-extrabold text-slate-900 tracking-tight truncate">{c.claimNumber || '—'}</div>
          <div className="mt-1 text-xs text-slate-500 font-semibold truncate">
            {c.certificateReference ? `Cert ${c.certificateReference}` : 'No certificate reference'}
          </div>
        </div>
      ),
    },
    {
      id: 'policy',
      header: 'POLICY',
      widthClass: 'w-col220',
      sortable: true,
      sortField: 'policyNumber',
      render: (c) => (
        <div className="min-w-0">
          <div className="font-bold text-slate-700 truncate">{c.policyNumber || '—'}</div>
          <div className="mt-1 text-xs text-slate-500 font-semibold truncate">{c.policyHolderName || '—'}</div>
        </div>
      ),
    },
    {
      id: 'incident',
      header: 'INCIDENT',
      widthClass: 'w-col180',
      sortable: true,
      sortField: 'incidentDate',
      render: (c) => (
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-700">{fmtDate(c.incidentDate)}</div>
          <div className="mt-1 text-xs text-slate-500 font-semibold uppercase tracking-wide">
            {incidentMeta(c.lossCountry, c.causeOfLossCode)}
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'STATUS',
      widthClass: 'w-col170',
      sortable: true,
      sortField: 'statusRank',
      render: (c) => (
        <div>
          <div className="flex items-center gap-2">
            {statusDot(c.status)}
            <div className="text-sm font-black text-slate-800 truncate">{getClaimStatusLabel(c.status)}</div>
          </div>
          <div className="mt-1 text-[10px] font-black text-slate-300 uppercase tracking-wider">{c.id.slice(0, 8)}</div>
        </div>
      ),
    },
    {
      id: 'lastActivity',
      header: 'LAST ACTIVITY',
      widthClass: 'w-col170',
      sortable: true,
      sortField: 'updatedAt',
      render: (c) => (
        <div className="flex flex-col items-start gap-0.5">
          <div className="text-[13px] font-semibold text-slate-700 whitespace-nowrap">{fmtDate(c.updatedAt || c.reportedDate)}</div>
          <div className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">{fmtRelative(c.updatedAt || c.reportedDate)}</div>
          <div className="text-[10px] font-semibold text-slate-400 whitespace-nowrap">Reported {fmtDate(c.reportedDate)}</div>
        </div>
      ),
    },
  ];
}

