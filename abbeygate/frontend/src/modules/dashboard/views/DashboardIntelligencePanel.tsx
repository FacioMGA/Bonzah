import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import type {
  DashboardIntelligence,
  DashboardTaskGroup,
  DashboardSlaSignal,
} from '@/src/modules/dashboard/model/types';

// ─── Navigation map ───────────────────────────────────────────────────────────
// URL keys MUST match registry.json urlKey values — the RecordList filter parser
// reads exactly these param names. Wrong params = silently ignored = no filter applied.
// Source of truth: frontend/src/products/policies/list/registry.json
const TASK_HREF: Record<DashboardTaskGroup['type'], string> = {
  // attention=yes  → needsAttention filter (attentionScore threshold). urlKey: 'attention'
  // uw_action=yes  → uwActionRequired boolean.                          urlKey: 'uw_action'
  UNDERWRITING: '/policies?attention=yes&uw_action=yes',
  // open_claim=yes → hasOpenClaim boolean.                              urlKey: 'open_claim'
  CLAIMS:       '/policies?open_claim=yes',
  // invoice_overdue=yes → invoiceOverdue boolean.                       urlKey: 'invoice_overdue'
  BILLING:      '/policies?invoice_overdue=yes',
  // cancellation_pending=yes → cancellationPending boolean.             urlKey: 'cancellation_pending'
  OPERATIONS:   '/policies?cancellation_pending=yes',
};

const SLA_HREF: Record<DashboardSlaSignal['key'], string> = {
  INVOICE_OVERDUE:   '/policies?invoice_overdue=yes',
  CLAIM_FNOL_STALE:  '/claims',
  // bo_status=REFERRAL → boStatus enum filter.                          urlKey: 'bo_status'
  UW_REFERRAL_STALE: '/policies?bo_status=REFERRAL',
};

// ─── Operator-friendly SLA labels (no thresholds in UI) ──────────────────────
const SLA_UI_LABEL: Record<DashboardSlaSignal['key'], string> = {
  INVOICE_OVERDUE:   'Overdue invoices',
  CLAIM_FNOL_STALE:  'Claims not started (FNOL missing)',
  UW_REFERRAL_STALE: 'Stuck referrals',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatEUR(n: number | null): string | null {
  if (n === null || !Number.isFinite(n) || n === 0) return null;
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `€${(n / 1_000).toFixed(0)}k`;
  return `€${n.toLocaleString()}`;
}

type SlaStatus = 'on_track' | 'at_risk' | 'overdue';

function slaStatus(signal: DashboardSlaSignal): SlaStatus {
  if (!signal.ready || signal.count === 0) return 'on_track';
  // Priority 1 = critical: any breach is immediately "overdue"
  if (signal.priority === 1) return 'overdue';
  // Priority 2 = warning-level
  if (signal.priority === 2) return 'at_risk';
  return 'at_risk';
}

const SLA_STATUS_LABEL: Record<SlaStatus, string> = {
  on_track: 'On track',
  at_risk:  'At risk',
  overdue:  'Overdue',
};

const SLA_STATUS_STYLE: Record<SlaStatus, string> = {
  on_track: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  at_risk:  'bg-amber-50 text-amber-700 border-amber-200',
  overdue:  'bg-rose-50 text-rose-700 border-rose-200',
};

const SLA_DOT_STYLE: Record<SlaStatus, string> = {
  on_track: 'bg-emerald-400',
  at_risk:  'bg-amber-400',
  overdue:  'bg-rose-500',
};

// ─── Task card urgency styling ────────────────────────────────────────────────
// Count color: red if SLA breaches exist; neutral otherwise
function countColor(group: DashboardTaskGroup): string {
  if (group.slaBreachCount !== null && group.slaBreachCount > 0) return 'text-rose-600';
  if (group.count > 10) return 'text-amber-600';
  return 'text-slate-900';
}

// Fallback text when exposure is zero/null — domain-appropriate, not generic
const EXPOSURE_FALLBACK: Record<DashboardTaskGroup['type'], string> = {
  UNDERWRITING: '—',
  CLAIMS:       'No reserve set',
  BILLING:      'No balance',
  OPERATIONS:   '—',
};

// ─── TaskGroupCard ─────────────────────────────────────────────────────────
function TaskGroupCard({
  group,
  rank,
  onNavigate,
}: {
  group: DashboardTaskGroup;
  rank: number;
  onNavigate: (href: string) => void;
}) {
  const href = TASK_HREF[group.type];
  const hasSla = group.slaBreachCount !== null && group.slaBreachCount > 0;
  const isLead = rank === 0; // highest-count card
  const exposureStr = formatEUR(group.exposureEUR);
  const exposureFallback = EXPOSURE_FALLBACK[group.type];

  return (
    <motion.button
      type="button"
      whileHover={{ y: -2, scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={() => onNavigate(href)}
      className={[
        'w-full text-left rounded-2xl border p-5 transition-all duration-150 cursor-pointer group',
        isLead
          ? 'bg-slate-900 border-slate-800 shadow-lg shadow-slate-200/60'
          : 'bg-white border-slate-200 shadow-sm hover:border-slate-300 hover:shadow-md',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className={[
            'text-[10px] font-black uppercase tracking-[0.15em]',
            isLead ? 'text-slate-400' : 'text-slate-400',
          ].join(' ')}>
            {group.label}
          </p>
          <p className={[
            'mt-1.5 text-4xl font-black tracking-tight leading-none',
            isLead ? 'text-white' : countColor(group),
          ].join(' ')}>
            {group.count.toLocaleString()}
          </p>
        </div>

        {/* SLA breach badge */}
        {hasSla && (
          <span className={[
            'shrink-0 mt-0.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border',
            isLead
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
              : 'bg-rose-50 text-rose-700 border-rose-200',
          ].join(' ')}>
            {group.slaBreachCount} SLA
          </span>
        )}
      </div>

      {/* EUR exposure or "pending" */}
      <div className={[
        'mt-4 pt-3.5 border-t flex items-center justify-between',
        isLead ? 'border-slate-700' : 'border-slate-100',
      ].join(' ')}>
        <span className={[
          'text-[11px] font-semibold',
          isLead ? 'text-slate-400' : 'text-slate-400',
        ].join(' ')}>
          {exposureStr ? `${exposureStr} at risk` : exposureFallback}
        </span>
        <span className={[
          'text-[10px] font-black uppercase tracking-widest transition-colors',
          isLead
            ? 'text-slate-500 group-hover:text-slate-300'
            : 'text-slate-300 group-hover:text-slate-500',
        ].join(' ')}>
          View →
        </span>
      </div>
    </motion.button>
  );
}

// ─── SlaRow ─────────────────────────────────────────────────────────────────
function SlaRow({
  signal,
  onNavigate,
}: {
  signal: DashboardSlaSignal;
  onNavigate: (href: string) => void;
}) {
  const href = SLA_HREF[signal.key];
  const status = slaStatus(signal);
  const label = SLA_UI_LABEL[signal.key];
  const isReady = signal.ready;
  const hasItems = isReady && signal.count > 0;

  return (
    <motion.button
      type="button"
      whileHover={{ x: 2 }}
      onClick={() => (isReady ? onNavigate(href) : undefined)}
      disabled={!isReady}
      className={[
        'w-full text-left flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all duration-150',
        isReady && hasItems
          ? 'bg-white border-slate-200 hover:border-slate-300 cursor-pointer'
          : isReady
            ? 'bg-white border-slate-100 cursor-pointer'
            : 'bg-slate-50 border-slate-100 cursor-default opacity-50',
      ].join(' ')}
    >
      {/* Status dot */}
      <span className={`shrink-0 w-2 h-2 rounded-full ${isReady ? SLA_DOT_STYLE[status] : 'bg-slate-300'}`} />

      {/* Label */}
      <span className="flex-1 text-[12px] font-semibold text-slate-700 text-left truncate">{label}</span>

      {/* Right-side: count or status */}
      {!isReady ? (
        <span className="shrink-0 text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Pending setup
        </span>
      ) : hasItems ? (
        <div className="shrink-0 flex items-center gap-2">
          <span className={`text-[11px] font-bold text-slate-500`}>
            {signal.count} {signal.count === 1 ? 'item' : 'items'}
          </span>
          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${SLA_STATUS_STYLE[status]}`}>
            {SLA_STATUS_LABEL[status]}
          </span>
        </div>
      ) : (
        <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${SLA_STATUS_STYLE.on_track}`}>
          {SLA_STATUS_LABEL.on_track}
        </span>
      )}
    </motion.button>
  );
}

// ─── DashboardIntelligencePanel ──────────────────────────────────────────────
type Props = {
  intelligence: DashboardIntelligence;
};

export function DashboardIntelligencePanel({ intelligence }: Props) {
  const navigate = useNavigate();
  const { tasks, sla, risk } = intelligence;

  // Sort: highest count first → surface the most urgent domain at top-left
  const sortedTasks = [...tasks].sort((a, b) => b.count - a.count);
  // SLA: sort by priority ascending (1 = most critical first)
  const sortedSla = [...sla].sort((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-8">

      {/* ── Action Required ── */}
      <section>
        <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.18em] mb-4">
          Action required
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {sortedTasks.map((group, i) => (
            <TaskGroupCard
              key={group.type}
              group={group}
              rank={i}
              onNavigate={navigate}
            />
          ))}
        </div>
      </section>

      {/* ── SLA + Portfolio (two-col on desktop) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* SLA signals */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.18em] mb-4">
            SLA status
          </h2>
          <div className="space-y-2">
            {sortedSla.map((signal) => (
              <SlaRow key={signal.key} signal={signal} onNavigate={navigate} />
            ))}
          </div>
        </section>

        {/* Portfolio signals */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.18em] mb-4">
            Portfolio signals
          </h2>
          <div className="divide-y divide-slate-100">

            <div className="flex items-center justify-between py-3">
              <span className="text-[12px] font-semibold text-slate-600">Renewals in 30 days</span>
              <span className="text-[13px] font-black text-slate-900">
                {risk.expiringIn30Days.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center justify-between py-3">
              <span className="text-[12px] font-semibold text-slate-600">Open claims reserve</span>
              <span className="text-[13px] font-black text-slate-900">
                {formatEUR(risk.openClaimsReserveEUR) ?? '—'}
              </span>
            </div>

            <div className="flex items-center justify-between py-3">
              <span className="text-[12px] font-semibold text-slate-600">Compliance issues</span>
              <span className={`text-[13px] font-black ${risk.complianceFailCount > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
                {risk.complianceFailCount > 0 ? risk.complianceFailCount.toLocaleString() : 'None'}
              </span>
            </div>

          </div>
        </section>

      </div>
    </div>
  );
}
