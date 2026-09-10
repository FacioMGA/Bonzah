import React, { useMemo, useState } from 'react';
import type { DevelopmentType, Worksheet } from '../model/worksheetTypes';
import { Button } from '@/src/shared/ui';
import { ClaimActivityTimeline } from './ClaimActivityTimeline';
import { ClaimMemoryCopilotCard } from './ClaimMemoryCopilotCard';

type Props = {
  worksheet: Worksheet;
  onOpenIntakeEditor: () => void;
  onOpenIntakeDetails: () => void;
  onConfirmIntake: () => void;
  onOpenClarification: () => void;
  onResendFnolLink: () => void;
  onOpenLinkPolicy: () => void;
  onOpenCaseRequestInfo: () => void;
  onOpenActivity: (template?: DevelopmentType) => void;
  onOpenPolicy: () => void;
  coverageRows?: Array<{ coverage: string; limit: string; excess: string }>;
  busy: boolean;
};

type CaseIntakeDraft = NonNullable<Worksheet['case']>['intakeDraft'];
type CaseInfoRequest = NonNullable<NonNullable<Worksheet['case']>['infoRequests']>[number];

function joinTextParts(...parts: Array<string | undefined>): string {
  return parts.filter((part) => Boolean(String(part || '').trim())).join(', ');
}

export function formatCaseIntakeDraftLocation(draft?: CaseIntakeDraft | null): string {
  const location = String(draft?.location || '').trim();
  const address = String(draft?.locationDetails?.address || '').trim();
  const city = String(draft?.locationDetails?.city || '').trim();
  return joinTextParts(address || location, city) || location || '—';
}

export function buildUnknownPolicyOverviewFields(args: {
  draft?: CaseIntakeDraft | null;
  formatDate: (value?: string) => string;
}) {
  const draft = args.draft || null;
  const fields = [
    { label: 'Reported by', value: String(draft?.reporterType || '').trim() || '—' },
    { label: 'Contact name', value: String(draft?.contactName || '').trim() || '—' },
    { label: 'Contact phone', value: String(draft?.contactPhone || '').trim() || '—' },
    { label: 'Contact email', value: String(draft?.contactEmail || '').trim() || '—' },
    { label: 'Short description', value: String(draft?.shortDescription || '').trim() || '—' },
    { label: 'Date', value: args.formatDate(String(draft?.dateOfLoss || '').trim()) },
    { label: 'Location', value: formatCaseIntakeDraftLocation(draft) },
    { label: 'Insured name', value: String(draft?.insuredName || '').trim() || '—' },
  ];
  return fields.filter((field) => field.value && field.value !== '—');
}

export function summarizeCaseInfoRequests(infoRequests?: CaseInfoRequest[] | null): CaseInfoRequest[] {
  return Array.isArray(infoRequests) ? infoRequests.slice(0, 3) : [];
}

export function shouldShowSendFnolButton(args: {
  intakeStage: 'EMPTY' | 'INCOMPLETE' | 'READY' | 'CONFIRMED' | 'CLARIFICATION';
  awaitingCustomerResponse: boolean;
}) {
  if (args.awaitingCustomerResponse) return false;
  return args.intakeStage === 'EMPTY' || args.intakeStage === 'INCOMPLETE' || args.intakeStage === 'CLARIFICATION';
}

export function ClaimSummaryTab(props: Props) {
  const {
    worksheet,
    onOpenIntakeEditor,
    onOpenIntakeDetails,
    onConfirmIntake,
    onOpenClarification,
    onResendFnolLink,
    onOpenLinkPolicy,
    onOpenCaseRequestInfo,
    onOpenActivity,
    onOpenPolicy,
    coverageRows = [],
    busy,
  } = props;

  const [showFullDescription, setShowFullDescription] = useState(false);

  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const asArray = <T = unknown,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  const readPath = (source: Record<string, unknown>, path: string): unknown =>
    path.split('.').reduce<unknown>((acc, segment) => asRecord(acc)[segment], source);
  const readText = (source: Record<string, unknown>, paths: string[]): string => {
    for (const path of paths) {
      const text = String(readPath(source, path) ?? '').trim();
      if (text) return text;
    }
    return '';
  };
  const readBool = (source: Record<string, unknown>, paths: string[]): boolean | null => {
    for (const path of paths) {
      const value = readPath(source, path);
      if (typeof value === 'boolean') return value;
      const text = String(value ?? '').trim().toLowerCase();
      if (text === 'yes' || text === 'true') return true;
      if (text === 'no' || text === 'false') return false;
    }
    return null;
  };
  const formatMoney = (value: number): string => {
    const currency = String(worksheet.summary.cr0109_original_currency || 'EUR').toUpperCase();
    const symbol = currency === 'EUR' ? '€' : `${currency} `;
    return `${symbol}${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  };
  const formatEuropeanDate = (value?: string): string => {
    const raw = String(value || '').trim();
    if (!raw) return '—';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric' }).format(date);
    const month = new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(date);
    const year = new Intl.DateTimeFormat('en-GB', { year: 'numeric' }).format(date);
    return `${day} ${month}, ${year}`;
  };
  const formatClaimTypeLabel = (rawType: string): string => {
    const key = String(rawType || '').trim().toLowerCase();
    const labels: Record<string, string> = {
      collision: 'Collision',
      theft: 'Theft',
      damage_parked: 'Damaged while parked',
      parked: 'Damaged while parked',
      vandalism: 'Vandalism',
      weather: 'Weather',
      windscreen: 'Windscreen',
      other: 'Other',
    };
    return labels[key] || (key ? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—');
  };
  const SectionIcon = ({ kind }: { kind: 'date' | 'type' | 'description' | 'location' | 'police' | 'injuries' }) => {
    const cls = 'h-5 w-5 text-slate-400';
    if (kind === 'date') {
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 3v4m8-4v4M4 11h16M5 21h14a1 1 0 001-1V7a1 1 0 00-1-1H5a1 1 0 00-1 1v13a1 1 0 001 1z" />
        </svg>
      );
    }
    if (kind === 'type') {
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3l7 4v5c0 5-3.5 8.5-7 9-3.5-.5-7-4-7-9V7l7-4z" />
        </svg>
      );
    }
    if (kind === 'description') {
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 9h6M9 13h6M9 17h4" />
        </svg>
      );
    }
    if (kind === 'location') {
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z" />
          <circle cx="12" cy="10" r="2.5" strokeWidth="1.8" />
        </svg>
      );
    }
    if (kind === 'police') {
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3l7 4v5c0 5-3.5 8.5-7 9-3.5-.5-7-4-7-9V7l7-4z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.5 12l1.7 1.7L14.5 10.5" />
        </svg>
      );
    }
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
        <rect x="4.5" y="4.5" width="15" height="15" rx="3" strokeWidth="1.8" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v8M8 12h8" />
      </svg>
    );
  };

  const intake = worksheet.intake;
  const caseMode = Boolean(worksheet.case?.isUnlinked);
  const intakeSnapshot = ((intake?.fnol || {}) as Record<string, unknown>);
  const hasMeaningfulValue = (value: unknown): boolean => {
    if (value == null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
    if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some((item) => hasMeaningfulValue(item));
    return false;
  };
  const nonConfirmFailingGates = (intake?.gates || []).filter((gate) => gate.key !== 'fnolConfirmed' && gate.status !== 'PASS');
  const hasIntakeData = hasMeaningfulValue(intakeSnapshot);
  const lastFnolLinkEvent = [...(worksheet.timeline || [])]
    .reverse()
    .find((event) => String(event.eventType || '').toUpperCase() === 'FNOL_LINK_SENT');
  // ABY-268: prefer the worker delivery state over the worksheet event
  // stamp. The event timeline records `sentAt = now` when the operator
  // clicked Send (i.e. when the message was queued). The actual SMTP
  // delivery happens later via `COMMUNICATION_OUTBOUND` and lands on
  // `comms.fnolLinkDelivery`. Falling back to the worksheet event keeps
  // older clients / pre-worker rows readable.
  const fnolLinkDelivery = worksheet.comms?.fnolLinkDelivery;
  const lastFnolLinkSentAt =
    fnolLinkDelivery?.sentAt || fnolLinkDelivery?.queuedAt || lastFnolLinkEvent?.occurredAt;
  const lastFnolRecipient = String(
    fnolLinkDelivery?.recipient ||
    ((lastFnolLinkEvent?.payload as Record<string, unknown> | undefined)?.recipient) ||
    worksheet.comms?.policyholder?.email ||
    ''
  ).trim();
  const fnolLinkDeliveryStatus = fnolLinkDelivery?.status ?? null;
  const isFnolLinkQueued = fnolLinkDeliveryStatus === 'QUEUED';
  const isFnolLinkSent = fnolLinkDeliveryStatus === 'SENT';
  const isFnolLinkFailed = fnolLinkDeliveryStatus === 'FAILED';
  const formatEuropeanDateTime = (value?: string) => {
    const raw = String(value || '').trim();
    if (!raw) return 'n/a';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'n/a';
    const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric' }).format(date);
    const month = new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(date);
    const year = new Intl.DateTimeFormat('en-GB', { year: 'numeric' }).format(date);
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    return `${day} ${month}, ${year}, ${time}`;
  };
  const awaitingCustomerResponse = !caseMode && !hasIntakeData && Boolean(lastFnolLinkSentAt);
  const caseInfoRequests = summarizeCaseInfoRequests(worksheet.case?.infoRequests || []);
  const unknownPolicyFields = buildUnknownPolicyOverviewFields({
    draft: worksheet.case?.intakeDraft || null,
    formatDate: formatEuropeanDate,
  });
  const intakeStage: 'EMPTY' | 'INCOMPLETE' | 'READY' | 'CONFIRMED' | 'CLARIFICATION' =
    intake?.status === 'FNOL_CONFIRMED'
      ? 'CONFIRMED'
      : intake?.status === 'AWAITING_CLARIFICATION'
        ? 'CLARIFICATION'
        : !hasIntakeData
          ? 'EMPTY'
          : nonConfirmFailingGates.length > 0
            ? 'INCOMPLETE'
            : 'READY';

  const incidentDescription = readText(intakeSnapshot, ['incident.description', 'description', 'narrative']) || '—';
  const thirdPartyCars = asArray<Record<string, unknown>>(readPath(intakeSnapshot, 'thirdParty.anotherCars'));
  const thirdPartyPedestrians = asArray<Record<string, unknown>>(readPath(intakeSnapshot, 'thirdParty.pedestrians'));
  const thirdPartyProperties = asArray<Record<string, unknown>>(readPath(intakeSnapshot, 'thirdParty.properties'));
  const timelineLastFive = useMemo(() => worksheet.timeline.slice(-5), [worksheet.timeline]);
  const docsTextBlob = useMemo(() => {
    const list = (worksheet.documents || []).map((doc) => String((doc.name || doc.filename || doc.type || '')).toLowerCase());
    return list.join(' | ');
  }, [worksheet.documents]);
  const evidence = asRecord(readPath(intakeSnapshot, 'evidence'));
  const uploads = asRecord(readPath(intakeSnapshot, 'uploads'));
  const policeInvolved = readBool(intakeSnapshot, ['police.involved']);
  const injuries = readBool(intakeSnapshot, ['triage.injuriesReported']);
  const photosCount = [
    ...asArray(readPath(evidence, 'accidentLocation')),
    ...asArray(readPath(evidence, 'vehicleDamage')),
    ...asArray(readPath(uploads, 'accidentLocation')),
    ...asArray(readPath(uploads, 'vehicleDamage')),
  ].length;
  const policeReportCount = [
    ...asArray(readPath(evidence, 'policeReport')),
    ...asArray(readPath(uploads, 'policeReport')),
  ].length;
  const requiredDocs = [
    ...(policeInvolved ? [{
      name: 'Police Report',
      received: policeReportCount > 0 || docsTextBlob.includes('police report'),
    }] : []),
    {
      name: 'Claim Form',
      received: Boolean(readPath(intakeSnapshot, 'declarationAccepted')) || docsTextBlob.includes('claim form'),
    },
    {
      name: 'Photos',
      received: photosCount > 0 || docsTextBlob.includes('photo') || docsTextBlob.includes('image'),
    },
  ];
  const quickActions = useMemo(() => {
    const actions: Array<{ label: string; template?: DevelopmentType }> = [];
    const reserved = Number(worksheet.summary.financials.totalOutstanding || 0);
    if (reserved <= 0) actions.push({ label: 'Set reserve', template: 'SET_RESERVE' });
    if (reserved > 0) {
      actions.push({ label: 'Adjust reserve', template: 'ADJUST_RESERVE' });
      actions.push({ label: 'Record payment', template: 'ADD_PAYMENT' });
    }
    if (reserved <= 0 && intakeStage === 'CONFIRMED') actions.push({ label: 'Close claim', template: 'CLOSE' });
    return actions.slice(0, 3);
  }, [worksheet.summary.financials.totalOutstanding, intakeStage]);
  const externalParties = [
    ...thirdPartyCars.map((row, idx) => ({ key: `car-${idx}`, role: `TP ${idx + 1}`, kind: 'Vehicle', name: String(row.fullName || row.name || row.plate || 'Vehicle party') })),
    ...thirdPartyPedestrians.map((row, idx) => ({ key: `ped-${idx}`, role: `TP ${idx + 1 + thirdPartyCars.length}`, kind: 'Pedestrian', name: String(row.fullName || row.name || 'Pedestrian party') })),
    ...thirdPartyProperties.map((row, idx) => ({ key: `prop-${idx}`, role: `TP ${idx + 1 + thirdPartyCars.length + thirdPartyPedestrians.length}`, kind: 'Property', name: String(row.fullName || row.name || 'Property party') })),
  ];
  const thirdPartyTotal = externalParties.length;
  const thirdPartyKinds = [
    ...(thirdPartyCars.length ? (['car'] as const) : []),
    ...(thirdPartyPedestrians.length ? (['person'] as const) : []),
    ...(thirdPartyProperties.length ? (['property'] as const) : []),
  ];
  const adjusterName = (() => {
    const event = [...worksheet.timeline].reverse().find((ev) => String(ev.eventType || '').toUpperCase() === 'FIELD_ADJUSTER_INSTRUCTED');
    const payload = asRecord(event?.payload);
    return String(payload.companyName || event?.actorName || '').trim() || 'Not assigned';
  })();
  const handlerName = String(worksheet.topBar.lastActorName || '').trim() || 'Unassigned';
  const descriptionPreview = incidentDescription === '—'
    ? incidentDescription
    : (showFullDescription ? incidentDescription : incidentDescription.split('\n').slice(0, 3).join('\n'));

  const actionBtnPrimaryCls = 'inline-flex items-center gap-2 h-action px-7 rounded-xl bg-slate-900 hover:bg-black text-white text-[11px] font-black uppercase tracking-widest transition disabled:opacity-60 disabled:cursor-not-allowed';
  const actionBtnSecondaryCls = 'inline-flex items-center gap-2 h-action px-6 rounded-xl border border-slate-300 bg-white text-slate-700 text-[11px] font-black uppercase tracking-widest hover:bg-slate-50 transition disabled:opacity-60 disabled:cursor-not-allowed';
  const intakeTitle =
    intakeStage === 'READY'
      ? 'FNOL ready for confirmation'
      : intakeStage === 'CLARIFICATION'
        ? 'Intake clarification pending'
        : intakeStage === 'EMPTY'
          ? 'Intake not started'
          : 'Intake incomplete';
  const intakeSubtitle =
    intakeStage === 'READY'
      ? 'Please confirm the intake to unlock financial handling.'
      : intakeStage === 'CLARIFICATION'
        ? 'Additional information is needed before confirmation.'
        : intakeStage === 'EMPTY'
          ? 'Start by recording basic incident details.'
          : `Complete the required intake details before confirmation (${nonConfirmFailingGates.length} remaining).`;
  const showSendFnolButton = shouldShowSendFnolButton({ intakeStage, awaitingCustomerResponse });
  const hasCaseContext = unknownPolicyFields.length > 0 || caseInfoRequests.length > 0;
  const renderCaseContext = (title: string) => (
    <>
      {unknownPolicyFields.length ? (
        <div className="space-y-3 border-t border-slate-200/80 pt-5">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">{title}</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {unknownPolicyFields.map((field) => (
              <div key={field.label}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{field.label}</div>
                <div className="mt-1 text-sm font-semibold text-slate-700 whitespace-pre-wrap">{field.value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {caseInfoRequests.length ? (
        <div className="space-y-3 border-t border-slate-200/80 pt-5">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Information requests</div>
          <div className="space-y-3">
            {caseInfoRequests.map((request) => (
              <div key={request.id} className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-sm font-semibold text-slate-700">{request.message}</div>
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500">
                    {request.status || 'Open'}
                  </div>
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-500">
                  Requested {formatEuropeanDateTime(request.requestedAt)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="space-y-7 max-w-full pb-0">
      {caseMode ? (
        <section className="bg-white/60 border border-slate-200/60 rounded-3xl p-6 md:p-8 space-y-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-base font-black text-slate-900">Policy not linked</div>
              <div className="text-sm font-semibold text-slate-600">
              We need to identify the relevant policy before this can proceed as a claim.
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 flex-wrap">
              <Button type="button" onClick={onOpenCaseRequestInfo} disabled={busy} className={actionBtnSecondaryCls}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z" />
                </svg>
                Request more information
              </Button>
              <Button type="button" onClick={onOpenLinkPolicy} disabled={busy} className={actionBtnPrimaryCls}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 13a5 5 0 007.07 0l1.41-1.41a5 5 0 00-7.07-7.07L10 5m4 6a5 5 0 00-7.07 0L5.5 12.5a5 5 0 007.07 7.07L14 18" />
                </svg>
                Link to policy
              </Button>
            </div>
          </div>
          {hasCaseContext ? renderCaseContext('Captured intake') : null}
        </section>
      ) : intakeStage !== 'CONFIRMED' ? (
        awaitingCustomerResponse ? (
          <section
            className={`border rounded-3xl p-6 md:p-8 space-y-5 ${
              isFnolLinkFailed
                ? 'bg-rose-50/70 border-rose-300/70'
                : isFnolLinkQueued
                ? 'bg-amber-50/70 border-amber-200/70'
                : 'bg-white/60 border-slate-200/60'
            }`}
          >
            {/* ABY-268: honest delivery state. The backend now exposes
                the actual `CommunicationMessage.status` on
                `comms.fnolLinkDelivery`; show "Queued" while the worker
                has not yet attempted, "Sent" once accepted by the
                provider, and a red Failed banner if the worker
                exhausted retries — so operators no longer chase
                replies on links the customer never received. */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-base font-black text-slate-900">
                  {isFnolLinkFailed
                    ? 'FNOL link delivery failed'
                    : isFnolLinkQueued
                    ? 'FNOL link queued for delivery'
                    : 'FNOL link sent to policyholder'}
                </div>
                <div className="text-sm font-semibold text-slate-600">
                  {isFnolLinkFailed
                    ? `The customer-email worker exhausted its retry budget${
                        fnolLinkDelivery?.errorCode ? ` (${fnolLinkDelivery.errorCode})` : ''
                      } — the customer never received the link. Resend below, or contact them on another channel.`
                    : isFnolLinkQueued
                    ? 'The link has been queued for delivery — the customer-email worker will attempt delivery shortly. We will update this banner when the provider accepts it.'
                    : 'Waiting for insured response before intake review can begin.'}
                </div>
                <div className="text-sm font-semibold text-slate-600">
                  {isFnolLinkQueued
                    ? `Queued for ${lastFnolRecipient || 'policyholder'} at ${formatEuropeanDateTime(lastFnolLinkSentAt)}`
                    : isFnolLinkFailed
                    ? `Last attempt to ${lastFnolRecipient || 'policyholder'} at ${formatEuropeanDateTime(lastFnolLinkSentAt)} (${fnolLinkDelivery?.attemptCount || 0} attempts)`
                    : `FNOL email ${isFnolLinkSent ? 'sent' : 'queued'} to ${lastFnolRecipient || 'policyholder'} on ${formatEuropeanDateTime(lastFnolLinkSentAt)}`}
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 flex-wrap">
                <Button
                  type="button"
                  onClick={onOpenIntakeEditor}
                  disabled={busy}
                  className={actionBtnSecondaryCls}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Record manual response
                </Button>
                <Button
                  type="button"
                  onClick={onResendFnolLink}
                  disabled={busy}
                  className={actionBtnPrimaryCls}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M22 2L11 13" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M22 2L15 22L11 13L2 9L22 2Z" />
                  </svg>
                  {busy ? 'Sending…' : 'Resend FNOL link'}
                </Button>
              </div>
            </div>
          </section>
        ) : (
          <section className="bg-white/60 border border-slate-200/60 rounded-3xl p-6 md:p-8 space-y-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-base font-black text-slate-900">{intakeTitle}</div>
                <div className="text-sm font-semibold text-slate-600">
                  {intakeSubtitle}
                </div>
              </div>
              <div className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                intakeStage === 'READY' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
              }`}>
                {intakeStage === 'READY' ? 'Ready' : 'Not ready'}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 flex-wrap">
              <Button type="button" onClick={onOpenCaseRequestInfo} disabled={busy} className={actionBtnSecondaryCls}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z" />
                </svg>
                Request more information
              </Button>
              {(intakeStage === 'INCOMPLETE' || intakeStage === 'CLARIFICATION' || intakeStage === 'READY') ? (
                <Button type="button" onClick={onOpenIntakeDetails} className={actionBtnSecondaryCls}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Review details
                </Button>
              ) : null}
              {intakeStage === 'CLARIFICATION' ? (
                <Button type="button" onClick={onOpenClarification} className={actionBtnSecondaryCls}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z" />
                  </svg>
                  Request missing information
                </Button>
              ) : null}
              {(intakeStage === 'EMPTY' || intakeStage === 'INCOMPLETE' || intakeStage === 'CLARIFICATION') ? (
                <Button type="button" onClick={onOpenIntakeEditor} disabled={busy} className={actionBtnPrimaryCls}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  {intakeStage === 'EMPTY' ? 'Add incident details' : 'Complete required fields'}
                </Button>
              ) : null}
              {showSendFnolButton ? (
                <Button type="button" onClick={onResendFnolLink} disabled={busy} className={actionBtnSecondaryCls}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M22 2L11 13" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M22 2L15 22L11 13L2 9L22 2Z" />
                  </svg>
                  {busy ? 'Sending…' : 'Send FNOL to policyholder'}
                </Button>
              ) : null}
              {intakeStage === 'READY' ? (
                <Button type="button" onClick={onConfirmIntake} disabled={busy} className={actionBtnPrimaryCls}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Confirm FNOL
                </Button>
              ) : null}
            </div>
            {hasCaseContext ? renderCaseContext('Initial case intake') : null}
          </section>
        )
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-10">
          <div className="space-y-8 min-w-0">
            <section className="grid grid-cols-1 xl:grid-cols-2 gap-8">
              <div className="space-y-4 h-full flex flex-col">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Incident details</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 flex-1">
                  <div className="flex items-start gap-3">
                    <SectionIcon kind="type" />
                    <div>
                      <div className="text-sm font-semibold text-slate-500">Claim type</div>
                      <div className="text-base font-semibold text-slate-700">{formatClaimTypeLabel(readText(intakeSnapshot, ['incident.type']) || String(worksheet.summary.claimType || ''))}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <SectionIcon kind="date" />
                    <div>
                      <div className="text-sm font-semibold text-slate-500">Date of loss</div>
                      <div className="text-base font-semibold text-slate-700">{formatEuropeanDate(readText(intakeSnapshot, ['incident.date', 'incident.dateOfLoss']))}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <SectionIcon kind="description" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-500">Description</div>
                      <div className="text-base font-semibold text-slate-700 whitespace-pre-wrap">{descriptionPreview}</div>
                      {incidentDescription !== '—' && incidentDescription !== descriptionPreview ? (
                        <Button type="button" variant="link" size="none" className="mt-1 text-xs font-semibold text-slate-600 underline" onClick={() => setShowFullDescription(true)}>
                          Expand
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <SectionIcon kind="location" />
                    <div>
                      <div className="text-sm font-semibold text-slate-500">Location</div>
                      <div className="text-base font-semibold text-slate-700">
                        {joinTextParts(
                          readText(intakeSnapshot, ['incident.location.address', 'incident.location.line1', 'incident.location']),
                          readText(intakeSnapshot, ['incident.location.city', 'incident.city', 'location.city', 'city']),
                        ) || readText(intakeSnapshot, ['incident.location.address', 'incident.location', 'incident.location.city', 'incident.city', 'location.city', 'city']) || '—'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <SectionIcon kind="police" />
                    <div>
                      <div className="text-sm font-semibold text-slate-500">Police involved</div>
                      <div className="text-base font-semibold text-slate-700">{policeInvolved == null ? '—' : policeInvolved ? 'Yes' : 'No'}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <SectionIcon kind="injuries" />
                    <div>
                      <div className="text-sm font-semibold text-slate-500">Injuries</div>
                      <div className="text-base font-semibold text-slate-700">{injuries == null ? '—' : injuries ? 'Yes' : 'No'}</div>
                    </div>
                  </div>
                </div>
                <div className="pt-2 text-right mt-auto">
                  <Button type="button" variant="link" size="none" className="text-xs font-semibold text-slate-700 underline underline-offset-2" onClick={onOpenIntakeDetails}>
                    Review Full FNOL
                  </Button>
                </div>
              </div>
              <div className="space-y-3 h-full flex flex-col">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Coverage details</div>
                <table className="w-full border border-slate-200 text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="px-0 py-2 font-semibold">Coverage</th>
                      <th className="px-0 py-2 font-semibold">Limit</th>
                      <th className="px-0 py-2 font-semibold">Excess</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(coverageRows.length ? coverageRows : [
                      { coverage: 'Own Damage', limit: '€250,000', excess: '€250' },
                      { coverage: 'Third Party', limit: '€1,250,000', excess: 'NIL' },
                    ]).map((row) => (
                      <tr key={`${row.coverage}-${row.limit}-${row.excess}`} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-0 py-2 text-slate-800">{row.coverage}</td>
                        <td className="px-0 py-2 text-slate-700">{row.limit}</td>
                        <td className="px-0 py-2 text-slate-700">{row.excess}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="pt-2 text-right mt-auto">
                  <Button type="button" variant="link" size="none" className="text-xs font-semibold text-slate-700 underline underline-offset-2" onClick={onOpenPolicy}>
                    View Policy
                  </Button>
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t border-slate-200/80 pt-6">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Parties</div>
              <div className="border border-slate-200 rounded-xl px-4 py-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5 justify-items-center">
                  {[
                    { role: 'Policyholder', name: String(worksheet.comms?.policyholder?.name || '—'), color: 'text-blue-600', bg: 'bg-blue-50/80 border-blue-200', dashed: false },
                    { role: 'Driver', name: readText(intakeSnapshot, ['driver.name', 'driver.id']) || '—', color: 'text-violet-600', bg: 'bg-violet-50/80 border-violet-200', dashed: false },
                    { role: 'Handler', name: handlerName, color: 'text-emerald-600', bg: 'bg-emerald-50/80 border-emerald-200', dashed: false },
                    { role: 'Adjuster', name: adjusterName, color: 'text-slate-500', bg: 'bg-white border-slate-300', dashed: adjusterName === 'Not assigned' },
                  ].map((party) => (
                    <div key={party.role} className="flex flex-col items-center gap-1 text-center">
                      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-full border-2 ${party.bg} ${party.dashed ? 'border-dashed' : ''}`}>
                        <svg className={`h-[18px] w-[18px] ${party.color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M12 12a4 4 0 100-8 4 4 0 000 8z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M5 21a7 7 0 0114 0" />
                        </svg>
                      </span>
                      <div className="text-[12px] font-medium text-slate-500 leading-5">{party.role}</div>
                      <div className="text-[14px] font-semibold text-slate-800 leading-6 max-w-[10rem]">{party.name}</div>
                      {party.role === 'Adjuster' ? (
                        <Button type="button" variant="secondary" onClick={() => onOpenActivity()} className="mt-1 inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                          <span className="text-lg leading-none">+</span>
                          Assign
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
                {thirdPartyTotal > 0 ? (
                  <div className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-700">
                    <span className="font-semibold">+ {thirdPartyTotal} third parties</span>
                    <div className="flex items-center gap-1.5">
                      {thirdPartyKinds.includes('car') ? (
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-500">
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 13l2-5a2 2 0 011.9-1.3h10.2A2 2 0 0119 8l2 5M5 13h14M7 17a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm10 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
                          </svg>
                        </span>
                      ) : null}
                      {thirdPartyKinds.includes('person') ? (
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-500">
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 11a3 3 0 100-6 3 3 0 000 6zM6 20a6 6 0 1112 0" />
                          </svg>
                        </span>
                      ) : null}
                      {thirdPartyKinds.includes('property') ? (
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-500">
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 11l8-6 8 6M6 10v9h12v-9M10 19v-5h4v5" />
                          </svg>
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <div className="space-y-6 min-w-0 lg:border-l lg:border-slate-200/80 lg:pl-8">
            <ClaimMemoryCopilotCard claimId={worksheet.claimId} />

            <section className="space-y-3 border-t border-slate-200/80 pt-5">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Financial snapshot</div>
              <div className="grid grid-cols-2 gap-3 text-left">
                {[
                  { label: 'Reserved', value: formatMoney(worksheet.summary.financials.totalOutstanding), tone: 'text-amber-600' },
                  { label: 'Paid', value: formatMoney(worksheet.summary.financials.totalPaid), tone: 'text-blue-600' },
                  { label: 'Recoveries', value: formatMoney(worksheet.summary.financials.totalRecovered), tone: 'text-emerald-600' },
                  { label: 'Net Incurred', value: formatMoney(worksheet.summary.financials.netIncurred), tone: 'text-rose-600' },
                ].map((metric) => (
                  <div key={metric.label} className="border border-slate-200 rounded-lg px-3 py-2">
                    <div className={`text-xs font-semibold ${metric.tone}`}>{metric.label}</div>
                    <div className={`text-sm font-black ${metric.tone}`}>{metric.value}</div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-slate-600">Outstanding: {formatMoney(worksheet.summary.financials.totalOutstanding)}</div>
              <div className="text-right">
                <Button type="button" variant="link" size="none" className="text-xs font-semibold text-slate-700 underline underline-offset-2" onClick={() => onOpenActivity('SET_RESERVE')}>
                  + Update Reserve
                </Button>
              </div>
            </section>

            <section className="space-y-3 border-t border-slate-200/80 pt-5">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Required documents</div>
              <div className="space-y-2">
                {requiredDocs.map((doc) => (
                  <div key={doc.name} className="flex items-center justify-between border border-slate-200 rounded-lg px-3 py-2">
                    <span className="text-sm text-slate-800">{doc.name}</span>
                    <span className={`text-xs font-semibold ${doc.received ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {doc.received ? 'Received' : 'Missing'}
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-right">
                <Button type="button" variant="link" size="none" className="text-xs font-semibold text-slate-700 underline underline-offset-2" onClick={() => onOpenActivity()}>
                  + Request Document
                </Button>
              </div>
            </section>

            <section className="space-y-3 border-t border-slate-200/80 pt-5">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Quick actions</div>
              <div className="flex flex-wrap gap-2">
                {quickActions.map((action) => (
                  <Button key={action.label} type="button" variant="secondary" className="h-10 px-4 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => onOpenActivity(action.template)}>
                    {action.label}
                  </Button>
                ))}
              </div>
            </section>

            <section className="space-y-3 border-t border-slate-200/80 pt-5">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Recent activity</div>
              <ClaimActivityTimeline
                events={timelineLastFive}
                emptyMessage="No recent activity yet."
                compact
              />
              <div className="text-right">
                <Button type="button" variant="link" size="none" className="text-xs font-semibold text-slate-700 underline underline-offset-2" onClick={() => onOpenActivity()}>
                  View Full Activity
                </Button>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

