// Type definitions + small text-formatting helpers for UnderwritingTab.
// Extracted from `./UnderwritingTab.tsx` in sprint follow-up F4c so
// the component file stays under the file-size cap.

import type {
  PolicyFollowUpItem,
  PolicyRecord,
  PolicyStateSetter,
  PolicyUwAnswers,
  UwAnswersSetter,
} from '../../model/policy';
import type { BinderLike } from '../../binders/binderFormatting';
import type { UnknownRecord } from '../model/questionnaireHelpers';
import type { PendingProductChangeConfirmation } from '../../hooks/usePolicyProgramsBinders';

export type RequestStep = string;
export type ProgramLike = { id?: string; name?: string; status?: string; metadata?: unknown };
export type FollowUpItem = PolicyFollowUpItem;

export type RiskPoint = { pts: number; kind?: 'pos' | 'neg' | 'warn' | 'miss'; why?: string; conf?: string };
export type RiskModelLike = {
  completeness: { answered: number; total: number };
  points?: Record<string, RiskPoint>;
  [key: string]: unknown;
};

export type FailureZoneSignal = {
  code?: string;
  severity?: string;
  message?: string;
  /**
   * Free-form per-signal details emitted by the backend canonical owner
   * (`loadFailureZoneSnapshot` in `backend/platform/behavior/http/behaviorRouter.ts`).
   * Common keys: `paidAtMinutes`, `inceptionAgeMinutes`, `slaMinutes`,
   * `issuedDocCount`, `direction`, `driftScore`, `eventCount`, `receivedAt`.
   * Used by the operator banner only for presentation (timing context),
   * never for business decisions.
   */
  details?: Record<string, unknown>;
};
export type FailureZoneEvidence = { policyNumber?: string | null; similarity?: number; signals?: FailureZoneSignal[] };
export type FailureZoneView = {
  severity?: 'normal' | 'watch' | 'alert';
  score?: number;
  signals?: FailureZoneSignal[];
  similarFailureEvidence?: FailureZoneEvidence[];
};

export function cleanSignalMessage(signal: FailureZoneSignal): string {
  const message = String(signal.message || '').trim();
  return message && message.toUpperCase() !== String(signal.code || '').trim().toUpperCase()
    ? message
    : '';
}

export function formatSimilarCase(item: FailureZoneEvidence): string {
  const label = String(item.policyNumber || '').trim();
  if (!label) return '';
  const similarity = Number(item.similarity);
  return Number.isFinite(similarity) ? `${label} (${Math.round(similarity * 100)}% similar)` : label;
}

export interface UnderwritingProps {
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
  issueReadiness?: UnknownRecord | null;
  selectedPortfolio: PolicyRecord | null;
  selectedBinderId: string;
  setSelectedBinderId: (id: string) => void;
  setSelectedPortfolio: PolicyStateSetter;
  availableBinders: BinderLike[];
  bindersLoading: boolean;
  selectedProgramId: string;
  setSelectedProgramId: (id: string) => void;
  programs: ProgramLike[];
  programsLoading: boolean;
  handleSendQuestionnaire: () => void;
  isSending: boolean;
  questionnaireLastSentAt: Date | null;
  qStatus: 'Draft' | 'Sent' | 'In Process' | 'Submitted' | 'Follow-ups requested' | 'Superseded';
  getQuestionValue: (key: unknown) => unknown;
  uwAnswers: PolicyUwAnswers & { followUpRequests?: FollowUpItem[]; outstandingRequests?: FollowUpItem[] };
  riskModel: RiskModelLike;
  followUpsSentMap: Record<string, { sentAt: string; status: 'sent' | 'viewed' | 'answered' }>;
  isEndorsementMode: boolean;
  openFollowUp: (args: { questionLabel: string; fieldKey: string; stepKey: RequestStep }) => void;
  showBatchModal: boolean;
  setShowBatchModal: (show: boolean) => void;
  handleSendBatch: () => void;
  setUwAnswers: UwAnswersSetter;
  getQuoteOrigin: (portfolio: unknown) => 'customer' | 'bo' | 'unknown';
  openQuoteWizard: (policyId: string, hash: string) => void;
  showRequestInfoModal: boolean;
  setShowRequestInfoModal: (show: boolean) => void;
  requestInfoStep: RequestStep;
  setRequestInfoStep: (step: RequestStep) => void;
  requestInfoMessage: string;
  setRequestInfoMessage: (message: string) => void;
  isRequestingInfo: boolean;
  setIsRequestingInfo: (requesting: boolean) => void;
  loadPolicyDetails: () => Promise<void>;
  loadPolicies: () => Promise<void>;
  handleReRate: () => Promise<void>;
  isReRating: boolean;
  setToastMessage: (message: string) => void;
  setShowToast: (show: boolean) => void;
  endorsementDraftRiskTransactionId?: string | null;
  refreshIssueReadiness: () => Promise<void>;
  /** Populated by usePolicyProgramsBinders when a product change needs UW confirmation. */
  pendingProductChange?: PendingProductChangeConfirmation | null;
  /** Called after the modal resolves (confirm or cancel) to clear the pending state. */
  onPendingProductChangeClear?: () => void;
}
