import type { LifecycleStageId } from '@facio/validation';
import type { UnderwritingDisplayState } from './underwritingStatus';

export type UnderwritingEditMode = 'preBind' | 'readOnly' | 'endorsementDraft';

export function deriveUnderwritingStage(statusUpper: string): LifecycleStageId {
  if (['BOUND', 'ISSUED', 'ACTIVE', 'CANCELLED', 'EXPIRED'].includes(statusUpper)) return 'bind';
  if (['QUOTED', 'AWAITING_PAYMENT', 'REFERRAL', 'INFO_REQUIRED'].includes(statusUpper)) return 'quote';
  if (['DRAFT', 'INTAKE'].includes(statusUpper)) return 'draft';
  return 'pricing';
}

export function isIssuedLifecycleStatus(statusUpper: string): boolean {
  return ['BOUND', 'ISSUED', 'ACTIVE', 'CANCELLED', 'EXPIRED'].includes(statusUpper);
}

export function deriveUnderwritingEditMode(args: {
  isEndorsementMode: boolean;
  endorsementDraftRiskTransactionId?: string | null;
  isIssuedStage: boolean;
}): UnderwritingEditMode {
  const { isEndorsementMode, endorsementDraftRiskTransactionId, isIssuedStage } = args;
  if (isEndorsementMode && endorsementDraftRiskTransactionId) return 'endorsementDraft';
  if (isIssuedStage) return 'readOnly';
  return 'preBind';
}

export function deriveQuestionnaireAccess(args: {
  editMode: UnderwritingEditMode;
  isEditing: boolean;
  isPolicyNew?: boolean;
  isPolicyLocked: boolean;
  isEndorsementMode: boolean;
}) {
  const { editMode, isEditing, isPolicyNew, isPolicyLocked, isEndorsementMode } = args;
  const canEditQuestionnaire = editMode !== 'readOnly';
  const isLocked = !isEditing && !isPolicyNew;
  const inlineEditEnabled = canEditQuestionnaire && !isLocked;
  const followUpEnabled = canEditQuestionnaire;
  const lockQuestionnaireOps = editMode === 'readOnly' || (isPolicyLocked && !isEndorsementMode);
  return {
    canEditQuestionnaire,
    inlineEditEnabled,
    followUpEnabled,
    lockQuestionnaireOps,
  };
}

export function shouldEnableFollowUps(args: {
  canEditQuestionnaire: boolean;
  underwritingState: UnderwritingDisplayState;
  lane: string | null | undefined;
}) {
  const { canEditQuestionnaire, underwritingState, lane } = args;
  const laneValue = String(lane || '').trim().toLowerCase();
  const isReferralLane = laneValue === 'yellow' || laneValue === 'red';
  return canEditQuestionnaire && underwritingState === 'QUOTE_READY' && isReferralLane;
}

export function shouldAutoRefreshUnderwritingQuestionnaire(args: {
  policyId?: string | null;
  qStatus: string;
  underwritingState: UnderwritingDisplayState;
  isEditing: boolean;
  hasUnsavedChanges: boolean;
}) {
  if (!String(args.policyId || '').trim()) return false;
  if (args.isEditing || args.hasUnsavedChanges) return false;
  if (args.underwritingState === 'QUOTE_READY' || args.underwritingState === 'FOLLOWUPS_OPEN') return false;

  const status = String(args.qStatus || '').trim();
  return (
    status === 'Sent' ||
    status === 'In Process' ||
    args.underwritingState === 'QUESTIONNAIRE_SENT' ||
    args.underwritingState === 'CUSTOMER_STARTED'
  );
}

export function deriveQuestionnaireStatusFromReadiness(args: {
  currentStatus: string;
  underwritingState: UnderwritingDisplayState;
}): 'Draft' | 'Sent' | 'In Process' | 'Submitted' | 'Follow-ups requested' | 'Superseded' | null {
  const current = String(args.currentStatus || '').trim();
  if (current === 'Superseded' || current === 'Follow-ups requested') return null;
  if (args.underwritingState === 'QUOTE_READY') return 'Submitted';
  if (args.underwritingState === 'CUSTOMER_STARTED') return 'In Process';
  if (args.underwritingState === 'QUESTIONNAIRE_SENT' && current === 'Draft') return 'Sent';
  return null;
}

export function hasAnsweredValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim().length > 0;
}

export function computeQuoteReadiness(args: {
  quoteData: Record<string, unknown>;
  requiredKeys: string[];
}) {
  const { quoteData, requiredKeys } = args;
  const answered = requiredKeys.reduce((acc, key) => (hasAnsweredValue(quoteData[key]) ? acc + 1 : acc), 0);
  return {
    answered,
    required: requiredKeys.length,
  };
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

export type UnderwritingReadinessSummary = {
  completed: number;
  total: number;
  readinessPct: number;
  riskFlags: number;
  blockingIssues: number;
  /**
   * ABY-49: when `blockers` is empty but `derived.missingForIssuedPack`
   * is not, the readiness card needs an expandable list to show the
   * user WHICH fields are missing. The previous summary only exposed
   * the count; the card UI then claimed N "Blocking Issues" with no
   * way to expand them, which the operator (correctly) read as a bug.
   *
   * `missingForIssuedPack` items are canonical missing-field
   * descriptors `{ slug, label }` produced by the backend
   * `getIssueReadinessUseCase`.
   */
  missingForIssuedPack: Array<{ slug: string; label: string }>;
};

function asMissingForIssuedPack(value: unknown): Array<{ slug: string; label: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ slug: string; label: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const slug = String(record.slug ?? record.field ?? record.key ?? '').trim();
    if (!slug) continue;
    const label = String(record.label ?? record.title ?? record.name ?? slug).trim();
    out.push({ slug, label: label || slug });
  }
  return out;
}

export function buildUnderwritingReadinessSummary(args: {
  issueReadiness: unknown;
  completed?: number;
  total?: number;
  riskFlagCount?: number;
}): UnderwritingReadinessSummary {
  const readiness = asRecord(args.issueReadiness);
  const derived = asRecord(readiness.derived);
  const totalOverride = Number(args.total);
  const completedOverride = Number(args.completed);
  const total = Number.isFinite(totalOverride) && totalOverride >= 0 ? totalOverride : 0;
  const completed = Number.isFinite(completedOverride) && completedOverride >= 0
    ? Math.min(total, completedOverride)
    : 0;
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
  const missingForIssuedPack = asMissingForIssuedPack(derived.missingForIssuedPack);
  const blockingIssues = blockers.length > 0 ? blockers.length : missingForIssuedPack.length;
  const riskFlags = Math.max(0, Number(args.riskFlagCount || 0));

  return {
    completed,
    total,
    readinessPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    riskFlags,
    blockingIssues,
    missingForIssuedPack,
  };
}

export function normalizeUnderwritingDisplayState(args: {
  uwStateRaw: string;
  effectiveLastSavedBy: string;
}): UnderwritingDisplayState {
  const { uwStateRaw, effectiveLastSavedBy } = args;
  const knownStates: UnderwritingDisplayState[] = [
    'NOT_STARTED',
    'CUSTOMER_STARTED',
    'UW_STARTED',
    'QUESTIONNAIRE_SENT',
    'FOLLOWUPS_OPEN',
    'QUOTE_READY',
  ];
  if ((knownStates as string[]).includes(uwStateRaw)) return uwStateRaw as UnderwritingDisplayState;
  if (uwStateRaw === 'COMPLETE') return 'QUOTE_READY';
  if (uwStateRaw === 'PARTIALLY_COMPLETED') {
    return effectiveLastSavedBy === 'customer' ? 'CUSTOMER_STARTED' : 'UW_STARTED';
  }
  if (uwStateRaw === 'QUESTIONNAIRE_SENT') return 'QUESTIONNAIRE_SENT';
  return 'NOT_STARTED';
}
