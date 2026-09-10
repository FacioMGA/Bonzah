import React, { useCallback } from 'react';
import type { PendingProductChangeConfirmation } from '../../hooks/usePolicyProgramsBinders';
import { Button } from '@/src/shared/ui';
import { Modal } from '@/src/shared/ui';
import { Textarea } from '@/src/shared/ui';

import { Feed as PolicyFeed } from '../../feed/views/FeedTab';
import { Documents as PolicyDocuments } from '../../documents/views/DocumentsTab';
import { Billing as PolicyBilling } from '../../billing/views/BillingTab';
import { CommunicationsTab as PolicyCommunications } from '@/src/modules/communications/views/CommunicationsTab';
import { Policyholder } from '../../policyholder/views/PolicyholderTab';

import { Underwriting as PolicyUnderwriting } from '../../underwriting/views/UnderwritingTab';
import { CoveragesAndOptions } from '../../mbe/views/CoveragesAndOptions';
import { Premium as PolicyPremium } from '../../premium/views/PremiumTab';

import { PolicyWorkspaceProvider } from '../PolicyWorkspaceContext';
import type { PolicyWorkspaceContextValue } from '../PolicyWorkspaceContext';
import { PolicyWorkspaceHeader } from './PolicyWorkspaceHeader';
import { UwSelfAssignCard } from './UwSelfAssignCard';
import { StaffAllocateCard } from './StaffAllocateCard';

import {
  usePolicyDetailViewController,
  formatDateUI,
  formatMoneyUI,
} from '../../hooks/usePolicyDetailViewController';
import { asRecord } from '@/src/shared/lib/record';
import { hasPermission } from '@/src/modules/auth/session';
import { useSession } from '@/src/modules/auth/useSession';
import { boApiClient as boApi } from '@/src/shared/api/boApiClient';
import type { UserRecord } from '@/src/modules/accessControl/model/types';
import { filterStaffDirectoryForAssign } from '../staffAssignHelpers';

// ── Props ─────────────────────────────────────────────────────────

type PolicyWorkspaceProps = {
  value: PolicyWorkspaceContextValue;

  activeTab: string;
  setActiveTab: (tab: string) => void;
  tabToHash: (tab: string) => string;
  location: { search?: string; pathname: string; hash?: string };
  navigate: (
    to: string | { pathname: string; search?: string; hash?: string },
    options?: { replace?: boolean; preventScrollReset?: boolean },
  ) => void;
  setShowHistoryModal: (open: boolean) => void;

  policyHolderVm?: Pick<
    React.ComponentProps<typeof Policyholder>,
    'selectedPortfolio' | 'isEditing' | 'formErrors' | 'showValidation' | 'readOnly' | 'endorsementDraftRiskTransactionId' | 'countryOptions' | 'loading'
  >;
  policyHolderActions?: Pick<
    React.ComponentProps<typeof Policyholder>,
    'setSelectedPortfolio' | 'setIsEditing' | 'validateField' | 'clearFieldError' | 'setFieldError' | 'endorsementFieldChanged' | 'handleSavePolicy' | 'handleSavePolicyHolder' | 'handleCancelPolicyHolder' | 'loadPolicyDetails'
  >;
  formErrors?: React.ComponentProps<typeof Policyholder>['formErrors'];
  validateField?: React.ComponentProps<typeof Policyholder>['validateField'];
  clearFieldError?: React.ComponentProps<typeof Policyholder>['clearFieldError'];
  setFieldError?: React.ComponentProps<typeof Policyholder>['setFieldError'];
  endorsementFieldChanged?: React.ComponentProps<typeof Policyholder>['endorsementFieldChanged'];
  handleSavePolicy?: React.ComponentProps<typeof Policyholder>['handleSavePolicy'];
  handleSavePolicyHolder?: React.ComponentProps<typeof Policyholder>['handleSavePolicyHolder'];
  handleCancelPolicyHolder?: React.ComponentProps<typeof Policyholder>['handleCancelPolicyHolder'];
  countryOptions?: React.ComponentProps<typeof Policyholder>['countryOptions'];

  billing: {
    billingSummary: React.ComponentProps<typeof PolicyBilling>['billingSummary'];
    billingLoading: React.ComponentProps<typeof PolicyBilling>['billingLoading'];
    openBillingCharge: React.ComponentProps<typeof PolicyBilling>['onOpenCharge'];
    openBillingRefund: React.ComponentProps<typeof PolicyBilling>['onOpenRefund'];
  };
  docs: React.ComponentProps<typeof PolicyDocuments>['docs'];

  service: {
    openCancelRequestModal: () => void;
    isRequestingCancellation: boolean;
    isApprovingCancellation: boolean;
    setIsApprovingCancellation: (approving: boolean) => void;
  };
  /** Set when usePolicyProgramsBinders needs UW confirmation before saving a product change. */
  pendingProgramBinderChange?: PendingProductChangeConfirmation | null;
  setPendingProgramBinderChange?: (change: PendingProductChangeConfirmation | null) => void;
};

// ── Component ─────────────────────────────────────────────────────

export function PolicyWorkspace(props: PolicyWorkspaceProps) {
  const { user } = useSession();
  const {
    value,
    activeTab,
    setActiveTab,
    tabToHash,
    location,
    navigate,
    setShowHistoryModal,
    policyHolderVm,
    policyHolderActions,
    billing,
    docs,
    service,
    pendingProgramBinderChange,
    setPendingProgramBinderChange,
  } = props;

  const {
    selectedPortfolio,
    displayedPortfolio,
    endorsementDraftRiskTransactionId,
    policyVersions,
  } = value;

  // ── Controller (header, status badge, cancellation) ──────────
  const ctrl = usePolicyDetailViewController({
    selectedPortfolio,
    viewingRiskTransactionSnapshot: (value.viewingRiskTransactionSnapshot as Record<string, unknown>) ?? null,
    endorsementDraftRiskTransactionId,
    questionnaireLastSentAt: value.questionnaireLastSentAt,
    qStatus: value.qStatus,
    getQuoteOrigin: value.getQuoteOrigin,
    setIsApprovingCancellation: service.setIsApprovingCancellation,
    setViewingVersionId: value.lifecycle.setViewingVersionId,
    setViewingRiskTransactionSnapshot: value.lifecycle.setViewingRiskTransactionSnapshot,
    setViewingRiskTransactionId: value.lifecycle.setViewingRiskTransactionId,
    setToastMessage: value.setToastMessage,
    setShowToast: value.setShowToast,
    loadPolicyDetails: value.loadPolicyDetails,
    loadPolicies: value.loadPolicies,
    setActiveTab,
    navigate,
    location,
    editingScope: value.editingScope,
    setEditingScope: value.setEditingScope,
    isApprovingCancellation: service.isApprovingCancellation,
  });

  // ── Scoped edit-state helpers ─────────────────────────────────
  // Each tab derives a boolean from the single editingScope and writes back via a
  // stable setter so child components keep a simple boolean API.
  const { setEditingScope } = value;
  const isPolicyHolderEditing = value.editingScope === 'policyHolder';
  const isUnderwritingEditing = value.editingScope === 'underwriting';

  const setIsPolicyHolderEditing = useCallback(
    (v: boolean) => setEditingScope(v ? 'policyHolder' : null),
    [setEditingScope],
  );
  const setIsUnderwritingEditing = useCallback(
    (v: boolean) => setEditingScope(v ? 'underwriting' : null),
    [setEditingScope],
  );

  // ── Communications template defaults ─────────────────────────
  const communicationsTemplateDefaults = React.useMemo<Record<string, string>>(() => {
    const source = (displayedPortfolio || selectedPortfolio || {}) as Record<string, unknown>;
    const quoteData = asRecord(source.quoteData);
    const proposer = asRecord(quoteData.proposer);
    const firstName = String(proposer.firstName || '').trim();
    const lastName = String(proposer.lastName || '').trim();
    const customerName = [firstName, lastName].filter(Boolean).join(' ').trim();
    return {
      'customer.firstName': firstName,
      'customer.lastName': lastName,
      'customer.name': customerName,
      'customer.email': String(proposer.email || '').trim(),
      'customer.phone': String(proposer.phone || '').trim(),
      'policy.number': String(source.policyNumber || '').trim(),
      'policy.startDate': String(source.start || '').trim(),
      'policy.endDate': String(source.end || '').trim(),
      'quote.premium': String(source.totalPremium || '').trim(),
    };
  }, [displayedPortfolio, selectedPortfolio]);

  const [assigneeSearch, setAssigneeSearch] = React.useState('');
  const [selectedAssigneeId, setSelectedAssigneeId] = React.useState('');
  const [assigneeOptions, setAssigneeOptions] = React.useState<UserRecord[]>([]);
  const [staffDirectoryLoading, setStaffDirectoryLoading] = React.useState(false);
  const [assigningPolicy, setAssigningPolicy] = React.useState(false);
  const [assignmentMessage, setAssignmentMessage] = React.useState<string | null>(null);
  const [assignmentError, setAssignmentError] = React.useState<string | null>(null);

  const canAllocateRenewals = hasPermission(user, 'renewals.allocate');

  React.useEffect(() => {
    const query = assigneeSearch.trim();
    if (!canAllocateRenewals || query.length < 2) {
      setAssigneeOptions([]);
      return;
    }
    let cancelled = false;
    setStaffDirectoryLoading(true);
    const timer = window.setTimeout(() => {
      void boApi.listStaffDirectory({ search: query, limit: 8 })
        .then((response) => {
          if (!cancelled && response.success && Array.isArray(response.data)) {
            setAssigneeOptions(filterStaffDirectoryForAssign(response.data, query));
          }
        })
        .catch(() => {
          if (!cancelled) setAssigneeOptions([]);
        })
        .finally(() => {
          if (!cancelled) setStaffDirectoryLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [assigneeSearch, canAllocateRenewals]);

  const assignReviewToMe = async () => {
    const policyId = String(asRecord(selectedPortfolio).policyId || selectedPortfolio?.id || '').trim();
    const selfId = String(user?.id || '').trim();
    if (!policyId || !selfId) {
      setAssignmentError('Sign in before taking this UW review.');
      return;
    }
    setSelectedAssigneeId(selfId);
    setAssigneeSearch(user?.name || selfId);
    setAssigningPolicy(true);
    setAssignmentError(null);
    setAssignmentMessage(null);
    try {
      const response = await boApi.assignPolicyToStaff({ policyId, assignedToUserId: selfId });
      if (!response.success) {
        setAssignmentError(response.error?.message || 'Failed to assign this UW review to you.');
        return;
      }
      setAssignmentMessage('UW review assigned to you.');
      value.setToastMessage('UW review assigned to you.');
      value.setShowToast(true);
      await value.loadPolicyDetails();
    } catch (err) {
      setAssignmentError(err instanceof Error ? err.message : 'Failed to assign this UW review to you.');
    } finally {
      setAssigningPolicy(false);
    }
  };

  const assignPolicyToStaff = async () => {
    const policyId = String(asRecord(selectedPortfolio).policyId || selectedPortfolio?.id || '').trim();
    const assigneeId = selectedAssigneeId;
    if (!policyId) {
      setAssignmentError('Select a policy before assigning staff.');
      return;
    }
    if (!assigneeId) {
      setAssignmentError('Choose an active staff member from the list.');
      return;
    }
    setAssigningPolicy(true);
    setAssignmentError(null);
    setAssignmentMessage(null);
    try {
      const response = await boApi.assignPolicyToStaff({ policyId, assignedToUserId: assigneeId });
      if (!response.success) {
        setAssignmentError(response.error?.message || 'Failed to assign policy.');
        return;
      }
      setAssignmentMessage('Policy assignment saved.');
      value.setToastMessage('Policy assignment saved.');
      value.setShowToast(true);
      await value.loadPolicyDetails();
    } catch (err) {
      setAssignmentError(err instanceof Error ? err.message : 'Failed to assign policy.');
    } finally {
      setAssigningPolicy(false);
    }
  };

  // ── Early returns ────────────────────────────────────────────
  if (!selectedPortfolio) return <div className="p-10 text-center text-slate-500">No portfolio selected</div>;
  if (selectedPortfolio?.id === 'new' || selectedPortfolio?.isNew) {
    return (
      <div className="ui-page max-w-none space-y-6 pb-32">
        <div className="ui-card ui-card-pad">
          <div className="flex items-center gap-4">
            <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-brand-primary"></span>
            <div className="text-slate-700 font-bold">Creating a new submission…</div>
          </div>
          <div className="mt-2 text-xs font-semibold text-slate-500">
            This should only take a moment. If it doesn&apos;t, refresh and we&apos;ll retry automatically.
          </div>
        </div>
      </div>
    );
  }

  // ── Derived state ────────────────────────────────────────────
  const tabs = [
    'Policy Holder',
    'Underwriting', 'Coverage', 'Premium',
    'Billing', 'Documents', 'Communications', 'Service', 'Feed',
  ];
  // PH validation/readOnly is scoped to the policyHolder editing workflow.
  const showValidation = Boolean(isPolicyHolderEditing || selectedPortfolio?.isNew);
  const readOnly = !showValidation;
  // Any active edit scope drives the 'bo-edit-mode' root class (prevents nav away without save etc.).
  const anyEditActive = Boolean(value.editingScope) || Boolean(selectedPortfolio?.isNew);
  const canViewDocuments = hasPermission(user, 'documents.view');
  const canDownloadDocuments = hasPermission(user, 'documents.download');
  const canTakeUwReview = hasPermission(user, 'underwriting.review.receive');
  const assignmentSnapshot = asRecord(asRecord(selectedPortfolio).assignment);
  const assignedUser = asRecord(assignmentSnapshot.assignedToUser);
  const currentAssigneeLabel = String(
    assignedUser.name ||
    [assignedUser.firstName, assignedUser.lastName].filter(Boolean).join(' ') ||
    assignmentSnapshot.assignedToUserId ||
    '',
  ).trim();
  const selectedAssignee = assigneeOptions.find((option) => option.id === selectedAssigneeId) || null;
  const assigneeLoading = staffDirectoryLoading;

  // ── Policyholder tab resolution ──────────────────────────────
  const resolvedPolicyHolderVm = policyHolderVm ?? {
    selectedPortfolio: selectedPortfolio as React.ComponentProps<typeof Policyholder>['selectedPortfolio'],
    isEditing: isPolicyHolderEditing,
    formErrors: (props.formErrors ?? {}) as React.ComponentProps<typeof Policyholder>['formErrors'],
    showValidation,
    readOnly,
    endorsementDraftRiskTransactionId,
    countryOptions: (props.countryOptions ?? []) as React.ComponentProps<typeof Policyholder>['countryOptions'],
    loading: value.loading,
  };
  const resolvedPolicyHolderActions = policyHolderActions ?? {
    setSelectedPortfolio: value.lifecycle.setSelectedPortfolio as React.ComponentProps<typeof Policyholder>['setSelectedPortfolio'],
    setIsEditing: setIsPolicyHolderEditing,
    validateField: (props.validateField ?? (() => {})) as React.ComponentProps<typeof Policyholder>['validateField'],
    clearFieldError: (props.clearFieldError ?? (() => {})) as React.ComponentProps<typeof Policyholder>['clearFieldError'],
    setFieldError: (props.setFieldError ?? (() => {})) as React.ComponentProps<typeof Policyholder>['setFieldError'],
    endorsementFieldChanged: (props.endorsementFieldChanged ?? (() => {})) as React.ComponentProps<typeof Policyholder>['endorsementFieldChanged'],
    handleSavePolicy: (props.handleSavePolicy ?? (async () => {})) as React.ComponentProps<typeof Policyholder>['handleSavePolicy'],
    handleSavePolicyHolder: (props.handleSavePolicyHolder ?? (async () => {})) as React.ComponentProps<typeof Policyholder>['handleSavePolicyHolder'],
    handleCancelPolicyHolder: (props.handleCancelPolicyHolder ?? (() => {})) as React.ComponentProps<typeof Policyholder>['handleCancelPolicyHolder'],
    loadPolicyDetails: value.loadPolicyDetails,
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <PolicyWorkspaceProvider value={value}>
      <div className={`ui-page max-w-none space-y-10 animate-in fade-in duration-500 pb-32 ${anyEditActive ? 'bo-edit-mode' : ''}`}>
        <PolicyWorkspaceHeader ctrl={ctrl} setShowHistoryModal={setShowHistoryModal} navigate={navigate} />

        {/* Tabs */}
        <div className="ui-card ui-card-flat bg-brand-canvas">
          <div className="px-0 bg-brand-canvas">
            <div ref={ctrl.tabsContainerRef} className="ui-tabsbar">
              {tabs.map((tab) => (
                <Button
                  key={tab}
                  type="button"
                  variant="tab"
                  size="tab"
                  onClick={() => {
                    const nextHash = `#${tabToHash(tab)}`;
                    if (location.hash === nextHash) return;
                    navigate(
                      { pathname: location.pathname, search: location.search, hash: nextHash },
                      { replace: true, preventScrollReset: true },
                    );
                  }}
                  className={`ui-tab ${activeTab === tab ? 'ui-tab-active' : 'ui-tab-inactive'}`}
                >
                  {tab}
                </Button>
              ))}
            </div>
          </div>

          <div className="px-0 pt-4 pb-8 bg-brand-canvas min-h-workspace">
            <div key={activeTab} className="ui-tabpanel-enter">
              {activeTab === 'Policy Holder' && (
                <div className="space-y-6">
                  <UwSelfAssignCard
                    visible={canTakeUwReview}
                    currentAssigneeLabel={currentAssigneeLabel}
                    assignmentError={assignmentError}
                    assignmentMessage={assignmentMessage}
                    assigning={assigningPolicy}
                    onAssign={() => { void assignReviewToMe(); }}
                  />
                  <Policyholder
                    selectedPortfolio={resolvedPolicyHolderVm.selectedPortfolio}
                    setSelectedPortfolio={resolvedPolicyHolderActions.setSelectedPortfolio}
                    isEditing={resolvedPolicyHolderVm.isEditing}
                    setIsEditing={resolvedPolicyHolderActions.setIsEditing}
                    formErrors={resolvedPolicyHolderVm.formErrors}
                    validateField={resolvedPolicyHolderActions.validateField}
                    clearFieldError={resolvedPolicyHolderActions.clearFieldError}
                    setFieldError={resolvedPolicyHolderActions.setFieldError}
                    showValidation={resolvedPolicyHolderVm.showValidation}
                    readOnly={resolvedPolicyHolderVm.readOnly}
                    endorsementFieldChanged={resolvedPolicyHolderActions.endorsementFieldChanged}
                    loading={resolvedPolicyHolderVm.loading}
                    handleSavePolicy={resolvedPolicyHolderActions.handleSavePolicy}
                    handleSavePolicyHolder={resolvedPolicyHolderActions.handleSavePolicyHolder}
                    handleCancelPolicyHolder={resolvedPolicyHolderActions.handleCancelPolicyHolder}
                    loadPolicyDetails={resolvedPolicyHolderActions.loadPolicyDetails}
                    countryOptions={resolvedPolicyHolderVm.countryOptions}
                    endorsementDraftRiskTransactionId={resolvedPolicyHolderVm.endorsementDraftRiskTransactionId}
                  />
                </div>
              )}

              {/*
                Context fields here are typed as `unknown` / loosely-typed
                generics in `PolicyWorkspaceContext` because the workspace
                does not own the schema for risk-models / programs / binders
                / readiness payloads — the per-tab components do. We bridge
                via `React.ComponentProps<typeof Tab>['<prop>']` so each
                tab keeps its own stricter prop type as the contract; no
                escape-hatch generics are used.
              */}
              {activeTab === 'Underwriting' && (
                <PolicyUnderwriting
                  isEditing={isUnderwritingEditing}
                  setIsEditing={setIsUnderwritingEditing}
                  pendingProductChange={pendingProgramBinderChange ?? null}
                  onPendingProductChangeClear={() => setPendingProgramBinderChange?.(null)}
                  issueReadiness={value.issueReadiness as React.ComponentProps<typeof PolicyUnderwriting>['issueReadiness']}
                  selectedPortfolio={value.selectedPortfolio}
                  selectedBinderId={value.selectedBinderId as React.ComponentProps<typeof PolicyUnderwriting>['selectedBinderId']}
                  setSelectedBinderId={value.setSelectedBinderId as React.ComponentProps<typeof PolicyUnderwriting>['setSelectedBinderId']}
                  setSelectedPortfolio={value.lifecycle.setSelectedPortfolio}
                  availableBinders={value.availableBinders as React.ComponentProps<typeof PolicyUnderwriting>['availableBinders']}
                  bindersLoading={value.bindersLoading}
                  selectedProgramId={value.selectedProgramId as React.ComponentProps<typeof PolicyUnderwriting>['selectedProgramId']}
                  setSelectedProgramId={value.setSelectedProgramId}
                  programs={value.programs as React.ComponentProps<typeof PolicyUnderwriting>['programs']}
                  programsLoading={value.programsLoading}
                  handleSendQuestionnaire={value.handleSendQuestionnaire}
                  isSending={value.isSending}
                  questionnaireLastSentAt={value.questionnaireLastSentAt}
                  qStatus={value.qStatus as React.ComponentProps<typeof PolicyUnderwriting>['qStatus']}
                  getQuestionValue={value.getQuestionValue}
                  uwAnswers={value.uwAnswers}
                  riskModel={value.riskModel as React.ComponentProps<typeof PolicyUnderwriting>['riskModel']}
                  followUpsSentMap={value.followUpsSentMap}
                  isEndorsementMode={value.isEndorsementMode}
                  openFollowUp={value.openFollowUp}
                  showBatchModal={value.showBatchModal}
                  setShowBatchModal={value.setShowBatchModal}
                  handleSendBatch={value.handleSendBatch}
                  setUwAnswers={value.setUwAnswers}
                  getQuoteOrigin={value.getQuoteOrigin as React.ComponentProps<typeof PolicyUnderwriting>['getQuoteOrigin']}
                  openQuoteWizard={value.openQuoteWizard}
                  showRequestInfoModal={value.showRequestInfoModal}
                  setShowRequestInfoModal={value.setShowRequestInfoModal}
                  requestInfoStep={value.requestInfoStep}
                  setRequestInfoStep={value.setRequestInfoStep}
                  requestInfoMessage={value.requestInfoMessage}
                  setRequestInfoMessage={value.setRequestInfoMessage}
                  isRequestingInfo={value.isRequestingInfo}
                  setIsRequestingInfo={value.setIsRequestingInfo}
                  loadPolicyDetails={value.loadPolicyDetails}
                  loadPolicies={value.loadPolicies}
                  handleReRate={value.lifecycle.handleReRate}
                  isReRating={value.lifecycle.isReRating}
                  setToastMessage={value.setToastMessage}
                  setShowToast={value.setShowToast}
                  endorsementDraftRiskTransactionId={endorsementDraftRiskTransactionId}
                  refreshIssueReadiness={() =>
                    value.refreshIssueReadiness(
                      String(value.selectedPortfolio?.id || ''),
                      endorsementDraftRiskTransactionId
                        ? { riskTransactionId: endorsementDraftRiskTransactionId }
                        : undefined
                    )
                  }
                />
              )}

              {activeTab === 'Coverage' && value.selectedPortfolio?.id && (
                <CoveragesAndOptions
                  policyId={String(value.selectedPortfolio.id)}
                  policySnapshot={displayedPortfolio ? asRecord(displayedPortfolio) : asRecord(selectedPortfolio)}
                  programId={value.selectedProgramId || undefined}
                  riskTransactionId={endorsementDraftRiskTransactionId || null}
                  readOnly={value.isIssuedRecordMode}
                  onRefreshPolicy={() => {
                    void value.reloadCurrentPolicy(
                      endorsementDraftRiskTransactionId
                        ? { riskTransactionId: endorsementDraftRiskTransactionId }
                        : undefined
                    );
                  }}
                />
              )}

              {activeTab === 'Premium' && (
                <PolicyPremium
                  selectedPortfolio={value.selectedPortfolio}
                  displayedPortfolio={displayedPortfolio || undefined}
                  endorsementDraftRiskTransactionId={endorsementDraftRiskTransactionId}
                  viewingRiskTransactionSnapshot={value.viewingRiskTransactionSnapshot as React.ComponentProps<typeof PolicyPremium>['viewingRiskTransactionSnapshot']}
                  viewingVersionId={value.viewingVersionId}
                  viewingRiskTransactionId={value.viewingRiskTransactionId}
                  policyVersions={policyVersions as React.ComponentProps<typeof PolicyPremium>['policyVersions']}
                  isIssuedRecordMode={value.isIssuedRecordMode}
                  isIssuedLifecycle={value.isIssuedLifecycle}
                  latestIssuedRiskTransactionId={value.latestIssuedRiskTransactionId}
                  mbeTemplates={(value.lifecycle.mbeTemplates ?? []) as React.ComponentProps<typeof PolicyPremium>['mbeTemplates']}
                  excessImpact={(value.lifecycle.excessImpact ?? null) as React.ComponentProps<typeof PolicyPremium>['excessImpact']}
                  excessImpactLoading={value.lifecycle.excessImpactLoading ?? false}
                  coverageDirty={value.lifecycle.coverageDirty ?? false}
                  canSaveQuoteVersion={value.lifecycle.canSaveQuoteVersion}
                  issueReadiness={value.issueReadiness as React.ComponentProps<typeof PolicyPremium>['issueReadiness']}
                  issueReadinessLoading={value.issueReadinessLoading}
                  quoteSentAt={value.lifecycle.quoteSentAt ? String(value.lifecycle.quoteSentAt) : null}
                  quoteSentKey={value.lifecycle.quoteSentKey}
                  isReRating={value.lifecycle.isReRating}
                  isSavingQuoteVersion={value.lifecycle.isSavingQuoteVersion}
                  isUnlockingBoundMode={value.lifecycle.isUnlockingBoundMode}
                  isIssuingQuote={value.lifecycle.isIssuingQuote}
                  isBindingCoverage={value.lifecycle.isBindingCoverage}
                  isIssuingPolicyFinal={value.lifecycle.isIssuingPolicyFinal}
                  isBindingEndorsementDraft={value.lifecycle.isBindingEndorsementDraft}
                  isIssuingEndorsement={value.lifecycle.isIssuingEndorsement}
                  isCancellingEndorsementDraft={value.lifecycle.isCancellingEndorsementDraft}
                  setCoverageDirty={value.lifecycle.setCoverageDirty}
                  setCanSaveQuoteVersion={value.lifecycle.setCanSaveQuoteVersion}
                  clearQuoteSentIndicator={value.lifecycle.clearQuoteSentIndicator}
                  setSelectedPortfolio={value.lifecycle.setSelectedPortfolio}
                  setViewingRiskTransactionSnapshot={value.lifecycle.setViewingRiskTransactionSnapshot}
                  setViewingVersionId={value.lifecycle.setViewingVersionId}
                  setViewingRiskTransactionId={value.lifecycle.setViewingRiskTransactionId}
                  setShowRestoreVersionModal={value.lifecycle.setShowRestoreVersionModal}
                  setShowPricingSteps={value.lifecycle.setShowPricingSteps}
                  setShowCreateEndorsementModal={value.lifecycle.setShowCreateEndorsementModal}
                  setEndorsementEffectiveDate={(v) => value.lifecycle.setEndorsementEffectiveDate(v)}
                  setEndorsementReason={value.lifecycle.setEndorsementReason}
                  handleCancelEndorsementDraft={value.lifecycle.handleCancelEndorsementDraft}
                  handleReRate={value.lifecycle.handleReRate}
                  handleSaveQuoteVersion={value.lifecycle.handleSaveQuoteVersion}
                  handleUnlockBoundMode={value.lifecycle.handleUnlockBoundMode}
                  handleIssueQuote={value.lifecycle.handleIssueQuote}
                  handleBindCoverage={value.lifecycle.handleBindCoverage}
                  handleIssuePolicyFinal={value.lifecycle.handleIssuePolicyFinal}
                  handleBindEndorsementDraft={value.lifecycle.handleBindEndorsementDraft}
                  handleIssueEndorsement={value.lifecycle.handleIssueEndorsement}
                  handleSendQuestionnaire={value.handleSendQuestionnaire}
                  reloadCurrentPolicy={() =>
                    value.reloadCurrentPolicy(
                      endorsementDraftRiskTransactionId
                        ? { riskTransactionId: endorsementDraftRiskTransactionId }
                        : undefined
                    )
                  }
                  refreshIssueReadiness={() =>
                    value.refreshIssueReadiness(
                      String(value.selectedPortfolio?.id || ''),
                      endorsementDraftRiskTransactionId
                        ? { riskTransactionId: endorsementDraftRiskTransactionId }
                        : undefined
                    )
                  }
                  openQuoteWizard={() => {
                    const policyId = String(asRecord(value.selectedPortfolio).policyId || value.selectedPortfolio?.id || '');
                    if (!policyId || policyId === 'new') return;
                    void value.openQuoteWizard(policyId, 'policy-holder');
                  }}
                  uwAnswers={value.uwAnswers}
                  setUwAnswers={value.setUwAnswers}
                  isEndorsementMode={value.isEndorsementMode}
                  aggregateLimit={(value.lifecycle.aggregateLimit ?? null) as React.ComponentProps<typeof PolicyPremium>['aggregateLimit']}
                  setAggregateLimit={(value.lifecycle.setAggregateLimit ?? (() => {})) as React.ComponentProps<typeof PolicyPremium>['setAggregateLimit']}
                  parseDateLoose={value.parseDateLoose as React.ComponentProps<typeof PolicyPremium>['parseDateLoose']}
                  toISODateOnly={value.toISODateOnly}
                  calcExpiryDateFromStart={value.calcExpiryDateFromStart}
                  formatMoneyUI={formatMoneyUI}
                  handleGenerateQuote={value.lifecycle.handleGenerateQuote}
                  isGeneratingQuote={value.lifecycle.isGeneratingQuote}
                  handleBindPolicy={value.lifecycle.handleBindPolicy}
                  isBindingPolicy={value.lifecycle.isBindingPolicy}
                  bindEndorsement={value.bindEndorsement}
                  cancelEndorsement={value.cancelEndorsement}
                  selectedBinderId={value.selectedBinderId ?? undefined}
                  availableBinders={value.availableBinders as React.ComponentProps<typeof PolicyPremium>['availableBinders']}
                  selectedProgramId={value.selectedProgramId ?? undefined}
                  programs={value.programs as React.ComponentProps<typeof PolicyPremium>['programs']}
                />
              )}

              {activeTab === 'Billing' && (
                <PolicyBilling
                  selectedPortfolio={selectedPortfolio}
                  billingSummary={billing.billingSummary}
                  billingLoading={billing.billingLoading}
                  onOpenCharge={billing.openBillingCharge}
                  onOpenRefund={billing.openBillingRefund}
                  onToast={(message) => {
                    value.setToastMessage(message);
                    value.setShowToast(true);
                  }}
                />
              )}

              {activeTab === 'Service' && (
                <div className="space-y-10 max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-300">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <div className="text-2xl font-black text-slate-900">Service</div>
                      <div className="text-xs text-slate-500 mt-1">Cancellation requests and service actions.</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="md"
                        onClick={service.openCancelRequestModal}
                        disabled={service.isRequestingCancellation || service.isApprovingCancellation}
                        className="gap-2"
                      >
                        Record cancellation request
                      </Button>
                    </div>
                  </div>

                  <StaffAllocateCard
                    canAllocate={canAllocateRenewals}
                    currentAssigneeLabel={currentAssigneeLabel}
                    assigneeSearch={assigneeSearch}
                    selectedAssigneeId={selectedAssigneeId}
                    assigneeOptions={assigneeOptions}
                    assigneeLoading={assigneeLoading}
                    assigning={assigningPolicy}
                    assignmentError={assignmentError}
                    assignmentMessage={assignmentMessage}
                    selectedAssignee={selectedAssignee}
                    onSearchChange={(value) => {
                      setAssigneeSearch(value);
                      setSelectedAssigneeId('');
                      setAssignmentMessage(null);
                      setAssignmentError(null);
                    }}
                    onSelectAssignee={(id, label) => {
                      setSelectedAssigneeId(id);
                      setAssigneeSearch(label);
                    }}
                    onAssign={() => { void assignPolicyToStaff(); }}
                  />

                  {ctrl.cancellation.policyStatusUpper === 'CANCELLATION_REQUESTED' && (
                    <div className="rounded-2xl border-2 border-red-200 bg-red-50/70 p-4 flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-sm font-black text-red-800">
                          {ctrl.cancellation.rowStatus === 'PROCESSING' ? 'Cancellation request is being processed' : 'Cancellation request received'}
                        </div>
                        <div className="text-xs text-red-700 mt-1">
                          {ctrl.cancellation.requestedAt
                            ? `Requested on ${formatDateUI(ctrl.cancellation.requestedAt, { withTime: true })}.`
                            : 'Requested by policyholder.'}
                        </div>
                      </div>
                      <div className="text-xs font-semibold text-red-700">
                        Use the actions in the request row below.
                      </div>
                    </div>
                  )}

                  {ctrl.cancellation.hasRequest && (
                    <div className="ui-card ui-card-pad overflow-x-auto">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Cancellation requests</div>
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-left text-slate-500">
                            <th className="py-2 pr-3">Requester</th>
                            <th className="py-2 pr-3">Requested at</th>
                            <th className="py-2 pr-3">Effective date</th>
                            <th className="py-2 pr-3">Status</th>
                            <th className="py-2 pr-3">Reason</th>
                            <th className="py-2 pr-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t border-slate-100 text-slate-700">
                            <td className="py-2 pr-3 font-semibold">{ctrl.cancellation.requestedBy}</td>
                            <td className="py-2 pr-3">{ctrl.cancellation.requestedAt ? formatDateUI(ctrl.cancellation.requestedAt, { withTime: true }) : '—'}</td>
                            <td className="py-2 pr-3">{ctrl.cancellation.requestedEffectiveDate || '—'}</td>
                            <td className="py-2 pr-3">
                              <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-tight border ${ctrl.cancellation.chipClass}`}>
                                {ctrl.cancellation.rowStatus}
                              </span>
                            </td>
                            <td className="py-2 pr-3 max-w-[340px] truncate" title={ctrl.cancellation.reason}>{ctrl.cancellation.reason}</td>
                            <td className="py-2 pr-3 text-right">
                              {ctrl.cancellation.canHandle ? (
                                <div className="inline-flex items-center gap-2">
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={ctrl.processCancellationRequest}
                                    disabled={ctrl.isApprovingCancellation}
                                    className="gap-2 bg-red-600 hover:bg-red-700 border-red-600 text-white"
                                  >
                                    Process
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => ctrl.setShowRejectCancellationModal(true)}
                                    disabled={ctrl.isApprovingCancellation}
                                    className="gap-2"
                                  >
                                    Reject
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400 font-semibold">—</span>
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'Feed' && (
                <PolicyFeed policyId={selectedPortfolio?.id ? String(selectedPortfolio.id) : undefined} />
              )}

              {activeTab === 'Communications' && (
                <div className="h-[min(72vh,820px)] min-h-[560px]">
                  <PolicyCommunications
                    entityType="POLICY"
                    entityId={String(selectedPortfolio?.id || location.pathname.split('/').pop() || '')}
                    primaryPartyId={String(asRecord(selectedPortfolio?.contact)?.id || '')}
                    templateDefaults={communicationsTemplateDefaults}
                  />
                </div>
              )}

              {activeTab === 'Documents' && (
                <PolicyDocuments
                  policyId={selectedPortfolio?.id ? String(selectedPortfolio.id) : undefined}
                  docs={docs}
                  policyVersions={(policyVersions || []) as React.ComponentProps<typeof PolicyDocuments>['policyVersions']}
                  setToastMessage={value.setToastMessage}
                  setShowToast={value.setShowToast}
                  canViewDocuments={canViewDocuments}
                  canDownloadDocuments={canDownloadDocuments}
                />
              )}
            </div>
          </div>
        </div>

        <Modal
          isOpen={ctrl.showRejectCancellationModal}
          onClose={() => {
            if (ctrl.isApprovingCancellation) return;
            ctrl.setShowRejectCancellationModal(false);
            ctrl.setRejectCancellationReason('');
          }}
          title="Reject cancellation request"
          actions={(
            <>
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={() => {
                  ctrl.setShowRejectCancellationModal(false);
                  ctrl.setRejectCancellationReason('');
                }}
                className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition bg-transparent"
                disabled={ctrl.isApprovingCancellation}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={ctrl.rejectCancellationRequest}
                className="bg-brand-primary text-white px-6 py-3 rounded-xl font-black shadow-lg hover:bg-brand-secondary transition disabled:opacity-60"
                disabled={ctrl.isApprovingCancellation}
              >
                {ctrl.isApprovingCancellation ? 'Rejecting…' : 'Reject request'}
              </Button>
            </>
          )}
        >
          <div className="space-y-3">
            <div className="text-sm text-slate-600">
              Add a reason to keep the service history clear for operations and support.
            </div>
            <div>
              <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Reason (optional)</label>
              <Textarea
                value={ctrl.rejectCancellationReason}
                onChange={(e) => ctrl.setRejectCancellationReason(e.target.value)}
                placeholder="Explain why this request was rejected."
                className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-bold text-slate-800 focus:border-brand-primary outline-none transition-all min-h-panelSm"
                disabled={ctrl.isApprovingCancellation}
              />
            </div>
          </div>
        </Modal>
      </div>
    </PolicyWorkspaceProvider>
  );
}
