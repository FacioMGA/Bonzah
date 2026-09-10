import { DEVELOPMENT_TYPES, type Worksheet } from '@/src/modules/claims/model/worksheetTypes';
import type { AuditIndicator, TabKey } from './types';
import { asRecord } from '@/src/shared/lib/record';

export type OperationalLifecycleState = 'PENDING' | 'OPEN' | 'UNDER_REVIEW' | 'DENIED' | 'CLOSED';

export const TAB_HASH_MAP: Record<string, TabKey> = {
  summary: 'overview',
  timeline: 'activity',
  developments: 'activity',
  financials: 'exposure',
  documents: 'evidence',
  comms: 'communications',
  deadlines: 'deadlines',
  statutory: 'deadlines',
};

export const CLAIMS_DESK_TABS: Array<{ id: TabKey; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'exposure', label: 'Exposure' },
  { id: 'deadlines', label: 'Deadlines' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'communications', label: 'Communications' },
];

export function toDisplayText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object') {
    const raw = asRecord(value);
    const candidate = raw.label ?? raw.value ?? raw.name ?? raw.title ?? '';
    if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate).trim();
  }
  return '';
}

export function formatCurrencyText(value: unknown, currency = 'EUR'): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const symbol = String(currency || 'EUR').toUpperCase() === 'EUR' ? '€' : `${String(currency || 'EUR').toUpperCase()} `;
  return `${symbol}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function money(amount: number, currency: string): string {
  const symbol = String(currency || 'EUR').toUpperCase() === 'EUR' ? '€' : `${String(currency || 'EUR').toUpperCase()} `;
  return `${symbol}${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function humanClaimStatus(statusRaw: string): string {
  const s = String(statusRaw || '').toUpperCase();
  if (s === 'CLOSED_THIS_MONTH') return 'Closed this month';
  if (s === 'REOPENED') return 'Re-opened';
  if (s === 'WITHDRAWN') return 'Withdrawn';
  if (s === 'PENDING') return 'Pending intake';
  if (!s) return 'Open';
  return s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (x) => x.toUpperCase());
}

export function humanClaimKind(typeRaw: string): string {
  const s = String(typeRaw || '').trim().toUpperCase();
  if (!s) return 'Claim';
  if (s === 'MOTOR') return 'Motor claim';
  if (s === 'OWN_DAMAGE') return 'Own damage claim';
  if (s === 'THIRD_PARTY') return 'Third party claim';
  return `${s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (x) => x.toUpperCase())} claim`;
}

export function selectOperationalLifecycleState(worksheet: Worksheet | null): OperationalLifecycleState {
  const status = String(worksheet?.topBar?.status || '').trim().toUpperCase();
  const phase = String(worksheet?.topBar?.phase || '').trim().toUpperCase();
  const denied = worksheet?.topBar?.denied === 'Y' || status === 'DENIED';
  if (denied) return 'DENIED';
  if (status === 'PENDING') return 'PENDING';
  if (status === 'CLOSED' || status === 'CLOSED_THIS_MONTH' || status === 'CLOSED_RECOVERY_PURSUED' || status === 'WITHDRAWN') {
    return 'CLOSED';
  }
  if (phase === 'INVESTIGATION' || phase === 'DECISION' || status === 'REOPENED') {
    return 'UNDER_REVIEW';
  }
  return 'OPEN';
}

export function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some((item) => hasMeaningfulValue(item));
  return false;
}

export function hasMeaningfulIntakeData(worksheet: Worksheet | null): boolean {
  return hasMeaningfulValue((worksheet?.intake?.fnol || {}) as Record<string, unknown>);
}

export function selectAwaitingFnolResponse(worksheet: Worksheet | null, caseMode: boolean, hasIntakeData: boolean): boolean {
  if (caseMode || !worksheet) return false;
  if (hasIntakeData) return false;
  return (worksheet.timeline || []).some((event) => String(event.eventType || '').toUpperCase() === 'FNOL_LINK_SENT');
}

export function selectAvailableDevelopmentTypes(worksheet: Worksheet | null, caseMode: boolean) {
  if (caseMode) return [];
  const operationalState = selectOperationalLifecycleState(worksheet);
  if (operationalState === 'PENDING') {
    return DEVELOPMENT_TYPES.filter((item) => item.value === 'ADD_CLAIM_NOTE' || item.value === 'ADD_CLAIM_EVIDENCE');
  }
  if (operationalState === 'DENIED') {
    return DEVELOPMENT_TYPES.filter((item) => item.value === 'ADD_CLAIM_NOTE' || item.value === 'ADD_CLAIM_EVIDENCE');
  }
  if (operationalState === 'CLOSED') {
    return DEVELOPMENT_TYPES.filter((item) => item.value === 'REOPEN' || item.value === 'ADD_CLAIM_NOTE' || item.value === 'ADD_CLAIM_EVIDENCE');
  }
  return DEVELOPMENT_TYPES.filter((item) => item.value !== 'REOPEN');
}

export function selectVisibleTabs(caseMode: boolean, awaitingFnolResponse: boolean, tabs = CLAIMS_DESK_TABS) {
  return (caseMode || awaitingFnolResponse) ? tabs.filter((tab) => tab.id !== 'exposure') : tabs;
}

export function selectIntakeStatusPill(worksheet: Worksheet | null, caseMode: boolean, awaitingFnolResponse: boolean): string {
  if (caseMode) return 'Case logged - policy not linked';
  if (awaitingFnolResponse) return 'Awaiting FNOL response';
  const intake = worksheet?.intake;
  if (!intake || intake.status !== 'FNOL_CONFIRMED') {
    const hasData = Boolean(intake?.currentVersion || Object.keys((intake?.fnol || {}) as Record<string, unknown>).length);
    if (!hasData) return 'Intake not started';
    if (intake?.status === 'AWAITING_CLARIFICATION') return 'Intake incomplete';
    const failing = (intake?.gates || []).filter((gate) => gate.key !== 'fnolConfirmed' && gate.status !== 'PASS');
    return failing.length > 0 ? 'Intake incomplete' : 'Ready for confirmation';
  }
  if (worksheet?.topBar.denied === 'Y') return 'Claim declined';
  if (worksheet?.topBar.referredToUw === 'Y') return 'Underwriting review';
  if ((worksheet?.summary.financials.totalOutstanding || 0) > 0) return 'Decision pending';
  const operationalState = selectOperationalLifecycleState(worksheet);
  if (operationalState === 'UNDER_REVIEW') return 'Under review';
  if (operationalState === 'DENIED') return 'Denied';
  if (operationalState === 'CLOSED') return 'Closed';
  return 'Open';
}

export function selectAuditIndicator(worksheet: Worksheet | null): AuditIndicator {
  const gaps = worksheet?.complianceGaps || [];
  const gapCount = gaps.length;
  if (gapCount > 0) {
    return {
      dotClass: 'bg-rose-500',
      title: `Audit flagged: ${gapCount} compliance gap${gapCount > 1 ? 's' : ''}`,
    };
  }
  return {
    dotClass: 'bg-emerald-500',
    title: 'Audit valid: no compliance gaps',
  };
}

export function extractCoverageRowsFromPolicy(record: Record<string, unknown>): Array<{ coverage: string; limit: string; excess: string }> {
  const qd = asRecord(record.quoteData);
  const currency = String(record.currency || qd.originalCurrency || 'EUR');
  const ownDamageLimit = String(qd.sumInsured || qd.ownDamageLimit || '').trim() || '€250,000';
  const thirdPartyLimit = String(qd.thirdPartyLimit || qd.thirdPartyPropertyLimit || '').trim() || '€1,250,000';
  const excessRaw = qd.requiredExcess ?? qd.excess ?? record.excess;
  const excess = formatCurrencyText(excessRaw, currency);
  return [
    { coverage: 'Own Damage', limit: ownDamageLimit, excess: excess === '—' ? '€250' : excess },
    { coverage: 'Third Party', limit: thirdPartyLimit, excess: 'NIL' },
  ];
}

