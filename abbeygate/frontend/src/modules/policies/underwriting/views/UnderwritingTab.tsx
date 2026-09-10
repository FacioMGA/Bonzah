import React from 'react';
import { Button, DecisionCard } from '@/src/shared/ui';
import { SearchableSelect } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';
import { Textarea } from '@/src/shared/ui';
import { Modal } from '@/src/shared/ui';
import { formatDateUI } from '@/src/shared/lib/format';
import { resolveProgramQuestionnaire } from '../../config/questionnaires';
import { selectQuestionnaireFieldMetaByKey } from '@/src/shared/lib/products/questionnaireFromProfile';
import type { LifecycleStageId } from '@facio/validation';
import { policiesClient as api } from '../../api/policiesClient';
import { formatBinderLabel } from '../../binders/binderFormatting';
import type { UnderwritingDisplayState } from '../model/underwritingStatus';
import { FollowUpBatch } from '../actions/FollowUpBatch';
import { QuestionnaireSection } from '../renderers/QuestionnaireSection';
import { UnderwritingReadinessCard } from '../renderers/UnderwritingReadinessCard';
import { useUnderwritingQuestionnaireController } from '../hooks/useUnderwritingQuestionnaireController';
import { normalizeAdditionalDrivers } from '../model/questionnaireHelpers';
import { asRecord } from '@/src/shared/lib/record';
import { filterOperatorVisibleBlockers } from '../../model/issueReadinessDisplay';
import {
  hasReplacementQuestionData,
} from '../model/questionnaireProjection';
import { computeLiveQuestionnaireMetrics } from '../model/liveQuestionnaireMetrics';
import {
  deriveQuestionnaireAccess,
  deriveUnderwritingEditMode,
  deriveUnderwritingStage,
  isIssuedLifecycleStatus,
  normalizeUnderwritingDisplayState,
  shouldAutoRefreshUnderwritingQuestionnaire,
  shouldEnableFollowUps,
} from '../model/underwritingState';
import {
  buildUnderwritingPricingDetails,
  formatUnderwritingDecisionHeadline,
  formatUnderwritingPricingHeadline,
  normalizeUnderwritingAnalysis,
} from '../model/underwritingAnalysisView';
import { ChangeProductModal } from './ChangeProductModal';
import { useFailureZone } from './useFailureZone';
import { FailureZoneBanner } from './FailureZoneBanner';
import { SubmissionMemoryPanel } from './SubmissionMemoryPanel';
import type { UnderwritingProps } from './UnderwritingTab.types';

export function Underwriting(props: UnderwritingProps) {
  const {
    isEditing,
    setIsEditing,
    issueReadiness,
    selectedPortfolio,
    selectedBinderId,
    setSelectedBinderId,
    setSelectedPortfolio,
    availableBinders,
    bindersLoading,
    selectedProgramId,
    setSelectedProgramId,
    programs,
    programsLoading,
    handleSendQuestionnaire,
    isSending,
    questionnaireLastSentAt,
    qStatus,
    getQuestionValue,
    uwAnswers,
    riskModel,
    followUpsSentMap,
    isEndorsementMode,
    openFollowUp,
    showBatchModal,
    setShowBatchModal,
    handleSendBatch,
    setUwAnswers,
    getQuoteOrigin,
    showRequestInfoModal,
    setShowRequestInfoModal,
    requestInfoStep,
    setRequestInfoStep,
    requestInfoMessage,
    setRequestInfoMessage,
    isRequestingInfo,
    setIsRequestingInfo,
    loadPolicyDetails,
    loadPolicies,
    handleReRate,
    isReRating,
    setToastMessage,
    setShowToast,
    endorsementDraftRiskTransactionId,
    refreshIssueReadiness,
    pendingProductChange: pendingProductChangeProp,
    onPendingProductChangeClear,
  } = props;

  // Use the prop-driven pending change (from usePolicyProgramsBinders via controller).
  // Falls back to null when nothing is pending.
  const pendingProductChange = pendingProductChangeProp ?? null;

  const selectedProgram = React.useMemo(
    () => programs.find((p) => String(p.id || '') === String(selectedProgramId || '')) || null,
    [programs, selectedProgramId]
  );
  const resolvedProductType = String(
    asRecord(selectedPortfolio).productType
    || asRecord(selectedProgram).productType
    || asRecord(asRecord(selectedProgram).metadata).productType
    || ''
  ).trim().toUpperCase();
  const portfolio = asRecord(selectedPortfolio);
  const statusUpper = String(portfolio.status || '').toUpperCase();
  const underwritingStage = React.useMemo<LifecycleStageId>(() => deriveUnderwritingStage(statusUpper), [statusUpper]);
  const questionContractByKey = React.useMemo(
    () => selectQuestionnaireFieldMetaByKey(resolvedProductType),
    [resolvedProductType],
  );
  const questionnaireStructure = React.useMemo(
    () => resolveProgramQuestionnaire(selectedProgram, { actor: 'underwriter', stage: underwritingStage }),
    [selectedProgram, underwritingStage]
  );
  const isIssuedStage = isIssuedLifecycleStatus(statusUpper);
  const isPolicyLocked = Boolean(portfolio.isLocked || asRecord(portfolio.policy).isLocked);
  const editMode = deriveUnderwritingEditMode({ isEndorsementMode, endorsementDraftRiskTransactionId, isIssuedStage });
  const {
    inlineEditEnabled,
    followUpEnabled,
    lockQuestionnaireOps,
  } = deriveQuestionnaireAccess({
    editMode,
    isEditing,
    isPolicyNew: Boolean(selectedPortfolio?.isNew),
    isPolicyLocked,
    isEndorsementMode,
  });
  const quoteData = asRecord(portfolio.quoteData);
  const readinessRecord = asRecord(issueReadiness);
  const uwStateRaw = String(readinessRecord.uwState || '').trim().toUpperCase();
  const uwMeta = asRecord(readinessRecord.uwStateMeta);
  const effectiveLastSavedBy = String(uwMeta.lastSavedBy || '').trim().toLowerCase();
  const normalizedUwState: UnderwritingDisplayState = normalizeUnderwritingDisplayState({
    uwStateRaw,
    effectiveLastSavedBy,
  });
  const underwritingAnalysis = normalizeUnderwritingAnalysis(asRecord(selectedPortfolio)?.underwritingAnalysis);
  const hasQuoteResponse = Boolean(asRecord(selectedPortfolio?.quoteResponse).primaryOption);
  const underwritingLane = underwritingAnalysis?.lane || '';
  const effectiveFollowUpEnabled = shouldEnableFollowUps({
    canEditQuestionnaire: followUpEnabled,
    underwritingState: normalizedUwState,
    lane: underwritingLane,
  });
  const {
    isSavingChanges,
    saveError,
    saveErrorEntries,
    dirtyFields,
    fieldErrors,
    makeOptions,
    modelOptions,
    activeMake,
    variantSelectOptions,
    variantOptionsLoading,
    activeVariantId,
    selectVariant,
    fieldDisabled,
    updateQuestionField,
    saveUnderwritingChanges,
    validateFieldOnBlur,
    formatCurrencyDisplay,
    formatCurrencyInputValue,
    resetEditingDraft,
    removeFollowUpRequest,
  } = useUnderwritingQuestionnaireController({
    selectedPortfolio,
    productType: resolvedProductType,
    quoteData,
    underwritingStage,
    selectedProgramId,
    editMode,
    endorsementDraftRiskTransactionId,
    inlineEditEnabled,
    setSelectedPortfolio,
    loadPolicyDetails,
    loadPolicies,
    setToastMessage,
    setShowToast,
    setIsEditing,
    refreshIssueReadiness,
  });
  const hasUnsavedQuestionnaireChanges = Object.keys(dirtyFields || {}).length > 0;
  const readinessBlockers = Array.isArray(readinessRecord.blockers) ? filterOperatorVisibleBlockers(readinessRecord.blockers) : [];
  const missingForQuotePack = asRecord(asRecord(issueReadiness).derived).missingForQuotePack;
  const hasQuoteReadinessGaps = Array.isArray(missingForQuotePack) && missingForQuotePack.length > 0;
  const policyId = String(selectedPortfolio?.id || '').trim();
  const loadPolicyDetailsRef = React.useRef(loadPolicyDetails);
  const refreshIssueReadinessRef = React.useRef(refreshIssueReadiness);
  React.useEffect(() => {
    loadPolicyDetailsRef.current = loadPolicyDetails;
    refreshIssueReadinessRef.current = refreshIssueReadiness;
  }, [loadPolicyDetails, refreshIssueReadiness]);
  const shouldAutoRefresh = shouldAutoRefreshUnderwritingQuestionnaire({
    policyId,
    qStatus,
    underwritingState: normalizedUwState,
    isEditing,
    hasUnsavedChanges: hasUnsavedQuestionnaireChanges,
  });
  React.useEffect(() => {
    if (!shouldAutoRefresh) return;
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await Promise.all([
          loadPolicyDetailsRef.current(),
          refreshIssueReadinessRef.current(),
        ]);
      } finally {
        inFlight = false;
      }
    };
    const firstRefresh = window.setTimeout(() => { void refresh(); }, 2500);
    const interval = window.setInterval(() => { void refresh(); }, 7000);
    return () => {
      cancelled = true;
      window.clearTimeout(firstRefresh);
      window.clearInterval(interval);
    };
  }, [policyId, shouldAutoRefresh]);
  const canRenderUnderwritingAnalysis =
    normalizedUwState === 'QUOTE_READY'
    && Boolean(underwritingAnalysis)
    && hasQuoteResponse
    && !hasUnsavedQuestionnaireChanges
    && readinessBlockers.length === 0
    && !hasQuoteReadinessGaps;
  const hasReplacementData = React.useCallback((replacementKey: string): boolean => {
    return hasReplacementQuestionData({
      replacementKey,
      quoteData,
      dirtyFields,
      normalizeAdditionalDrivers,
    });
  }, [dirtyFields, quoteData]);
  const { failureZone, failureSignals, similarFailureEvidence, showFailureZone } =
    useFailureZone(selectedPortfolio?.id);
  const liveQuestionnaireMetrics = React.useMemo(() => {
    return computeLiveQuestionnaireMetrics({
      questionnaireStructure,
      questionContractByKey,
      quoteData,
      dirtyFields,
      productType: resolvedProductType,
      underwritingStage,
      underwritingTriggers: underwritingAnalysis?.triggers || [],
      getQuestionValue,
      hasReplacementData,
    });
  }, [
    dirtyFields,
    getQuestionValue,
    hasReplacementData,
    questionContractByKey,
    questionnaireStructure,
    quoteData,
    resolvedProductType,
    underwritingAnalysis?.triggers,
    underwritingStage,
  ]);
  return (
    <>
      <div className="space-y-8 max-w-full relative pb-24">
        <div className="h-1" />
        {/* Questionnaire Control Bar */}
        <div className="flex flex-col md:flex-row items-start justify-between gap-8">
          <div className="flex-1 w-full">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">
                  Select binder
                </label>
                <div className="relative">
                  <SearchableSelect
                    value={selectedBinderId}
                    onChange={(newBinderId) => {
                      if (newBinderId === selectedBinderId) return;
                      setSelectedBinderId(newBinderId);
                    }}
                    options={availableBinders.map((b) => ({
                      value: String(b.id || ''),
                      label: formatBinderLabel(b),
                    }))}
                    placeholder="Select binder..."
                    searchPlaceholder="Search binders..."
                    loading={bindersLoading}
                    disabled={
                      availableBinders.length === 0 ||
                      !inlineEditEnabled ||
                      lockQuestionnaireOps ||
                      Boolean(asRecord(selectedPortfolio)?.isLocked || asRecord(asRecord(selectedPortfolio)?.policy)?.isLocked)
                    }
                  />
                </div>
              </div>

              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">
                  Select program
                </label>
                <div className="relative">
                  <SearchableSelect
                    value={selectedProgramId}
                    onChange={(newProgramId) => {
                      if (newProgramId === selectedProgramId) return;
                      setSelectedProgramId(newProgramId);
                    }}
                    options={programs.map((p) => ({
                      value: String(p.id || ''),
                      label: `${String(p.name || '')} (${String(p.status || '').toUpperCase()})`,
                    }))}
                    placeholder={programsLoading ? 'Loading programs…' : programs.length === 0 ? 'No programs' : 'Select program...'}
                    searchPlaceholder="Search programs..."
                    loading={programsLoading}
                    disabled={
                      programsLoading ||
                      programs.length === 0 ||
                      !inlineEditEnabled ||
                      lockQuestionnaireOps ||
                      Boolean(asRecord(selectedPortfolio)?.isLocked || asRecord(asRecord(selectedPortfolio)?.policy)?.isLocked)
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          {!lockQuestionnaireOps && (
            <div className="flex flex-col items-end gap-2 shrink-0">
              <Button
                onClick={handleSendQuestionnaire}
                disabled={isSending}
                variant="primary"
                size="md"
                className="h-[52px] px-8 rounded-2xl text-xs font-black uppercase tracking-widest gap-2"
              >
                <svg className={`w-4 h-4 ${isSending ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {isSending ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  )}
                </svg>
                {(() => {
                  if (isSending) return 'Sending...';
                  if (qStatus === 'Superseded') return 'Send New Questionnaire';
                  const origin = getQuoteOrigin(selectedPortfolio);
                  if (origin === 'customer') return 'Resend Questionnaire';
                  // For BO-created quotes, only "Resend" after we sent at least once (tracked by last-sent timestamp).
                  return questionnaireLastSentAt ? 'Resend Questionnaire' : 'Send Questionnaire';
                })()}
              </Button>

              {questionnaireLastSentAt && (qStatus === 'Sent' || qStatus === 'In Process') && (
                <div className="text-[10px] font-bold text-slate-400">
                  Last sent: {formatDateUI(questionnaireLastSentAt, { withTime: true })}
                </div>
              )}

              {qStatus === 'Superseded' && (
                <div className="flex flex-col items-end gap-1">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tight border border-amber-300 bg-amber-50 text-amber-700">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    Questionnaire superseded
                  </span>
                  {Boolean(asRecord(asRecord(selectedPortfolio).customerFlow).supersededProductType) && (
                    <div className="text-[10px] font-semibold text-slate-400">
                      Sent under: {String(asRecord(asRecord(selectedPortfolio).customerFlow).supersededProductType)} — resend required
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {saveError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4">
            <div className="flex gap-3">
              <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800 mb-1">Please fix the following before saving</p>
                {saveErrorEntries.length > 0 ? (
                  <ul className="space-y-1">
                    {saveErrorEntries.map((entry) => (
                      <li key={`${entry.field}:${entry.message}`}>
                        <button
                          type="button"
                          className="text-sm font-medium text-red-700 hover:text-red-900 hover:underline text-left"
                          onClick={() => {
                            const field = String(entry.field);
                            const el =
                              document.getElementById(`uw-field-${field}`) ??
                              document.getElementById(`uw-field-${field.split('.')[0]}`);
                            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }}
                        >
                          • {entry.label ? <span className="font-semibold">{entry.label}:</span> : null}{entry.label ? ' ' : ''}{entry.message}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-red-700">{saveError}</p>
                )}
              </div>
            </div>
          </div>
        ) : null}
        {showFailureZone ? (
          <FailureZoneBanner
            failureZone={failureZone}
            failureSignals={failureSignals}
            similarFailureEvidence={similarFailureEvidence}
          />
        ) : null}
        <div className="space-y-8">
              <div className="mb-10">
                {(() => {
                  if (!canRenderUnderwritingAnalysis) {
                    return (
                      <UnderwritingReadinessCard
                        issueReadiness={issueReadiness}
                        completed={liveQuestionnaireMetrics.completed}
                        total={liveQuestionnaireMetrics.total}
                        riskFlagCount={liveQuestionnaireMetrics.riskFlags}
                      />
                    );
                  }
                  if (!underwritingAnalysis) return null;
                  const lane = underwritingAnalysis.lane;
                  const tone = lane === 'red' ? 'danger' : lane === 'yellow' ? 'warning' : 'success';
                  const isCleanAccepted = underwritingAnalysis.outcome === 'accept' && underwritingAnalysis.triggers.length === 0 && underwritingAnalysis.pricingAdjustment.type === 'none';
                  if (isCleanAccepted) {
                    return (
                      <DecisionCard
                        tone="success"
                        eyebrow="Underwriting analysis"
                        title="Accepted"
                        summary="No underwriting concerns detected."
                      />
                    );
                  }
                  const pricingDetails = buildUnderwritingPricingDetails(underwritingAnalysis);
                  return (
                    <DecisionCard
                      tone={tone}
                      eyebrow="Underwriting analysis"
                      title={formatUnderwritingDecisionHeadline(underwritingAnalysis)}
                      details={(
                        <>
                          <div>
                            <div className="space-y-2">
                              {underwritingAnalysis.triggers.length > 0 ? underwritingAnalysis.triggers.map((trigger) => (
                                <div key={`${trigger.code}:${trigger.message}`}>
                                  <div className="text-sm font-medium text-slate-700">{trigger.message}</div>
                                  <div className="mt-1 text-xs font-medium text-slate-500">{trigger.explanation}</div>
                                </div>
                              )) : (
                                <div className="text-sm font-medium text-slate-600">No underwriting triggers fired.</div>
                              )}
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <div className="text-sm font-medium text-slate-700">{formatUnderwritingPricingHeadline(underwritingAnalysis)}</div>
                            <div className="space-y-1.5">
                              {pricingDetails.map((detail) => (
                                <div key={detail} className="text-xs font-medium text-slate-500">
                                  - <span className="font-semibold text-slate-600">{detail}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    />
                  );
                })()}
                {!lockQuestionnaireOps && (
                  <div className="mt-4 flex items-center justify-end gap-3 min-h-controlXs">
                    {!isEditing && !selectedPortfolio?.isNew ? (
                      <Button
                        variant="secondary"
                        size="md"
                        onClick={() => setIsEditing(true)}
                        className="gap-2 h-controlXs px-5 rounded-2xl text-[11px] font-black uppercase tracking-widest"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        Edit
                      </Button>
                    ) : (
                      <>
                        {!selectedPortfolio?.isNew && (
                          <Button
                            variant="secondary"
                            size="md"
                            onClick={() => {
                              setIsEditing(false);
                              resetEditingDraft();
                              void loadPolicyDetails();
                            }}
                            className="h-controlXs px-5 rounded-2xl text-[11px] font-black uppercase tracking-widest"
                          >
                            Cancel
                          </Button>
                        )}
                        <Button
                          variant="primary"
                          size="md"
                          onClick={() => void (async () => {
                            const result = await saveUnderwritingChanges({ exitEditMode: true });
                            if (result?.success) await handleReRate();
                          })()}
                          disabled={isSavingChanges || isReRating}
                          className="gap-2 h-controlXs px-5 rounded-2xl text-[11px] font-black uppercase tracking-widest"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          {isSavingChanges ? 'Saving...' : isReRating ? 'Recalculating...' : 'Save changes'}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
              {policyId ? (
                <div className="mb-8">
                  <SubmissionMemoryPanel submissionId={policyId} />
                </div>
              ) : null}
              {!selectedProgramId ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-sm font-semibold text-amber-800">
                  No Program is attached to this quote yet. Select a program above to load the dynamic underwriting questionnaire.
                </div>
              ) : questionnaireStructure.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-sm font-semibold text-slate-700">
                  The selected program has no questionnaire structure configured yet.
                </div>
              ) : null}

              {selectedProgramId && questionnaireStructure.map((part, index) => (
                <QuestionnaireSection
                  key={index}
                  part={part}
                  index={index}
                  riskPoints={riskModel.points}
                  questionContractByKey={questionContractByKey}
                  underwritingStage={underwritingStage}
                  quoteData={quoteData}
                  dirtyFields={dirtyFields}
                  hasReplacementData={hasReplacementData}
                  makeOptions={makeOptions}
                  modelOptions={modelOptions}
                  variantSelectOptions={variantSelectOptions}
                  variantOptionsLoading={variantOptionsLoading}
                  activeVariantId={activeVariantId}
                  activeMake={activeMake}
                  activeModel={String(dirtyFields.model ?? quoteData.model ?? '').trim()}
                  activeYear={Number(dirtyFields.year ?? quoteData.year ?? 0)}
                  selectVariant={selectVariant}
                  uwAnswers={asRecord(uwAnswers)}
                  followUpsSentMap={followUpsSentMap}
                  followUpEnabled={effectiveFollowUpEnabled}
                  inlineEditEnabled={inlineEditEnabled}
                  lockQuestionnaireOps={lockQuestionnaireOps}
                  editMode={editMode}
                  fieldErrors={fieldErrors}
                  fieldDisabled={fieldDisabled}
                  isSavingChanges={isSavingChanges}
                  updateQuestionField={updateQuestionField}
                  validateFieldOnBlur={validateFieldOnBlur}
                  formatCurrencyDisplay={formatCurrencyDisplay}
                  formatCurrencyInputValue={formatCurrencyInputValue}
                  openFollowUp={openFollowUp}
                  selectedPortfolio={selectedPortfolio}
                  getQuestionValue={getQuestionValue}
                />
              ))}
        </div>

        <FollowUpBatch
          followUpEnabled={effectiveFollowUpEnabled}
          lockQuestionnaireOps={lockQuestionnaireOps}
          requests={uwAnswers.followUpRequests || []}
          showBatchModal={showBatchModal}
          onOpenBatchModal={() => setShowBatchModal(true)}
          onCloseBatchModal={() => setShowBatchModal(false)}
          onSendBatch={handleSendBatch}
          onRemoveRequest={(index: number) => removeFollowUpRequest(index, asRecord(uwAnswers), setUwAnswers)}
        />
      </div>

      <Modal
        isOpen={showRequestInfoModal}
        onClose={() => setShowRequestInfoModal(false)}
        title="Request more information"
        actions={(
          <>
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setShowRequestInfoModal(false)}
              className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition bg-transparent"
              disabled={isRequestingInfo}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={async () => {
                if (!selectedPortfolio?.id) return;
                try {
                  setIsRequestingInfo(true);
                  const step = requestInfoStep || undefined;
                  const resp = await api.requestInfo(String(selectedPortfolio.id), {
                    message: requestInfoMessage || undefined,
                    requestedStep: step ? String(step) : undefined,
                  });
                  if (!resp?.success) throw new Error(resp?.error?.message || 'Failed to request info');
                  setToastMessage('Info required sent to customer (best-effort).');
                  setShowToast(true);
                  setShowRequestInfoModal(false);
                  setRequestInfoMessage('');
                  setRequestInfoStep('');
                  await loadPolicyDetails();
                  await loadPolicies();
                } catch (e) {
                  alert(e instanceof Error ? e.message : 'Failed to request info');
                } finally {
                  setIsRequestingInfo(false);
                }
              }}
              className="bg-brand-primary text-white px-6 py-3 rounded-xl font-black shadow-lg hover:bg-brand-secondary transition disabled:opacity-60"
              disabled={isRequestingInfo}
            >
              {isRequestingInfo ? 'Sending…' : 'Send request'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="text-sm text-slate-600">
            This moves the lifecycle to <span className="font-black">INFO REQUIRED</span> and sends the customer a secure link to resume.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Requested step</label>
              <Select
                value={requestInfoStep}
                onChange={(e) => setRequestInfoStep(e.target.value || '')}
                className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-bold text-slate-800 focus:border-brand-primary outline-none transition-all appearance-none"
              >
                <option value="">Any</option>
                {questionnaireStructure.map((section, idx) => {
                  const label = section.title.replace(/^Part\s+\d+:\s+/, '');
                  const slug = label.toLowerCase().replace(/\s+/g, '-');
                  return (
                    <option key={idx} value={slug}>{label}</option>
                  );
                })}
              </Select>
            </div>
            <div>
              <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Customer link</label>
              <div className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-extrabold text-slate-800">
                /quote/{String(selectedPortfolio?.id || '').slice(0, 8)}…
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Message (customer-facing)</label>
            <Textarea
              value={requestInfoMessage}
              onChange={(e) => setRequestInfoMessage(e.target.value)}
              placeholder="Please provide additional details about the information you're requesting."
              className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-bold text-slate-800 focus:border-brand-primary outline-none transition-all min-h-panel"
            />
          </div>
        </div>
      </Modal>

      <ChangeProductModal
        isOpen={pendingProductChange !== null}
        fromProductLabel={pendingProductChange?.fromProductLabel ?? ''}
        toProductLabel={pendingProductChange?.toProductLabel ?? ''}
        onConfirm={() => {
          pendingProductChange?.onConfirm();
          onPendingProductChangeClear?.();
        }}
        onCancel={() => {
          pendingProductChange?.onCancel();
          onPendingProductChangeClear?.();
        }}
      />
    </>
  );
}
