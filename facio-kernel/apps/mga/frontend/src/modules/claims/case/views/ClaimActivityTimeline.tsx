import React, { useEffect, useMemo, useState } from 'react';
import { formatDateUI } from '@/src/shared/lib/format';

type TimelineEvent = {
  id: string;
  eventType: string;
  occurredAt: string;
  actorName?: string;
  payload?: Record<string, unknown>;
};

type Props = {
  events: TimelineEvent[];
  emptyMessage?: string;
  className?: string;
  compact?: boolean;
  highlightVersion?: number;
};

function normalizeEventLabel(eventType: string): string {
  const map: Record<string, string> = {
    FNOL_SUBMITTED: 'Intake submitted',
    FNOL_CONFIRMED: 'Intake confirmed',
    FNOL_AMENDED: 'Intake updated',
    POLICY_LINKED: 'Policy linked',
    RESERVE_SET: 'Reserve set',
    RESERVE_ADJ: 'Reserve adjusted',
    PAYMENT_ADDED: 'Payment recorded',
    RECOVERY_RECEIVED: 'Recovery received',
    RECOVERY_EXPECTED: 'Recovery expected',
    APPOINTMENT_CREATED: 'Appointment created',
    CLAIM_DENIED: 'Claim denied',
    DENIAL_COMMUNICATION_REQUIRED: 'Denial letter required',
    CLAIM_NOTE_ADDED: 'Note added',
    CLAIM_EVIDENCE_ADDED: 'Evidence added',
    CLAIM_INFO_REQUESTED: 'Information requested',
    CLAIM_CLOSED: 'Claim closed',
    CLAIM_REOPENED: 'Claim re-opened',
    ASSIGN_HANDLER: 'Handler assigned',
    LOG_COMMUNICATION_SENT: 'Communication sent',
    LOG_COMMUNICATION_RECEIVED: 'Communication received',
    FNOL_LINK_SENT: 'FNOL link sent',
    DOCUMENT_UPLOADED: 'Document uploaded',
  };
  const key = String(eventType || '').trim().toUpperCase();
  return map[key] || key.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function amountText(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return `€${Math.abs(num).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function bucketLabel(raw: unknown): string {
  const key = asText(raw).toUpperCase();
  const map: Record<string, string> = {
    INDEMNITY: 'Indemnity',
    DEFENCE_COSTS: 'Defence costs',
    ADJUSTER_FEES: 'Adjuster fees',
    LEGAL_FEES: 'Legal fees',
    OTHER: 'Other expenses',
  };
  return map[key] || key.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function costSubTypeLabel(raw: unknown, costCategory?: unknown): string {
  const key = asText(raw).toUpperCase();
  const map: Record<string, string> = {
    EXPENSE: 'Expense',
    ATTORNEY_COVERAGE_FEE: 'Attorney coverage fee',
    ADJUSTER_FEE: 'Adjuster fee',
    DEFENCE_FEE: 'Defence fee',
    TPA_FEE: 'TPA fee',
  };
  if (key === 'OTHER') {
    return asText(costCategory).toUpperCase() === 'FEES' ? 'Other fee' : 'Indemnity';
  }
  return map[key] || key.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function payeeRoleLabel(raw: unknown): string {
  const key = asText(raw).toUpperCase();
  const map: Record<string, string> = {
    INSURED: 'Insured',
    CLAIMANT: 'Claimant',
    THIRD_PARTY: 'Third party',
    REPAIRER: 'Repairer',
    LEGAL_PROVIDER: 'Legal provider',
    ADJUSTER: 'Adjuster',
    EXPERT: 'Expert',
    TPA: 'TPA',
    MEDICAL_PROVIDER: 'Medical provider',
    VENDOR: 'Vendor',
    OTHER: 'Other',
  };
  return map[key] || key.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function denialReasonLabel(raw: unknown): string {
  const key = asText(raw).toUpperCase();
  return key.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function buildTimelineLines(event: TimelineEvent): { title: string; summary: string; note: string } {
  const eventType = asText(event.eventType).toUpperCase();
  const payload = event.payload || {};
  const titleBase = normalizeEventLabel(event.eventType);

  if (eventType === 'RESERVE_SET') {
    const bucket = bucketLabel(payload.bucket);
    const amount = amountText(payload.newOutstandingAmount ?? payload.amount ?? payload.outstanding);
    return {
      title: 'Reserve set',
      summary: [bucket, amount ? `reserve set to ${amount}` : 'reserve updated'].join(' '),
      note: asText(payload.explanation || payload.note || payload.reason),
    };
  }

  if (eventType === 'RESERVE_ADJ') {
    const bucket = bucketLabel(payload.bucket);
    const delta = Number(payload.deltaAmount ?? payload.amount ?? 0);
    const direction = delta >= 0 ? 'increased by' : 'decreased by';
    const amount = amountText(delta);
    return {
      title: 'Reserve adjusted',
      summary: [bucket, 'reserve', direction, amount].filter(Boolean).join(' '),
      note: asText(payload.explanation || payload.note || payload.reason),
    };
  }

  if (eventType === 'PAYMENT_ADDED') {
    const classification = costSubTypeLabel(payload.costSubType || payload.bucket, payload.costCategory);
    const paymentType = asText(payload.paymentType).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    const amount = amountText(payload.amount);
    const payeeName = asText(payload.payeeName || payload.payee || payload.payeeType);
    const payeeRole = payeeRoleLabel(payload.payeeRoleUsed);
    const payeeSummary = [payeeName, payeeRole && payeeRole !== payeeName ? payeeRole : ''].filter(Boolean).join(' - ');
    return {
      title: 'Payment issued',
      summary: [classification, paymentType, amount ? `· ${amount}` : '', payeeSummary ? `to ${payeeSummary}` : ''].filter(Boolean).join(' · ').replace(' · to ', ' to '),
      note: asText(payload.explanation || payload.note || payload.reason),
    };
  }

  if (eventType === 'RECOVERY_EXPECTED' || eventType === 'RECOVERY_RECEIVED') {
    const bucket = bucketLabel(payload.bucket);
    const amount = amountText(payload.amount);
    const source = asText(payload.recoveryType || payload.source).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    return {
      title: eventType === 'RECOVERY_EXPECTED' ? 'Recovery expected' : 'Recovery received',
      summary: [bucket, amount, source ? `Source: ${source}` : ''].filter(Boolean).join(' · '),
      note: asText(payload.explanation || payload.note || payload.reason),
    };
  }

  if (eventType === 'APPOINTMENT_CREATED') {
    const appointeeType = asText(payload.appointeeType).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    return {
      title: appointeeType ? `${appointeeType} appointed` : 'Appointment created',
      summary: asText(payload.appointee),
      note: asText(payload.instruction || payload.note || payload.reason),
    };
  }

  if (eventType === 'CLAIM_DENIED') {
    return {
      title: 'Claim denied',
      summary: asText(payload.denialReason || payload.reason)
        ? `Reason: ${denialReasonLabel(payload.denialReason || payload.reason)}`
        : '',
      note: asText(payload.summary || payload.note),
    };
  }

  if (eventType === 'CLAIM_CLOSED') {
    return {
      title: 'Claim closed',
      summary: asText(payload.closureReason || payload.reason)
        ? `Reason: ${denialReasonLabel(payload.closureReason || payload.reason)}`
        : '',
      note: asText(payload.summary || payload.note),
    };
  }

  if (eventType === 'CLAIM_REOPENED') {
    return {
      title: 'Claim reopened',
      summary: asText(payload.reopenReason || payload.reason)
        ? `Reason: ${denialReasonLabel(payload.reopenReason || payload.reason)}`
        : '',
      note: asText(payload.summary || payload.note),
    };
  }

  if (eventType === 'CLAIM_NOTE_ADDED') {
    return {
      title: 'Note added',
      summary: 'Internal note',
      note: asText(payload.note || payload.summary || payload.message),
    };
  }

  if (eventType === 'CLAIM_EVIDENCE_ADDED') {
    const docType = asText(payload.documentType).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    const fileName = asText(payload.originalFilename || payload.fileName || payload.name);
    return {
      title: 'Evidence added',
      summary: [docType, fileName].filter(Boolean).join(' · '),
      note: asText(payload.note || payload.summary),
    };
  }

  if (eventType === 'CLAIM_INFO_REQUESTED') {
    const recipient = asText(payload.recipient);
    const deliveryStatus = asText(payload.deliveryStatus).toLowerCase();
    return {
      title: 'Information requested',
      summary: [recipient ? `Sent to ${recipient}` : '', deliveryStatus ? `Status: ${deliveryStatus}` : '']
        .filter(Boolean)
        .join(' · '),
      note: asText(payload.message),
    };
  }

  return {
    title: titleBase,
    summary: asText(payload.appointee || payload.summary || payload.message || payload.reason || payload.note),
    note: '',
  };
}

export function ClaimActivityTimeline(props: Props) {
  const {
    events,
    emptyMessage = 'No activity has been recorded yet.',
    className = '',
    compact = false,
    highlightVersion = 0,
  } = props;
  const [highlightedEventId, setHighlightedEventId] = useState('');
  const ordered = useMemo(() => {
    return [...(events || [])].sort((a, b) => {
      const aTs = new Date(String(a.occurredAt || '')).getTime();
      const bTs = new Date(String(b.occurredAt || '')).getTime();
      return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
    });
  }, [events]);

  useEffect(() => {
    if (!highlightVersion || !ordered[0]?.id) return;
    const id = ordered[0].id;
    setHighlightedEventId(id);
    const timer = window.setTimeout(() => {
      setHighlightedEventId((current) => (current === id ? '' : current));
    }, 1900);
    return () => window.clearTimeout(timer);
  }, [highlightVersion, ordered]);

  if (ordered.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm font-semibold text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <section className={`relative ${className}`}>
      <div className="absolute left-[7px] top-1 bottom-1 w-px bg-slate-200" />
      <div className="space-y-0.5">
        {ordered.map((event) => {
          const lines = buildTimelineLines(event);
          const actorLine = `By ${asText(event.actorName) || 'System'} · ${event.occurredAt ? formatDateUI(event.occurredAt, { withTime: true }) : '—'}`;
          const isHighlighted = event.id === highlightedEventId;
          return (
            <article
              key={event.id}
              className={`claim-tl-item relative overflow-hidden pl-7 rounded-xl transition-all duration-500 ${compact ? 'py-1.5' : 'py-2.5'} ${
                isHighlighted ? 'claim-tl-item-highlight -translate-y-[1px]' : 'bg-transparent'
              }`}
            >
              <span className={`claim-tl-item-aura ${isHighlighted ? 'opacity-100' : 'opacity-0'}`} />
              <span className="absolute left-0 top-3 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white ring-2 ring-slate-200">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
              </span>
              <div className={`${compact ? 'text-xs' : 'text-sm'} font-black text-slate-900 ${isHighlighted ? 'text-brand-primary' : ''}`}>
                {lines.title}
              </div>
              {lines.summary ? (
                <div className={`${compact ? 'text-[11px]' : 'text-xs'} font-medium text-slate-500`}>
                  {lines.summary}
                </div>
              ) : null}
              <div className="mt-0.5 text-[11px] font-medium text-slate-400">
                {actorLine}
              </div>
              {lines.note ? (
                <div className={`${compact ? 'text-[11px]' : 'text-xs'} mt-1 font-medium text-slate-600`}>
                  {lines.note}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

