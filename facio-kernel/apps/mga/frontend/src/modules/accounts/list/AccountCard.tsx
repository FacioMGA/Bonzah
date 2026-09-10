import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { BoAccountListItem } from './accountsAdapter';

const STATE_TONE: Record<string, { bg: string; dot: string; text: string; label: string }> = {
  PAYMENT_ISSUE: { bg: 'bg-rose-50', dot: 'bg-rose-500', text: 'text-rose-800', label: 'Payment issue' },
  CLAIM: { bg: 'bg-amber-50', dot: 'bg-amber-500', text: 'text-amber-800', label: 'Claim' },
  RENEWAL: { bg: 'bg-indigo-50', dot: 'bg-indigo-500', text: 'text-indigo-800', label: 'Renewal' },
  HEALTHY: { bg: 'bg-emerald-50', dot: 'bg-emerald-500', text: 'text-emerald-800', label: 'Active' },
};

/* ── Date formatting ── */
function relativeTime(iso?: string | null): string {
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
    return new Date(iso).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: '2-digit' });
  } catch {
    return '';
  }
}

type AccountCardProps = {
  account: BoAccountListItem;
  index: number;
};

export function AccountCard({ account, index }: AccountCardProps) {
  const navigate = useNavigate();
  const alertTone = STATE_TONE[account.state];

  const reason = account.overdueAmount > 0
    ? 'Overdue invoice'
    : account.failedPaymentsCount > 0
      ? 'Failed payment'
      : account.openClaimsCount > 0
        ? 'Open claim'
        : account.nextRenewalAt
          ? 'Renewal in <30 days'
          : 'No issues';

  return (
    <button
      type="button"
      onClick={() => account.accountId && navigate(`/accounts/${account.accountId}`)}
      className="w-full text-left bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md active:scale-[0.98] transition-all duration-200 p-4 sm:p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary animate-[card-appear_250ms_ease-out_both]"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Row 1: Name */}
      <p className="text-sm font-bold text-slate-900 truncate">{account.accountName || '—'}</p>

      {/* Row 2: Contact (email / secondary identity) */}
      {account.secondaryIdentity && (
        <p className="text-xs text-slate-500 mt-0.5 truncate">{account.secondaryIdentity}</p>
      )}

      {/* Row 3: Stats */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>{account.totalPolicies} {account.totalPolicies === 1 ? 'policy' : 'policies'}</span>
        <span className="font-semibold text-slate-700">
          {new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(account.totalPremium || 0)}
        </span>
        {account.openClaimsCount > 0 && (
          <span className="text-amber-600 font-medium">{account.openClaimsCount} open claim{account.openClaimsCount !== 1 ? 's' : ''}</span>
        )}
        {account.overdueAmount > 0 && (
          <span className="text-rose-600 font-medium">Overdue balance</span>
        )}
        {account.nextRenewalAt && (
          <span className="text-blue-600 font-medium">Renewal soon</span>
        )}
      </div>

      {/* Row 4: Alert badge (only for ATTENTION/AT_RISK) + last activity */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${alertTone.bg} ${alertTone.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${alertTone.dot}`} />
          {alertTone.label}
        </span>
        <span className="text-[10px] text-slate-400">{reason}</span>
        {account.lastActivityAt && (
          <span className="text-[10px] text-slate-400 shrink-0">{relativeTime(account.lastActivityAt)}</span>
        )}
      </div>
    </button>
  );
}
