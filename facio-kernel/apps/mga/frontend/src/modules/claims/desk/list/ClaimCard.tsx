import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { BoClaimListItem } from './claimsAdapter';
import { getClaimStatusLabel, humanizeClaimCode } from '../../model/claimDisplayLabels';

/* ── Status colours ── */
const STATUS_TONE: Record<string, { bg: string; dot: string; text: string }> = {
  OPEN:             { bg: 'bg-rose-50',    dot: 'bg-rose-500',    text: 'text-rose-800' },
  REOPENED:         { bg: 'bg-rose-50',    dot: 'bg-rose-500',    text: 'text-rose-800' },
  PENDING:          { bg: 'bg-amber-50',   dot: 'bg-amber-500',   text: 'text-amber-800' },
  CLOSED_THIS_MONTH:{ bg: 'bg-blue-50',    dot: 'bg-blue-400',    text: 'text-blue-700' },
  CLOSED:           { bg: 'bg-slate-50',   dot: 'bg-slate-400',   text: 'text-slate-600' },
  WITHDRAWN:        { bg: 'bg-slate-50',   dot: 'bg-slate-400',   text: 'text-slate-500' },
};
const DEFAULT_TONE = { bg: 'bg-slate-50', dot: 'bg-slate-400', text: 'text-slate-600' };

function statusTone(status?: string) {
  const key = status?.toUpperCase().trim() ?? '';
  return STATUS_TONE[key] ?? DEFAULT_TONE;
}

/* ── Date formatting ── */
function shortDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: '2-digit' });
  } catch { return '—'; }
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
    return days === 1 ? 'yesterday' : `${days}d ago`;
  } catch { return ''; }
}

type ClaimCardProps = {
  claim: BoClaimListItem;
  index: number;
};

export function ClaimCard({ claim, index }: ClaimCardProps) {
  const navigate = useNavigate();
  const tone = statusTone(claim.status);

  return (
    <button
      type="button"
      onClick={() => claim.id && navigate(`/claims/${claim.id}#overview`)}
      className="w-full text-left bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md active:scale-[0.98] transition-all duration-200 p-4 sm:p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary animate-[card-appear_250ms_ease-out_both]"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Row 1: Claim number + status */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-bold text-slate-900 font-mono truncate">{claim.claimNumber || '—'}</p>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${tone.bg} ${tone.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
          {getClaimStatusLabel(claim.status)}
        </span>
      </div>

      {/* Row 2: Policyholder */}
      {claim.policyHolderName && (
        <p className="text-xs text-slate-700 mt-2 truncate font-medium">{claim.policyHolderName}</p>
      )}

      {/* Row 3: Policy number + country */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        {claim.policyNumber && <span className="font-mono">{claim.policyNumber}</span>}
        {claim.lossCountry && <span>· {claim.lossCountry}</span>}
        {claim.causeOfLossCode && <span>· {humanizeClaimCode(claim.causeOfLossCode)}</span>}
      </div>

      {/* Row 4: Incident date + updated */}
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-400">
        <span>Incident {shortDate(claim.incidentDate)}</span>
        {claim.updatedAt && <span className="shrink-0">{relativeTime(claim.updatedAt)}</span>}
      </div>
    </button>
  );
}
