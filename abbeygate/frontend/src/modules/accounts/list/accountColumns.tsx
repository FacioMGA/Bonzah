import React from 'react';
import type { RecordListColumn } from '@/src/shared/core/recordList/types';
import type { BoAccountListItem } from './accountsAdapter';

export function createAccountColumns(): Array<RecordListColumn<BoAccountListItem>> {
  const toRelative = (raw: string): string => {
    const d = new Date(String(raw || ''));
    if (Number.isNaN(d.getTime())) return 'No activity';
    const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  };

  const stateTone = (state: BoAccountListItem['state']) => {
    if (state === 'PAYMENT_ISSUE') return 'bg-rose-100 text-rose-800 border-rose-200';
    if (state === 'CLAIM') return 'bg-amber-100 text-amber-800 border-amber-200';
    if (state === 'RENEWAL') return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  };

  const stateLabel = (state: BoAccountListItem['state']) => {
    if (state === 'PAYMENT_ISSUE') return 'Payment issue';
    if (state === 'CLAIM') return 'Claim';
    if (state === 'RENEWAL') return 'Renewal';
    return 'Active';
  };

  const reasonText = (a: BoAccountListItem): string | null => {
    if (a.overdueAmount > 0) return 'Overdue invoice';
    if (a.failedPaymentsCount > 0) return 'Failed payment';
    if (a.openClaimsCount > 0) return 'Open claim';
    if (a.nextRenewalAt) return 'Renewal in under 30 days';
    return null;
  };

  const humanizeActivity = (a: BoAccountListItem): string => {
    const raw = String(a.lastActivitySummary || '').trim();
    if (!raw) return 'No recent event';
    const scrubbed = raw
      .replace(/\bPolicy\s+[A-Z]{2,}[A-Z0-9-]*\s+updated\b/gi, 'Policy updated')
      .replace(/\bClaim\s+[A-Z]{2,}[A-Z0-9-]*\s+updated\b/gi, 'Claim updated')
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return scrubbed || 'Activity updated';
  };

  const productIconFor = (product: string) => {
    const up = product.toUpperCase();
    if (up.includes('AUTO') || up.includes('MOTOR')) return 'CAR';
    if (up.includes('PROPERTY') || up.includes('HOME')) return 'HOME';
    if (up.includes('LIABILITY') || up.includes('CASUALTY')) return 'LIAB';
    return 'GEN';
  };

  return [
    {
      id: 'account',
      header: 'ACCOUNT',
      widthClass: 'w-col180',
      sortable: true,
      sortField: 'accountName',
      render: (a) => (
        <div className="min-w-0">
          <div className="font-extrabold text-slate-800 text-base tracking-tight truncate">{String(a.accountName || '—')}</div>
          {a.secondaryIdentity ? <div className="mt-1 text-xs text-slate-500 truncate">{a.secondaryIdentity}</div> : <div className="mt-1 text-xs text-slate-400">No email</div>}
        </div>
      ),
    },
    {
      id: 'portfolio',
      header: 'PORTFOLIO',
      widthClass: 'w-col180 !pl-2 !pr-2',
      sortable: true,
      sortField: 'totalPremium',
      render: (a) => {
        const mix = Object.entries(a.productMix || {})
          .filter(([, count]) => Number(count) > 0)
          .sort((x, y) => Number(y[1]) - Number(x[1]))
          .slice(0, 3);
        return (
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-semibold text-slate-700">{a.totalPolicies} policies</div>
            <div className="text-xs font-semibold text-slate-600">
              {new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(a.totalPremium || 0)}
            </div>
            <div className="flex items-center gap-1.5">
              {mix.length > 0 ? mix.map(([product]) => (
                <span
                  key={product}
                  title={product}
                  className="inline-flex h-5 w-5 items-center justify-center text-slate-500"
                >
                  {productIconFor(product) === 'CAR' ? (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3.5 14.5v-4.2c0-.7.43-1.33 1.08-1.58l2.9-1.1c.2-.08.4-.12.62-.12h5.86c.2 0 .41.04.61.12l2.9 1.1c.65.25 1.08.88 1.08 1.58v4.2M5.5 14.5h13M7.25 17.25a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM16.75 17.25a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z" />
                    </svg>
                  ) : (
                    <span className="text-[10px] font-black opacity-75">{productIconFor(product)}</span>
                  )}
                </span>
              )) : (
                <span className="text-[11px] text-slate-400">No products</span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      id: 'state',
      header: 'STATUS',
      widthClass: 'w-col150 !pl-0 !pr-2',
      sortable: true,
      sortField: 'state',
      render: (a) => {
        const reason = reasonText(a);
        return (
          <div className="space-y-1 min-w-0">
            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${stateTone(a.state)}`}>
              {stateLabel(a.state)}
            </span>
            {reason ? <div className="text-xs text-slate-600 font-semibold truncate">{reason}</div> : null}
          </div>
        );
      },
    },
    {
      id: 'lastActivityAt',
      header: 'LAST ACTIVITY',
      widthClass: 'w-col150 !pl-[10px] !pr-2',
      sortable: true,
      sortField: 'lastActivityAt',
      render: (a) => {
        const relative = toRelative(a.lastActivityAt);
        return (
          <div className="space-y-1 min-w-0">
            <div className="text-sm font-semibold text-slate-700 truncate">
              {humanizeActivity(a)}
            </div>
            <div className="text-xs text-slate-400">{relative}</div>
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: 'ACTIONS',
      widthClass: 'w-col100 !pl-2',
      render: (a) => (
        <div
          className="flex items-center gap-1.5 text-xs font-semibold"
          onClickCapture={(event) => event.stopPropagation()}
          onMouseDownCapture={(event) => event.stopPropagation()}
        >
          <a
            title="New policy"
            aria-label="New policy"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-slate-600 hover:bg-slate-50"
            href={`/policies/new?accountId=${encodeURIComponent(a.accountId)}&accountName=${encodeURIComponent(String(a.accountName || ''))}&accountEmail=${encodeURIComponent(String(a.secondaryIdentity || ''))}`}
            onClick={(event) => event.stopPropagation()}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            <span className="text-xs font-semibold text-slate-700">New policy</span>
          </a>
        </div>
      ),
    },
  ];
}

