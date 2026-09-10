import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoneyUI, type CurrencyCode } from '@/src/shared/lib/format';
import { ProductRegistry, buildRiskIdentityFromManifest } from '@/src/shared/lib/products';

export type PolicyCardRow = {
  id: string;
  policyId?: string;
  policyNumber?: string;
  productType?: string;
  name?: string;
  insuredName?: string;
  status?: string;
  start?: string;
  end?: string;
  updatedAt?: string;
  premium?: number;
  currency?: string;
  totalPremium?: number;
  quoteData?: Record<string, unknown>;
};

/* ── Status colours ── */
const STATUS_TONE: Record<string, { bg: string; dot: string; text: string }> = {
  Issued:    { bg: 'bg-emerald-50', dot: 'bg-emerald-500', text: 'text-emerald-800' },
  Bound:     { bg: 'bg-emerald-50', dot: 'bg-emerald-500', text: 'text-emerald-800' },
  Active:    { bg: 'bg-emerald-50', dot: 'bg-emerald-500', text: 'text-emerald-800' },
  Submitted: { bg: 'bg-blue-50',    dot: 'bg-blue-500',    text: 'text-blue-800' },
  Quoted:    { bg: 'bg-blue-50',    dot: 'bg-blue-500',    text: 'text-blue-800' },
  Referral:  { bg: 'bg-amber-50',   dot: 'bg-amber-500',   text: 'text-amber-800' },
  Draft:     { bg: 'bg-slate-50',   dot: 'bg-slate-400',   text: 'text-slate-600' },
  Expired:   { bg: 'bg-amber-50',   dot: 'bg-amber-500',   text: 'text-amber-800' },
  Cancelled: { bg: 'bg-rose-50',    dot: 'bg-rose-500',    text: 'text-rose-800' },
  Declined:  { bg: 'bg-rose-50',    dot: 'bg-rose-500',    text: 'text-rose-800' },
};
const DEFAULT_TONE = { bg: 'bg-slate-50', dot: 'bg-slate-400', text: 'text-slate-600' };

function statusTone(status?: string) {
  if (!status) return DEFAULT_TONE;
  const titleCased = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  return STATUS_TONE[status] ?? STATUS_TONE[titleCased] ?? DEFAULT_TONE;
}

function shortDate(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: '2-digit' });
  } catch {
    return '—';
  }
}

function relativeTime(iso?: string): string {
  if (!iso) return '';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    return shortDate(iso);
  } catch {
    return '';
  }
}

/* ── Product summary via manifest ── */
function productLines(p: PolicyCardRow): { title: string | null; subtitle: string | null } {
  const manifest = ProductRegistry.get(p.productType);
  if (!manifest) {
    return {
      title: p.insuredName || p.name || null,
      subtitle: null,
    };
  }
  const source = p.quoteData || {};
  const identity = buildRiskIdentityFromManifest(manifest, source);
  return {
    title: identity.primary || p.insuredName || p.name || manifest.insuredObject.label.singular,
    subtitle: identity.secondary || null,
  };
}

type PolicyCardProps = {
  policy: PolicyCardRow;
  index: number;
};

export function PolicyCard({ policy, index }: PolicyCardProps) {
  const navigate = useNavigate();
  const p = policy;
  const tone = statusTone(p.status);
  const { title, subtitle } = productLines(p);
  const currency = (p.currency || 'EUR') as CurrencyCode;
  const premiumText = p.totalPremium != null
    ? formatMoneyUI(p.totalPremium, currency, { showCode: false })
    : p.premium != null
      ? formatMoneyUI(p.premium, currency, { showCode: false })
      : null;

  return (
    <button
      type="button"
      onClick={() => p.id && navigate(`/policies/${p.id}`)}
      className="w-full text-left bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md active:scale-[0.98] transition-all duration-200 p-4 sm:p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary animate-[card-appear_250ms_ease-out_both]"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Row 1: Product title + Premium */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900 truncate">
            {title || '—'}
          </p>
          {subtitle && (
            <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
        {premiumText && (
          <span className="text-sm font-extrabold text-slate-800 tabular-nums shrink-0">
            {premiumText}
          </span>
        )}
      </div>

      {/* Row 2: Policyholder */}
      {(p.insuredName || p.name) && title && (
        <p className="text-xs text-slate-600 mt-2 truncate">{p.insuredName || p.name}</p>
      )}

      {/* Row 3: Product + Dates */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        {p.productType && <span className="font-medium">{p.productType}</span>}
        {(p.start || p.end) && (
          <span>
            {shortDate(p.start)} → {shortDate(p.end)}
          </span>
        )}
      </div>

      {/* Row 4: Status + Policy Number + Activity */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${tone.bg} ${tone.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
            {p.status || 'Unknown'}
          </span>
          {p.policyNumber && (
            <span className="text-[11px] text-slate-400 font-mono">{p.policyNumber}</span>
          )}
        </div>
        {p.updatedAt && (
          <span className="text-[10px] text-slate-400 shrink-0">{relativeTime(p.updatedAt)}</span>
        )}
      </div>
    </button>
  );
}
