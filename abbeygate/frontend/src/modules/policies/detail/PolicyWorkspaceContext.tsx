import React, { createContext, useContext } from 'react';
import type { PolicyRecord, PolicyStateSetter, UnknownRecordSetter, PolicyUwAnswers, UwAnswersSetter } from '../model/policy';
import type { FollowUpSentMap } from '../underwriting/hooks/usePolicyFollowUps';

/**
 * The page is in one active edit workflow at a time.
 * Endorsement is a separate transaction mode (see future transactionMode field).
 * null = view-only; coverage/premium become relevant once endorsement mode ships.
 */
export type EditingScope = null | 'policyHolder' | 'underwriting' | 'coverage' | 'premium';

export interface PolicyLifecycleActions {
  quoteSentAt?: string | Date | null;
  quoteSentKey: string;
  isReRating: boolean;
  isSavingQuoteVersion: boolean;
  isUnlockingBoundMode: boolean;
  isIssuingQuote: boolean;
  isBindingCoverage: boolean;
  isIssuingPolicyFinal: boolean;
  isBindingEndorsementDraft: boolean;
  isIssuingEndorsement: boolean;
  isCancellingEndorsementDraft: boolean;
  setCoverageDirty: (dirty: boolean) => void;
  setCanSaveQuoteVersion: (canSave: boolean) => void;
  canSaveQuoteVersion: boolean;
  clearQuoteSentIndicator: () => void;
  setSelectedPortfolio: PolicyStateSetter;
  setViewingRiskTransactionSnapshot: UnknownRecordSetter;
  setViewingVersionId: (id: string | null) => void;
  setViewingRiskTransactionId: (id: string | null) => void;
  setShowRestoreVersionModal: (open: boolean) => void;
  setShowPricingSteps: (open: boolean) => void;
  setShowCreateEndorsementModal: (open: boolean) => void;
  setEndorsementEffectiveDate: (value: string) => void;
  setEndorsementReason: (value: string) => void;
  handleCancelEndorsementDraft: () => Promise<void>;
  handleReRate: () => Promise<void>;
  handleSaveQuoteVersion: () => Promise<void>;
  handleUnlockBoundMode: () => Promise<void>;
  handleIssueQuote: () => Promise<void>;
  handleBindCoverage: () => Promise<void>;
  handleIssuePolicyFinal: () => Promise<void>;
  handleBindEndorsementDraft: () => Promise<void>;
  handleIssueEndorsement: () => Promise<void>;
  reloadCurrentPolicy: (opts?: { riskTransactionId?: string | null }) => Promise<void>;
  refreshIssueReadiness: (policyId: string, opts?: { riskTransactionId?: string | null }) => Promise<void>;
  handleGenerateQuote: () => Promise<void>;
  isGeneratingQuote: boolean;
  handleBindPolicy: () => Promise<void>;
  isBindingPolicy: boolean;

  // Premium-related state (produced by controller hooks, consumed by PremiumTab)
  mbeTemplates?: unknown[];
  excessImpact?: unknown;
  excessImpactLoading?: boolean;
  coverageDirty?: boolean;
  /** Auto-compute aggregate limit from units × per-occurrence limit when true. */
  aggregateLimit?: boolean;
  setAggregateLimit?: (v: boolean) => void;
}

export interface PolicyWorkspaceContextValue {
  policyId: string | null;
  productType: string;
  selectedPortfolio: PolicyRecord | null;
  displayedPortfolio: PolicyRecord | null;
  setSelectedPortfolio: PolicyStateSetter;

  endorsementDraftRiskTransactionId: string | null;
  isIssuedRecordMode: boolean;
  isIssuedLifecycle: boolean;
  isEndorsementMode: boolean;
  policyVersions: unknown[];
  viewingVersionId: string | null;
  viewingRiskTransactionId: string | null;
  viewingRiskTransactionSnapshot: unknown;
  latestIssuedRiskTransactionId: string | null;

  issueReadiness: unknown;
  issueReadinessLoading: boolean;
  refreshIssueReadiness: (policyId: string, opts?: { riskTransactionId?: string | null }) => Promise<void>;
  reloadCurrentPolicy: (opts?: { riskTransactionId?: string | null }) => Promise<void>;

  selectedProgramId: string | null;
  setSelectedProgramId: (id: string | null) => void;
  programs: unknown[];
  programsLoading: boolean;
  selectedBinderId: string | null;
  setSelectedBinderId: (id: string | null) => void;
  availableBinders: unknown[];
  bindersLoading: boolean;

  editingScope: EditingScope;
  setEditingScope: (scope: EditingScope) => void;
  loading: boolean;

  setToastMessage: (m: string) => void;
  setShowToast: (v: boolean) => void;

  getQuoteOrigin: (portfolio: unknown) => string;
  openQuoteWizard: (policyId: string, tab?: string) => Promise<void> | void;
  loadPolicyDetails: () => Promise<void>;
  loadPolicies: () => Promise<void>;

  uwAnswers: PolicyUwAnswers;
  setUwAnswers: UwAnswersSetter;

  bindEndorsement: () => Promise<void>;
  cancelEndorsement: () => Promise<void>;

  // Questionnaire / follow-up state (shared: UW tab + page drawer + Premium quoteSentAt)
  handleSendQuestionnaire: () => Promise<void>;
  isSending: boolean;
  questionnaireLastSentAt: Date | null;
  qStatus: string;
  getQuestionValue: (key: unknown) => unknown;
  riskModel: unknown;
  followUpsSentMap: FollowUpSentMap;
  openFollowUp: (context: unknown) => void;
  showBatchModal: boolean;
  setShowBatchModal: (v: boolean) => void;
  handleSendBatch: () => Promise<void>;

  // Service / request-info state (shared: UW tab + Service tab)
  showRequestInfoModal: boolean;
  setShowRequestInfoModal: (v: boolean) => void;
  requestInfoStep: string;
  setRequestInfoStep: (step: string) => void;
  requestInfoMessage: string;
  setRequestInfoMessage: (msg: string) => void;
  isRequestingInfo: boolean;
  setIsRequestingInfo: (v: boolean) => void;

  lifecycle: PolicyLifecycleActions;

  parseDateLoose: (v: unknown) => Date | null;
  toISODateOnly: (d: Date) => string;
  calcExpiryDateFromStart: (start: Date) => Date;
}

const PolicyWorkspaceContext = createContext<PolicyWorkspaceContextValue | null>(null);

export function PolicyWorkspaceProvider({ value, children }: { value: PolicyWorkspaceContextValue; children: React.ReactNode }) {
  return <PolicyWorkspaceContext.Provider value={value}>{children}</PolicyWorkspaceContext.Provider>;
}

export function usePolicyWorkspace(): PolicyWorkspaceContextValue {
  const ctx = useContext(PolicyWorkspaceContext);
  if (!ctx) throw new Error('usePolicyWorkspace must be used within PolicyWorkspaceProvider');
  return ctx;
}
