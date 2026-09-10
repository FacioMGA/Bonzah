import React from 'react';
import { Button } from '@/src/shared/ui';
import { formatCompanyName, parseDateUI } from '@/src/shared/lib/format';
import type { RecordListColumn } from '@/src/shared/core/recordList/types';
import type { PolicyListItem } from './policiesAdapter';
import { USE_POLICY_STATE } from '../model/policyStateFlag';
import { humanizePolicyStatus } from '../model/policyDisplayLabels';
import {
  ProductIcon,
  ProductRegistry,
  buildPolicyListRowViewModel,
  resolveStepLabel,
  type PolicyListRowViewModel,
} from '@/src/shared/lib/products';
import { selectQuestionnaireFieldMetaByKey } from '@/src/shared/lib/products/questionnaireFromProfile';

/*
 * BO policy list columns.
 *
 * This file is INTENTIONALLY thin: every row cell reads from a canonical
 * `PolicyListRowViewModel` (see `shared/lib/products/policyListRow.ts`) and
 * renders product-agnostic chrome around it. Adding a new product means
 * updating its `ProductManifest` — this file does not change.
 *
 * See the consultant note in the commit message for rationale; tl;dr:
 *
 *   Don't design "travel/home rows". Design a single policy row driven
 *   by a product-specific risk-summary projection.
 */

type UnknownRecord = Record<string, unknown>;

const asRecord = (v: unknown): UnknownRecord =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as UnknownRecord) : {};

const safeJson = (v: unknown): UnknownRecord => {
  if (!v) return {};
  if (typeof v === 'string') {
    try {
      return asRecord(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return asRecord(v);
};

const fmtMoneyShort = (amount: number, currency: string) => {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const c = String(currency || 'EUR').toUpperCase();
  const symbol = c === 'EUR' ? '€' : `${c} `;
  return `${symbol}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const fmtDateShort = (d: unknown) => {
  const dt = d ? new Date(String(d)) : null;
  if (!dt || Number.isNaN(dt.getTime())) return '—';
  const m = dt.toLocaleString(undefined, { month: 'short' });
  const day = dt.getDate();
  const yy = String(dt.getFullYear()).slice(-2);
  return `${m} ${day} ’${yy}`;
};

const fmtRelativeShort = (d: unknown) => {
  const dt = d ? new Date(String(d)) : null;
  if (!dt || Number.isNaN(dt.getTime())) return '';
  const diffMs = dt.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (abs < hour) return rtf.format(Math.round(diffMs / minute), 'minute');
  if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
  if (abs < week) return rtf.format(Math.round(diffMs / day), 'day');
  if (abs < month) return rtf.format(Math.round(diffMs / week), 'week');
  if (abs < year) return rtf.format(Math.round(diffMs / month), 'month');
  return rtf.format(Math.round(diffMs / year), 'year');
};

const humanizeFieldKey = (productType: string | undefined, fieldKey: string): string => {
  const metaByKey = selectQuestionnaireFieldMetaByKey(productType);
  const meta = asRecord(metaByKey[fieldKey]);
  const label = String(meta.label || meta.title || '').trim();
  if (label) return label;
  const last = String(fieldKey || '').split('.').filter(Boolean).pop() || fieldKey;
  return last.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};

const answerText = (answer: unknown): string => {
  const text = String(answer ?? '').trim();
  return text || 'Not captured';
};

const calcPeriodProgress = (start: unknown, end: unknown) => {
  const s = start ? new Date(String(start)).getTime() : NaN;
  const e = end ? new Date(String(end)).getTime() : NaN;
  const now = Date.now();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return { pct: 0, state: 'unknown' as const };
  if (now < s) return { pct: 0, state: 'future' as const };
  if (now > e) return { pct: 100, state: 'expired' as const };
  return { pct: Math.max(0, Math.min(100, ((now - s) / (e - s)) * 100)), state: 'active' as const };
};

const renderProductIcon = (iconKey: string) => <ProductIcon iconKey={iconKey || 'generic'} />;

const renderStatusDot = (statusRaw: string) => {
  const s = String(statusRaw || '').toUpperCase();
  let fill = '#94a3b8'; // slate-400
  if (['ACTIVE', 'ISSUED'].includes(s)) fill = '#16a34a'; // green-600
  else if (['REFERRAL', 'INFO_REQUIRED', 'CANCELLATION_REQUESTED'].includes(s)) fill = '#d97706'; // amber-600
  else if (['QUOTED', 'QUOTE', 'AWAITING_PAYMENT', 'BOUND', 'BOUND_DRAFT_ISSUED'].includes(s)) fill = '#2563eb'; // blue-600
  else if (['DECLINED', 'CANCELLED', 'CANCELED'].includes(s)) fill = '#dc2626'; // red-600
  else if (['EXPIRED'].includes(s)) fill = '#ef4444'; // red-500
  return (
    <svg className="w-3 h-3" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="5" fill={fill} opacity="0.9" />
    </svg>
  );
};

/**
 * Lifecycle label: the VM carries a normalised `rawStatus`; we overlay
 * start/end date awareness so an ISSUED policy transitions into ACTIVE
 * once its inception has passed, EXPIRED once its term has ended, etc.
 */
function deriveLifecycleLabel(vm: PolicyListRowViewModel): string {
  const base = vm.status.rawStatus;
  const startD = vm.coverage.startDate ? parseDateUI(vm.coverage.startDate) : null;
  const endD = vm.coverage.endDate ? parseDateUI(vm.coverage.endDate) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (['ISSUED', 'ACTIVE'].includes(base) && (startD || endD)) {
    const s = startD ? new Date(startD) : null;
    const e = endD ? new Date(endD) : null;
    if (s) s.setHours(0, 0, 0, 0);
    if (e) e.setHours(0, 0, 0, 0);
    if (e && today > e) return 'EXPIRED';
    if (s && today < s) return 'ISSUED';
    if (s && (!e || (today >= s && today <= e))) return 'ACTIVE';
  }
  return base;
}

function statusSubLabel(p: PolicyListItem, statusRaw: string): string | null {
  const s = String(statusRaw || '').toUpperCase();
  const pRec = asRecord(p);
  const snap = safeJson(pRec?.stateSnapshot);
  const flow = asRecord(snap?.flow_context)?.step || snap?.step || null;
  const manifest = ProductRegistry.get(p.productType);
  const mapStep = (k: string) => {
    const fromManifest = resolveStepLabel(manifest, String(k || ''));
    if (fromManifest) return fromManifest;
    const x = String(k || '').toLowerCase().replace(/_/g, '-');
    if (x === 'your-quote' || x === 'quote') return 'Quote';
    if (x === 'payment') return 'Payment';
    return null;
  };
  if (s === 'INTAKE') return mapStep(String(flow || '')) || 'In progress';
  if (s === 'DRAFT') return 'Not submitted';
  if (s === 'REFERRAL') return 'Awaiting UW';
  if (s === 'INFO_REQUIRED') return 'Customer action';
  if (s === 'AWAITING_PAYMENT') return 'Quote accepted';
  if (s === 'QUOTED' || s === 'QUOTE') return 'Offer ready';
  if (s === 'CANCELLATION_REQUESTED') return 'Ops queue';
  const uw = asRecord(snap?.uwDecision || asRecord(snap?.quoteResponse)?.uwDecision);
  const reasons = Array.isArray(uw?.reasons) ? uw.reasons : [];
  if ((s === 'DECLINED' || s === 'REFERRAL') && reasons.length) return String(reasons[0]);
  return null;
}

function PendingProductCell() {
  return (
    <div className="min-w-col260">
      <div className="flex items-center gap-2">
        {renderProductIcon('generic')}
        <div className="font-extrabold text-slate-900 tracking-tight">
          New Submission
        </div>
      </div>
      <div className="mt-1 text-xs text-slate-400 font-semibold">
        Product not selected
      </div>
    </div>
  );
}

function PendingCoverageCell() {
  return (
    <div className="max-w-col180">
      <div className="text-sm font-bold text-slate-700 truncate mb-1">No coverage configured</div>
      <div className="text-xs text-slate-500 font-semibold truncate">—</div>
    </div>
  );
}

function PendingStatusCell() {
  return (
    <div className="w-full">
      <div className="flex items-center gap-2">
        {renderStatusDot('DRAFT')}
        <div className="text-sm font-black text-slate-800 truncate">Draft</div>
      </div>
      <div className="mt-0.5 text-xs text-slate-500 font-semibold truncate">Not submitted</div>
    </div>
  );
}

function ReferralCell({ policy }: { policy: PolicyListItem }) {
  const summary = policy.referralSummary;
  const status = String(policy.status || policy.bo_status || '').toUpperCase();
  if (!summary && status !== 'REFERRAL' && !policy.uwActionRequired) {
    return <div className="text-xs font-semibold text-slate-300">—</div>;
  }

  const reason = String(summary?.reason || 'Referral required').trim();
  const explanation = String(summary?.explanation || '').trim();
  const fields = (summary?.fields || []).slice(0, 2);
  const href = String(summary?.clientLink || '').trim();

  return (
    <div className="max-w-col260">
      <div className="text-sm font-black text-slate-800 truncate" title={reason}>
        {reason}
      </div>
      {explanation ? (
        <div className="mt-0.5 text-xs font-semibold text-slate-500 truncate" title={explanation}>
          {explanation}
        </div>
      ) : null}
      {fields.length > 0 ? (
        <div className="mt-2 space-y-1">
          {fields.map((field) => {
            const label = humanizeFieldKey(policy.productType, field.key);
            const answer = answerText(field.answer);
            return (
              <div key={field.key} className="text-[11px] leading-tight">
                <span className="font-black text-slate-500">{label}: </span>
                <span className="font-semibold text-slate-600">{answer}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-1 text-[11px] font-semibold text-slate-400">No trigger fields captured</div>
      )}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="mt-2 inline-flex text-[10px] font-black uppercase tracking-widest text-brand-primary hover:underline"
        >
          Client link
        </a>
      ) : null}
    </div>
  );
}

export function createPolicyColumns(opts: {
  onRequestDeletePolicy?: (e: React.MouseEvent, id: string) => void;
}): Array<RecordListColumn<PolicyListItem>> {
  const { onRequestDeletePolicy } = opts;

  return [
    {
      id: 'insured',
      header: 'INSURED',
      widthClass: 'w-col200',
      render: (p) => {
        const vm = buildPolicyListRowViewModel(p);
        if (!vm) return PendingProductCell();
        const { riskSummary, product } = vm;
        return (
          <div className="w-full">
            <div className="flex items-center gap-2">
              {renderProductIcon(product.iconKey)}
              <div className="font-extrabold text-slate-900 tracking-tight truncate">
                {riskSummary.title}
              </div>
            </div>
            {riskSummary.subtitle && (
              <div className="mt-1 text-xs text-slate-500 font-semibold truncate">{riskSummary.subtitle}</div>
            )}
            {riskSummary.detail && (
              <div className="mt-0.5 text-xs text-slate-500 font-semibold truncate">{riskSummary.detail}</div>
            )}
          </div>
        );
      },
    },
    {
      id: 'policyholder',
      header: 'POLICYHOLDER',
      widthClass: 'w-col200',
      render: (p) => {
        const vm = buildPolicyListRowViewModel(p);
        const ph = vm?.policyholder ?? {
          name: String(p?.name || '—'),
          email: p.policyholderEmail ? String(p.policyholderEmail) : undefined,
          phone: p.policyholderPhone ? String(p.policyholderPhone) : undefined,
        };
        return (
          <div className="max-w-col260">
            <div className="flex items-center gap-2">
              <div className="font-bold text-slate-700 truncate">{formatCompanyName(ph.name)}</div>
            </div>
            {ph.email && <div className="mt-1 text-xs text-slate-500 font-semibold truncate">{ph.email}</div>}
            {ph.phone && <div className="mt-0.5 text-xs text-slate-500 font-semibold truncate">{ph.phone}</div>}
          </div>
        );
      },
    },
    {
      id: 'coverage',
      header: 'COVERAGE',
      sortable: true,
      sortField: 'inceptionDate',
      widthClass: 'w-col180',
      render: (p) => {
        const vm = buildPolicyListRowViewModel(p);
        if (!vm) return <PendingCoverageCell />;
        const startDate = vm?.coverage.startDate ?? (p.start && p.start !== 'N/A' ? p.start : undefined);
        const endDate = vm?.coverage.endDate ?? (p.end && p.end !== 'N/A' ? p.end : undefined);
        const prog = calcPeriodProgress(startDate, endDate);
        const barTone = prog.state === 'expired' ? 'bg-red-200' : prog.state === 'active' ? 'bg-emerald-200' : 'bg-slate-200';
        const markerTone = prog.state === 'expired' ? 'bg-red-500' : prog.state === 'active' ? 'bg-emerald-600' : 'bg-slate-400';
        return (
          <div className="max-w-col180">
            {vm?.coverage.name && (
              <div className="text-sm font-bold text-slate-700 truncate mb-1">{vm.coverage.name}</div>
            )}
            {vm?.coverage.details && (
              <div className="text-xs text-slate-500 font-semibold truncate mb-1">{vm.coverage.details}</div>
            )}
            <div className="text-xs font-bold text-slate-600">
              <span className="inline-flex items-center gap-1">{fmtDateShort(startDate)} → {fmtDateShort(endDate)}</span>
            </div>
            <div className="mt-2 relative h-2 w-[110px] rounded-full bg-slate-100 overflow-hidden">
              <div className={`absolute left-0 top-0 h-full ${barTone}`} style={{ width: `${prog.pct}%` }} />
              <div className={`absolute top-0 h-full w-[2px] ${markerTone}`} style={{ left: `${prog.pct}%` }} />
            </div>
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'STATUS',
      sortable: true,
      sortField: USE_POLICY_STATE ? 'bo_statusSortRank' : 'statusSortRank',
      widthClass: 'w-col140',
      render: (p) => {
        const vm = buildPolicyListRowViewModel(p);
        if (!vm) return <PendingStatusCell />;
        const lifecycle = vm ? deriveLifecycleLabel(vm) : 'DRAFT';
        const sub = statusSubLabel(p, lifecycle);
        const businessId = (vm?.status.policyNumber || String(p.policyNumber || '').trim()) || '—';
        return (
          <div className="w-full">
            <div className="flex items-center gap-2">
              {renderStatusDot(lifecycle)}
              <div className="text-sm font-black text-slate-800 truncate">{humanizePolicyStatus(lifecycle)}</div>
            </div>
            {sub && <div className="mt-0.5 text-xs text-slate-500 font-semibold truncate" title={sub}>{sub}</div>}
            <div className="mt-1 text-[10px] font-black text-slate-300 whitespace-nowrap">{businessId}</div>
          </div>
        );
      },
    },
    {
      id: 'referral',
      header: 'REFERRAL',
      widthClass: 'w-col260',
      render: (p) => <ReferralCell policy={p} />,
    },
    {
      id: 'premium',
      header: 'PREMIUM',
      sortable: true,
      sortField: 'totalPremium',
      widthClass: 'w-col100 text-left',
      render: (p) => {
        const vm = buildPolicyListRowViewModel(p);
        const amount = vm?.premium.amount ?? Number(p.premium || 0);
        const currency = vm?.premium.currency ?? String(p.currency || 'EUR');
        return (
          <div className="text-left font-black text-slate-900 tracking-tight text-base whitespace-nowrap">
            {fmtMoneyShort(amount, currency)}
          </div>
        );
      },
    },
    {
      id: 'lastActivity',
      header: 'LAST ACTIVITY',
      sortable: true,
      sortField: 'lastActivityAt',
      widthClass: 'w-col170 text-left',
      render: (p) => {
        const vm = buildPolicyListRowViewModel(p);
        const createdAt = (vm?.dates.createdAt ?? p.createdAt) ? new Date(String(vm?.dates.createdAt ?? p.createdAt)) : null;
        const lastActivityStr = vm?.dates.lastActivityAt ?? p.updatedAt ?? p.createdAt;
        const activity = lastActivityStr ? new Date(String(lastActivityStr)) : null;
        const activityRelative = fmtRelativeShort(activity);

        return (
          <div className="flex items-center justify-start">
            <div className="flex flex-col items-start gap-0.5">
              <div className="text-[13px] font-semibold text-slate-700 whitespace-nowrap" title={activity ? activity.toLocaleString() : 'No activity date'}>
                {fmtDateShort(activity)}
              </div>
              {activityRelative && (
                <div className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">{activityRelative}</div>
              )}
              {createdAt && (
                <div className="text-[10px] font-semibold text-slate-400 whitespace-nowrap" title={`Created: ${createdAt.toLocaleString()}`}>
                  Created {fmtDateShort(createdAt)}
                </div>
              )}
            </div>

            {onRequestDeletePolicy && (
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => onRequestDeletePolicy(e, String(p.id))}
                  className="text-slate-300 hover:text-red-500 hover:bg-red-50 p-2 rounded-lg transition-all bg-transparent"
                  title="Remove Policy"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </Button>
              </div>
            )}
          </div>
        );
      },
    },
  ];
}
