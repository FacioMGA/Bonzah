/**
 * PolicyPage — CHAMPS Thin Shell
 *
 * This component contains ZERO domain rules.
 * It only:
 *   1. Calls usePolicyPageController
 *   2. Passes controller output to views
 *   3. Renders JSX
 *
 * All orchestration, state, and side effects live in the controller.
 */
import React from 'react';
import { usePolicyPageController } from '../../hooks/usePolicyPageController';
import { Toast } from '@/src/shared/ui';
import { CancelRequestModal } from './modals/CancelRequestModal';
import { BindCoverageWorkflowModal } from './modals/BindCoverageWorkflowModal';
import { BindEndorsementWorkflowModal } from './modals/BindEndorsementWorkflowModal';
import { DeletePolicyModal } from './modals/DeletePolicyModal';
import { BindConfirmationModal } from './modals/BindConfirmationModal';
import { FollowUpDrawer } from './modals/FollowUpDrawer';
import { PolicyListView } from '../../list/views/PolicyListView';
import { PolicyWorkspace } from './PolicyWorkspace';
import type { PolicyWorkspaceContextValue } from '../PolicyWorkspaceContext';
import { PolicyModals } from './PolicyModals';
import { PolicyBillingModals } from './PolicyBillingModals';
import { asRecord } from '@/src/shared/lib/record';

export function PolicyPage() {
  const c = usePolicyPageController();

  const renderList = () => (
    <PolicyListView
      onCreateNewPolicy={c.handleCreateNewQuote}
      onRequestDeletePolicy={c.handleDeletePolicy}
    />
  );

  const renderDetail = () => {
    const lifecycle: PolicyWorkspaceContextValue['lifecycle'] = {
      ...c.lifecycle,
      mbeTemplates: c.mbeTemplates || [],
      excessImpact: c.excessImpact,
      excessImpactLoading: Boolean(c.excessImpactLoading),
      coverageDirty: Boolean(c.coverageDirty),
      aggregateLimit: c.aggregateLimit,
      setAggregateLimit: c.setAggregateLimit,
    };

    const contextValue: PolicyWorkspaceContextValue = {
      policyId: c.selectedPortfolio?.id ? String(c.selectedPortfolio.id) : null,
      productType: String(asRecord(c.selectedPortfolio).productType || ''),
      selectedPortfolio: c.selectedPortfolio,
      displayedPortfolio: c.displayedPortfolio ?? null,
      setSelectedPortfolio: c.lifecycle.setSelectedPortfolio,
      endorsementDraftRiskTransactionId: c.endorsementDraftRiskTransactionId ?? null,
      isIssuedRecordMode: Boolean(c.isIssuedRecordMode),
      isIssuedLifecycle: Boolean(c.isIssuedLifecycle),
      isEndorsementMode: Boolean(c.uw.isEndorsementMode),
      policyVersions: c.policyVersions || [],
      viewingVersionId: c.viewingVersionId ?? null,
      viewingRiskTransactionId: c.viewingRiskTransactionId ?? null,
      viewingRiskTransactionSnapshot: c.viewingRiskTransactionSnapshot ?? null,
      latestIssuedRiskTransactionId: c.latestIssuedRiskTransactionId ?? null,
      issueReadiness: c.issueReadiness,
      issueReadinessLoading: Boolean(c.issueReadinessLoading),
      refreshIssueReadiness: c.refreshIssueReadiness,
      reloadCurrentPolicy: c.reloadCurrentPolicy,
      selectedProgramId: c.selectedProgramId ?? null,
      setSelectedProgramId: c.setSelectedProgramId as (id: string | null) => void,
      programs: c.programs || [],
      programsLoading: Boolean(c.programsLoading),
      selectedBinderId: c.selectedBinderId ?? null,
      setSelectedBinderId: c.setSelectedBinderId as (id: string | null) => void,
      availableBinders: c.availableBinders || [],
      bindersLoading: Boolean(c.bindersLoading),
      editingScope: c.editingScope,
      setEditingScope: c.setEditingScope,
      loading: c.loading,
      setToastMessage: c.setToastMessage,
      setShowToast: c.setShowToast,
      getQuoteOrigin: c.getQuoteOrigin,
      openQuoteWizard: c.openQuoteWizard,
      loadPolicyDetails: c.loadPolicyDetails,
      loadPolicies: c.service.loadPolicies,
      uwAnswers: c.uw.uwAnswers,
      setUwAnswers: c.uw.setUwAnswers,
      bindEndorsement: c.bindEndorsement,
      cancelEndorsement: c.cancelEndorsement as () => Promise<void>,
      handleSendQuestionnaire: c.uw.handleSendQuestionnaire,
      isSending: Boolean(c.uw.isSending),
      questionnaireLastSentAt: (c.uw.questionnaireLastSentAt as Date) ?? null,
      qStatus: c.uw.qStatus || '',
      getQuestionValue: c.uw.getQuestionValue,
      riskModel: c.uw.riskModel,
      followUpsSentMap: c.uw.followUpsSentMap || {},
      openFollowUp: c.uw.openFollowUp as (context: unknown) => void,
      showBatchModal: Boolean(c.uw.showBatchModal),
      setShowBatchModal: c.uw.setShowBatchModal,
      handleSendBatch: c.uw.handleSendBatch,
      showRequestInfoModal: Boolean(c.service.showRequestInfoModal),
      setShowRequestInfoModal: c.service.setShowRequestInfoModal,
      requestInfoStep: c.service.requestInfoStep || '',
      setRequestInfoStep: c.service.setRequestInfoStep as (step: string) => void,
      requestInfoMessage: c.service.requestInfoMessage || '',
      setRequestInfoMessage: c.service.setRequestInfoMessage,
      isRequestingInfo: Boolean(c.service.isRequestingInfo),
      setIsRequestingInfo: c.service.setIsRequestingInfo,
      lifecycle,
      parseDateLoose: ((v: unknown) => c.parseDateLoose(v) ?? null) as (v: unknown) => Date | null,
      toISODateOnly: c.toISODateOnly,
      calcExpiryDateFromStart: c.calcExpiryDateFromStart,
    };

    return (
      <PolicyWorkspace
        value={contextValue}
        activeTab={c.activeTab}
        setActiveTab={c.setActiveTab}
        tabToHash={c.tabToHash}
        location={c.location}
        navigate={c.navigate}
        setShowHistoryModal={c.modals.setShowHistoryModal}
        policyHolderVm={c.policyHolderSpine.vm}
        policyHolderActions={c.policyHolderSpine.actions}
        billing={c.billing}
        docs={c.docs}
        service={{
          openCancelRequestModal: c.service.openCancelRequestModal,
          isRequestingCancellation: Boolean(c.service.isRequestingCancellation),
          isApprovingCancellation: Boolean(c.service.isApprovingCancellation),
          setIsApprovingCancellation: c.service.setIsApprovingCancellation,
        }}
        pendingProgramBinderChange={c.pendingProgramBinderChange}
        setPendingProgramBinderChange={c.setPendingProgramBinderChange}
      />
    );
  };

  return (
    <div className="min-h-[calc(100vh-140px)]">
      <Toast
        message={c.toastMessage}
        isVisible={c.showToast}
        onClose={() => c.setShowToast(false)}
        type={c.toastType}
      />
      {c.isDetailRoute || c.view === 'detail' || Boolean(c.selectedPortfolio?.isNew) ? renderDetail() : renderList()}

      <PolicyModals
        selectedPortfolio={c.selectedPortfolio}
        showQuoteModal={c.modals.showQuoteModal}
        setShowQuoteModal={c.modals.setShowQuoteModal}
        submissionSuccess={c.modals.submissionSuccess}
        setSubmissionSuccess={c.modals.setSubmissionSuccess}
        handleCreateSubmission={c.handleCreateSubmission}
        newQuote={c.modals.newQuote}
        setNewQuote={c.modals.setNewQuote}
        showPricingSteps={c.modals.showPricingSteps}
        setShowPricingSteps={c.modals.setShowPricingSteps}
        showHistoryModal={c.modals.showHistoryModal}
        setShowHistoryModal={c.modals.setShowHistoryModal}
        showTraceModal={c.modals.showTraceModal}
        setShowTraceModal={c.modals.setShowTraceModal}
        showRestoreVersionModal={c.modals.showRestoreVersionModal}
        setShowRestoreVersionModal={c.modals.setShowRestoreVersionModal}
        isRestoringVersion={c.modals.isRestoringVersion}
        setIsRestoringVersion={c.modals.setIsRestoringVersion}
        viewingVersionId={c.viewingVersionId}
        setViewingVersionId={c.setViewingVersionId}
        setToastMessage={c.setToastMessage}
        setShowToast={c.setShowToast}
        reloadCurrentPolicy={c.reloadCurrentPolicy}
        showCreateEndorsementModal={c.modals.showCreateEndorsementModal}
        setShowCreateEndorsementModal={c.modals.setShowCreateEndorsementModal}
        isCreatingEndorsementDraft={c.modals.isCreatingEndorsementDraft}
        setIsCreatingEndorsementDraft={c.modals.setIsCreatingEndorsementDraft}
        endorsementEffectiveDate={c.modals.endorsementEffectiveDate}
        setEndorsementEffectiveDate={c.modals.setEndorsementEffectiveDate}
        endorsementReason={c.modals.endorsementReason}
        setEndorsementReason={c.modals.setEndorsementReason}
        setPolicyVersions={c.setPolicyVersions}
        setViewingRiskTransactionId={c.setViewingRiskTransactionId}
        setViewingRiskTransactionSnapshot={c.setViewingRiskTransactionSnapshot}
        setIsEditing={(v) => c.setEditingScope(v ? 'underwriting' : null)}
        refreshIssueReadiness={c.refreshIssueReadiness}
      />

      <CancelRequestModal
        isOpen={c.modals.showCancelRequestModal}
        onClose={c.modals.closeActiveModal}
        selectedPortfolio={c.selectedPortfolio ? asRecord(c.selectedPortfolio) : null}
        cancelReason={c.modals.cancelReason}
        setCancelReason={c.modals.setCancelReason}
        cancelEffectiveDate={c.modals.cancelEffectiveDate}
        setCancelEffectiveDate={c.modals.setCancelEffectiveDate}
        isRequestingCancellation={c.modals.isRequestingCancellation}
        onSubmit={c.handleCancelRequest}
      />

      <PolicyBillingModals
        selectedPortfolio={c.selectedPortfolio}
        billing={c.billing}
        billingRiskTransactionId={c.billingRiskTransactionId}
        setToastMessage={c.setToastMessage}
        setShowToast={c.setShowToast}
      />

      <BindCoverageWorkflowModal
        isOpen={c.modals.showBindCoverageWorkflowModal}
        onClose={() => c.modals.setShowBindCoverageWorkflowModal(false)}
        isIssuingPolicyFinal={c.lifecycle.isIssuingPolicyFinal}
        isCreatingDraft={c.isCreatingDraft}
        onCreateDraft={c.handleCreateDraftPolicy}
        onIssuePolicyFinal={c.lifecycle.handleIssuePolicyFinal}
      />

      <BindEndorsementWorkflowModal
        isOpen={c.modals.showBindEndorsementWorkflowModal}
        onClose={() => c.modals.setShowBindEndorsementWorkflowModal(false)}
        isIssuingEndorsement={c.lifecycle.isIssuingEndorsement}
        isBindingEndorsementDraft={c.lifecycle.isBindingEndorsementDraft}
        isCancellationDraft={c.cancellationDraftInProgress}
        onBindDraft={async () => {
          await c.bindEndorsementDraftNow();
        }}
        onIssueEndorsement={c.handleIssueEndorsementFromWorkflow}
      />

      <DeletePolicyModal
        isOpen={c.modals.showDeleteModal}
        onClose={c.modals.closeActiveModal}
        onConfirm={c.handleConfirmDelete}
      />

      <BindConfirmationModal
        isOpen={c.modals.showBindModal}
        onClose={c.modals.closeActiveModal}
        onConfirm={c.lifecycle.handleBindPolicy}
      />

      <FollowUpDrawer
        isOpen={c.followUp.showFollowUpDrawer}
        onClose={() => c.followUp.setShowFollowUpDrawer(false)}
        activeContextLabel={c.followUp.activeFollowUpContext?.questionLabel || ''}
        followUpNote={c.followUp.followUpNote}
        setFollowUpNote={c.followUp.setFollowUpNote}
        followUpType={c.followUp.followUpType}
        setFollowUpType={c.followUp.setFollowUpType}
        onAddToBatch={c.followUp.addActiveFollowUpToBatch}
      />

    </div>
  );
}
