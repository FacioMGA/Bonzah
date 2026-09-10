import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditingScope } from '../detail/PolicyWorkspaceContext';
import type { PendingProductChangeConfirmation } from '../hooks/usePolicyProgramsBinders';
import { policiesClient as api } from '../api/policiesClient';
import { usePolicyData } from '../hooks/usePolicyData';
import { usePolicyHolderSpine } from '../policyholder/hooks/usePolicyHolderSpine';
import { usePolicyToast } from '../hooks/usePolicyToast';
import { usePolicyFormErrors } from '../hooks/usePolicyFormErrors';
import { usePolicyQuoteSession } from '@/src/products/motor/public';
import { usePolicyVersionHistory } from '../hooks/usePolicyVersionHistory';
import { usePolicyBilling } from '../billing/hooks/usePolicyBilling';
import { usePolicyLifecycleActions } from '../hooks/usePolicyLifecycleActions';
import { usePolicyProgramsBinders } from '../hooks/usePolicyProgramsBinders';
import { usePolicyReadiness } from '../hooks/usePolicyReadiness';
import { usePolicyDocumentsTab } from '../documents/hooks/usePolicyDocumentsTab';
import { usePolicyQuestionnaireFlow } from './usePolicyQuestionnaireFlow';
import { usePolicyUnderwritingTab } from '../underwriting/hooks/usePolicyUnderwritingTab';
import { usePolicyViewState } from '../hooks/usePolicyViewState';
import { usePolicyRouteSync } from '../hooks/usePolicyRouteSync';
import { usePolicyController } from '../hooks/usePolicyController';
import { usePolicyEndorsementDiff } from '../mbe/hooks/usePolicyEndorsementDiff';
import { usePolicyPremiumActions } from '../premium/hooks/usePolicyPremiumActions';
import { usePolicyNotesAndTimeline } from '../feed/hooks/usePolicyNotesAndTimeline';
import { usePolicyCrudActions } from '../hooks/usePolicyCrudActions';
import { usePolicyEndorsementState } from '../mbe/hooks/usePolicyEndorsementState';
import { countries as ALL_COUNTRIES } from '@facio/products';
import { addFlagsToCountryOptions } from '@/src/shared/lib/utils/countryOptions';
import type { PolicyUwAnswers } from '../model/policy';
import { initialUwAnswers, toISODateOnly, parseDateLoose, calcExpiryDateFromStart } from '../model/policyPageHelpers';
import { deriveQuestionnaireStatusFromReadiness, normalizeUnderwritingDisplayState } from '../underwriting/model/underwritingState';
import { asRecord } from '@/src/shared/lib/record';
import { getPolicyVM, toPolicyRecord, buildPolicyPageViewModel } from '../queries/getPolicyVM';
import { ProductRegistry, computeRiskModel } from '@/src/shared/lib/products';

export function usePolicyPageController() {
  const { showToast, toastMessage, toastType, toast, setShowToast, setToastMessage, setToastType } = usePolicyToast();
  const {
    formErrors,
    validateField,
    validatePolicyHolderAll,
    clearFieldError,
    setFieldError,
    mapServerValidationToFieldErrors,
  } = usePolicyFormErrors();
  const {
    routeId,
    view,
    setView,
    location,
    navigate,
    selectedPortfolio,
    setSelectedPortfolio,
    activeTab,
    setActiveTab,
    tabToHash,
    reloadCurrentPolicy: reloadCurrentPolicyWrapper,
  } = usePolicyData();

  const [editingScope, setEditingScope] = useState<EditingScope>(null);
  const [pendingProgramBinderChange, setPendingProgramBinderChange] = useState<PendingProductChangeConfirmation | null>(null);
  const [loading, setLoading] = useState(false);
  const [uwAnswers, setUwAnswers] = useState<PolicyUwAnswers>(initialUwAnswers);
  const [isSending, setIsSending] = useState(false);
  /** Set to true by BO submission creation; cleared after the first PH save so that
   *  only the initial creation flow auto-advances editingScope to 'underwriting'. */
  const isInitialCreationFlowRef = useRef(false);

  // Stable wrapper for hooks that accept boolean isEditing/setIsEditing for PH interactions.
  const setPolicyHolderEditing = useCallback(
    (v: boolean) => setEditingScope(v ? 'policyHolder' : null),
    [],
  );

  const {
    createAndOpenAutoPolicySession,
    getQuoteOrigin,
    openQuoteWizard,
    resolvePublicAutoSessionId,
    forceEditOnNextLoadRef,
    DEFAULT_AUTO_QUOTE_DATA,
  } = usePolicyQuoteSession({
    routeId,
    locationPathname: location.pathname,
    navigate: navigate as (to: string | { pathname: string; search?: string; hash?: string }, opts?: { replace?: boolean }) => void,
    setSelectedPortfolio: setSelectedPortfolio as (v: unknown) => void,
    setView: setView as (v: string) => void,
    setActiveTab,
    setIsEditing: setPolicyHolderEditing,
    toast,
  });

  useEffect(() => {
    if (routeId === 'new') return;
    const account = asRecord(location.state).newPolicyHolder;
    if (!account) return;
    void createAndOpenAutoPolicySession({ account });
  }, [createAndOpenAutoPolicySession, location.state, routeId]);

  usePolicyRouteSync({
    routeId,
    location,
    navigate,
    selectedPortfolio,
    setView,
    setSelectedPortfolio,
    setActiveTab,
    onNewRoute: () => {
      if (routeId !== 'new') return;
      // Neutral new-policy flow is handled by the quote-modal effect below.
    },
  });

  const COUNTRY_OPTIONS = useMemo(
    () => addFlagsToCountryOptions([{ value: '', label: 'Select...' }, ...ALL_COUNTRIES.map((c) => ({ value: c, label: c }))]),
    []
  );

  const {
    viewingVersionId,
    setViewingVersionId,
    policyVersions,
    setPolicyVersions,
    viewingRiskTransactionId,
    setViewingRiskTransactionId,
    viewingRiskTransactionSnapshot,
    setViewingRiskTransactionSnapshot,
    displayedPortfolio,
    latestIssuedRiskTransactionId,
    billingRiskTransactionId,
    endorsementDraftRiskTransactionId,
    isIssuedLifecycle,
    isIssuedRecordMode,
    refreshPolicyVersions,
  } = usePolicyVersionHistory({ selectedPortfolio });

  const billing = usePolicyBilling({
    selectedPortfolio,
    activeTab,
    onToast: (message) => {
      setToastMessage(message);
      setShowToast(true);
    },
  });

  useEffect(() => {
    if (isIssuedRecordMode) setEditingScope(null);
  }, [isIssuedRecordMode]);

  const reloadCurrentPolicy = useCallback(async (opts?: { riskTransactionId?: string | null }) => {
    await reloadCurrentPolicyWrapper(opts, { viewingRiskTransactionId, setViewingRiskTransactionSnapshot });
  }, [reloadCurrentPolicyWrapper, setViewingRiskTransactionSnapshot, viewingRiskTransactionId]);

  const { docs, refreshPolicyDocuments } = usePolicyDocumentsTab({
    activeTab,
    selectedPolicyId: selectedPortfolio?.id || null,
  });

  const {
    qStatus,
    setQStatus,
    questionnaireLastSentAt,
    setQuestionnaireLastSentAt,
    readQuestionnaireLastSentAt,
    getQuestionValue,
  } = usePolicyUnderwritingTab({ selectedPortfolio });

  const {
    showCreateEndorsementModal,
    setShowCreateEndorsementModal,
    endorsementEffectiveDate,
    setEndorsementEffectiveDate,
    endorsementReason,
    setEndorsementReason,
    isCreatingEndorsementDraft,
    setIsCreatingEndorsementDraft,
    showQuoteModal,
    setShowQuoteModal,
    showHistoryModal,
    setShowHistoryModal,
    showTraceModal,
    setShowTraceModal,
    showRestoreVersionModal,
    setShowRestoreVersionModal,
    isRestoringVersion,
    setIsRestoringVersion,
    newQuote,
    setNewQuote,
    submissionSuccess,
    setSubmissionSuccess,
    closeActiveModal,
    openDeletePolicyModal,
    openCancelRequestModal,
    showDeleteModal,
    showBindModal,
    policyToDelete,
    showPricingSteps,
    setShowPricingSteps,
    showRequestInfoModal,
    setShowRequestInfoModal,
    requestInfoMessage,
    setRequestInfoMessage,
    requestInfoStep,
    setRequestInfoStep,
    isRequestingInfo,
    setIsRequestingInfo,
    showCancelRequestModal,
    cancelReason,
    setCancelReason,
    cancelEffectiveDate,
    setCancelEffectiveDate,
    isRequestingCancellation,
    setIsRequestingCancellation,
    isApprovingCancellation,
    setIsApprovingCancellation,
  } = usePolicyViewState();

  const selectedPortfolioProductType = String(asRecord(selectedPortfolio)?.productType || '');
  const selectedPortfolioQuoteData = asRecord(selectedPortfolio)?.quoteData;
  const selectedPortfolioQuoteResponse = asRecord(selectedPortfolio)?.quoteResponse;
  const selectedPortfolioVehicleInfo = asRecord(selectedPortfolio)?.vehicleInfo;
  const selectedPortfolioDriverInfo = asRecord(selectedPortfolio)?.driverInfo;
  const selectedPortfolioAutoRiskData = useMemo(
    () => ({
      ...asRecord(selectedPortfolioDriverInfo),
      ...asRecord(selectedPortfolioVehicleInfo),
      ...asRecord(selectedPortfolioQuoteData),
    }),
    [selectedPortfolioDriverInfo, selectedPortfolioQuoteData, selectedPortfolioVehicleInfo]
  );
  const riskModel = useMemo(() => {
    const manifest = ProductRegistry.get(selectedPortfolioProductType);
    return computeRiskModel(manifest, selectedPortfolioAutoRiskData);
  }, [selectedPortfolioProductType, selectedPortfolioAutoRiskData]);

  const {
    mbeTemplates,
    coverageDirty,
    setCoverageDirty,
    excessImpact,
    excessImpactLoading,
  } = usePolicyPremiumActions({
    activeTab,
    selectedPolicyId: selectedPortfolio?.id ? String(selectedPortfolio.id) : null,
    selectedProductType: selectedPortfolioProductType,
    quoteData: selectedPortfolioQuoteData,
    quoteResponse: selectedPortfolioQuoteResponse,
  });

  const {
    showFollowUpDrawer,
    setShowFollowUpDrawer,
    activeFollowUpContext,
    followUpNote,
    setFollowUpNote,
    followUpType,
    setFollowUpType,
    showBatchModal,
    setShowBatchModal,
    followUpsSentMap,
    openFollowUp,
    addActiveFollowUpToBatch,
    handleSendBatch,
    hydrateFollowUpsSentMap,
    quoteSentAt,
    quoteSentKey,
    setQuoteSentAt,
    setQuoteSentKey,
    clearQuoteSentIndicator,
  } = usePolicyNotesAndTimeline({
    selectedPortfolio,
    uwAnswers,
    setUwAnswers,
    setQStatus,
    setIsSending,
    setToastMessage,
    setShowToast,
  });

  const { aggregateLimit, setAggregateLimit, isEndorsementMode, cancelEndorsement, bindEndorsement } = usePolicyEndorsementState({
    selectedPortfolio,
    uwAnswers,
    setUwAnswers,
    setSelectedPortfolio: setSelectedPortfolio as (value: unknown) => void,
    refreshPolicyDocuments,
    toast,
  });

  const {
    loadPolicies,
    handleDeletePolicy,
    handleConfirmDelete,
    handleCreateSubmission,
    handleSavePolicy,
    handleSavePolicyHolder,
    handleCancelPolicyHolder,
    handleCancelRequest,
    loadPolicyDetails,
    loadPolicyDetailsByIdStable,
  } = usePolicyCrudActions({
    location,
    view,
    activeTab,
    selectedPortfolio,
    routeSetters: {
      setView: setView as (value: string) => void,
      setSelectedPortfolio: setSelectedPortfolio as (value: unknown) => void,
      setActiveTab,
      navigate,
    },
    quoteSession: {
      forceEditOnNextLoadRef,
      DEFAULT_AUTO_QUOTE_DATA,
      resolvePublicAutoSessionId,
      getQuoteOrigin,
    },
    viewState: {
      newQuote,
      setShowQuoteModal,
      setSubmissionSuccess,
      policyToDelete,
      closeActiveModal,
      cancelReason,
      setCancelReason,
      cancelEffectiveDate,
      setCancelEffectiveDate,
      setIsRequestingCancellation,
      openDeletePolicyModal,
    },
    uw: {
      uwAnswers,
      setUwAnswers,
      setQStatus,
      readQuestionnaireLastSentAt,
      setQuestionnaireLastSentAt,
      hydrateFollowUpsSentMap,
    },
    ui: {
      loading,
      setLoading,
      setEditingScope,
      toast,
      setToastMessage,
      setShowToast,
    },
    form: {
      validatePolicyHolderAll: validatePolicyHolderAll as (selected: unknown) => Record<string, string>,
      mapServerValidationToFieldErrors,
    },
    endorsementDraftRiskTransactionId,
    reloadCurrentPolicy,
    refreshPolicyDocuments,
    isInitialCreationFlowRef,
  });

  useEffect(() => {
    if (view !== 'detail') return;
    if (!selectedPortfolio?.id) return;
    if (selectedPortfolio.id === 'new') return;
    const status = String(selectedPortfolio.status || '').toUpperCase();
    if (!['DRAFT', 'INTAKE', 'QUOTED', 'QUOTE', 'AWAITING_PAYMENT', 'REFERRAL', 'INFO_REQUIRED'].includes(status)) return;
    if (editingScope) return;
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await reloadCurrentPolicy();
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
  }, [view, selectedPortfolio?.id, selectedPortfolio?.status, editingScope, reloadCurrentPolicy]);

  // Open PH edit scope once when a new placeholder arrives.
  // Guard: only when scope is null so a user cancel does not re-force edit mode.
  // Intentionally excludes editingScope from deps — we react to isNew becoming true,
  // not to every scope change; adding editingScope would re-trigger on every transition.
  useEffect(() => {
    if (selectedPortfolio?.isNew && editingScope === null) setEditingScope('policyHolder');
  }, [selectedPortfolio?.isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  usePolicyController({
    view,
    selectedPolicyId: selectedPortfolio?.id ? String(selectedPortfolio.id) : undefined,
    loadPolicyDetailsById: loadPolicyDetailsByIdStable,
  });

  const vm = useMemo(
    () =>
      buildPolicyPageViewModel({
        selectedPortfolio: selectedPortfolio?.id ? { id: String(selectedPortfolio.id) } : null,
        activeTab: activeTab ?? 'Policy Holder',
        routeId,
      }),
    [activeTab, routeId, selectedPortfolio?.id],
  );

  const endorsementDiff = usePolicyEndorsementDiff({
    selectedPolicyId: selectedPortfolio?.id ? String(selectedPortfolio.id) : null,
    endorsementDraftRiskTransactionId,
    latestIssuedRiskTransactionId,
    getPolicyVersionSnapshot: api.getPolicyVersionSnapshot,
  });
  const endorsementFieldChanged = (path: string) =>
    endorsementDiff.endorsementFieldChanged(path, asRecord(selectedPortfolio)?.quoteData || {});
  const refreshPolicyAfterProgramBinderAssignment = useCallback(() => {
    void loadPolicyDetails();
  }, [loadPolicyDetails]);

  const {
    selectedBinderId,
    setSelectedBinderId,
    availableBinders,
    bindersLoading,
    selectedProgramId,
    setSelectedProgramId,
    programs,
    programsLoading,
    ensureProgramBinderAssigned,
  } = usePolicyProgramsBinders({
    view,
    activeTab,
    selectedPortfolio,
    selectedPortfolioId: selectedPortfolio?.id ? String(selectedPortfolio.id) : undefined,
    setToastMessage,
    setShowToast,
    qStatus,
    onConfirmationNeeded: setPendingProgramBinderChange,
    onAssignmentPersisted: refreshPolicyAfterProgramBinderAssignment,
  });
  const prepareRatingIdentity = useCallback(async () => {
    const policyId = String(selectedPortfolio?.id || '').trim();
    if (!policyId || !selectedProgramId || !selectedBinderId) return {};
    if (!await ensureProgramBinderAssigned(policyId, selectedProgramId, selectedBinderId)) return null;
    await loadPolicyDetails();
    const selectedProgram = programs.find((program) => String(asRecord(program).id || '') === selectedProgramId);
    const productType = String(asRecord(selectedProgram).productType || asRecord(asRecord(selectedProgram).metadata).productType || '').trim().toUpperCase();
    return productType ? { productType } : {};
  }, [ensureProgramBinderAssigned, loadPolicyDetails, programs, selectedBinderId, selectedPortfolio?.id, selectedProgramId]);

  const { handleSendQuestionnaire } = usePolicyQuestionnaireFlow({
    selectedPortfolio: selectedPortfolio ? asRecord(selectedPortfolio) : null,
    isSending,
    setIsSending,
    questionnaireLastSentAt,
    setQuestionnaireLastSentAt,
    setQStatus,
    qStatus,
    getQuoteOrigin,
    loadPolicyDetails,
    setToastMessage,
    setShowToast,
    selectedProgramId,
    selectedBinderId,
    ensureProgramBinderAssigned,
  });

  const { issueReadiness, issueReadinessLoading, refreshIssueReadiness } = usePolicyReadiness({
    selectedPortfolio,
    activeTab,
    endorsementDraftRiskTransactionId,
  });
  useEffect(() => {
    if (activeTab !== 'Underwriting') return;
    const readiness = asRecord(issueReadiness);
    const stateMeta = asRecord(readiness.uwStateMeta);
    const underwritingState = normalizeUnderwritingDisplayState({
      uwStateRaw: String(readiness.uwState || '').trim().toUpperCase(),
      effectiveLastSavedBy: String(stateMeta.lastSavedBy || '').trim().toLowerCase(),
    });
    const nextStatus = deriveQuestionnaireStatusFromReadiness({
      currentStatus: qStatus,
      underwritingState,
    });
    if (nextStatus && nextStatus !== qStatus) setQStatus(nextStatus);
  }, [activeTab, issueReadiness, qStatus, setQStatus]);

  const {
    canSaveQuoteVersion,
    setCanSaveQuoteVersion,
    isSavingQuoteVersion,
    isBindingEndorsementDraft,
    isIssuingEndorsement,
    isCancellingEndorsementDraft,
    isGeneratingQuote,
    isIssuingQuote,
    isBindingPolicy,
    isBindingCoverage,
    showBindCoverageWorkflowModal,
    setShowBindCoverageWorkflowModal,
    showBindEndorsementWorkflowModal,
    setShowBindEndorsementWorkflowModal,
    isCreatingDraft,
    isIssuingPolicyFinal,
    isReRating,
    isUnlockingBoundMode,
    handleGenerateQuote,
    handleIssueQuote,
    handleBindPolicy,
    handleBindCoverage,
    handleIssuePolicyFinal,
    handleUnlockBoundMode,
    handleReRate,
    handleBindEndorsementDraft,
    handleCancelEndorsementDraft,
    handleIssueEndorsement,
    handleSaveQuoteVersion,
    handleCreateDraftPolicy,
    bindEndorsementDraftNow,
    handleIssueEndorsementFromWorkflow,
  } = usePolicyLifecycleActions({
    selectedPortfolio,
    endorsementDraftRiskTransactionId,
    viewingRiskTransactionSnapshot,
    refreshPolicyVersions,
    refreshPolicyDocuments,
    refreshIssueReadiness,
    reloadCurrentPolicy,
    loadPolicyDetails,
    clearQuoteSentIndicator,
    prepareRatingIdentity,
    resolvePublicAutoSessionId,
    setSelectedPortfolio,
    setViewingVersionId,
    setViewingRiskTransactionId,
    setViewingRiskTransactionSnapshot,
    setEditingScope,
    setCoverageDirty,
    setToastMessage,
    setShowToast,
    setToastType,
    setQuoteSentAt,
    setQuoteSentKey,
    toPolicyRecord,
    navigate,
  });

  getPolicyVM(selectedPortfolio);
  const isPolicyHolderEditing = editingScope === 'policyHolder';
  const showValidation = Boolean(isPolicyHolderEditing || selectedPortfolio?.isNew);
  const readOnly = !showValidation;
  const policyHolderSpine = usePolicyHolderSpine({
    selectedPortfolio,
    setSelectedPortfolio,
    isEditing: editingScope === 'policyHolder',
    setIsEditing: setPolicyHolderEditing,
    formErrors,
    validateField,
    clearFieldError,
    setFieldError,
    showValidation,
    readOnly,
    endorsementFieldChanged,
    loading,
    handleSavePolicy,
    handleSavePolicyHolder,
    handleCancelPolicyHolder,
    loadPolicyDetails,
    countryOptions: COUNTRY_OPTIONS,
    endorsementDraftRiskTransactionId,
  });

  const cancellationDraftInProgress = (() => {
    const draft = asRecord(asRecord(viewingRiskTransactionSnapshot).snapshotDraft || asRecord(viewingRiskTransactionSnapshot).snapshot);
    const ws = asRecord(draft.endorsementWorkspace);
    return String(ws.reasonCode || '').trim().toUpperCase() === 'CANCELLATION';
  })();

  const handleCreateNewQuote = () => setShowQuoteModal(true);

  return {
    view, isDetailRoute: vm.isDetailRoute, location, navigate, showToast, toastMessage, toastType, setShowToast,
    selectedPortfolio, displayedPortfolio, activeTab, setActiveTab, tabToHash, editingScope, setEditingScope, loading,
    policyHolderSpine, formErrors, validateField, clearFieldError, setFieldError, endorsementFieldChanged, COUNTRY_OPTIONS,
    handleCreateNewQuote, handleDeletePolicy, handleConfirmDelete, handleSavePolicy, handleSavePolicyHolder, handleCancelPolicyHolder, handleCreateSubmission, handleCancelRequest, loadPolicyDetails,
    getQuoteOrigin, openQuoteWizard,
    viewingVersionId, setViewingVersionId, policyVersions, setPolicyVersions, viewingRiskTransactionId, setViewingRiskTransactionId, viewingRiskTransactionSnapshot, setViewingRiskTransactionSnapshot, latestIssuedRiskTransactionId, isIssuedRecordMode, isIssuedLifecycle,
    billing, billingRiskTransactionId, setToastMessage,
    endorsementDraftRiskTransactionId, cancellationDraftInProgress, bindEndorsement, cancelEndorsement, reloadCurrentPolicy, refreshIssueReadiness,
    uw: { handleSendQuestionnaire, isSending, questionnaireLastSentAt, qStatus, getQuestionValue, uwAnswers, setUwAnswers, riskModel, followUpsSentMap, isEndorsementMode, openFollowUp, showBatchModal, setShowBatchModal, handleSendBatch },
    selectedBinderId, setSelectedBinderId, availableBinders, bindersLoading, selectedProgramId, setSelectedProgramId, programs, programsLoading,
    pendingProgramBinderChange, setPendingProgramBinderChange,
    issueReadiness, issueReadinessLoading,
    mbeTemplates, excessImpact, excessImpactLoading, coverageDirty, aggregateLimit, setAggregateLimit,
    lifecycle: {
      quoteSentAt, quoteSentKey, isReRating, isSavingQuoteVersion, isUnlockingBoundMode, isIssuingQuote, isBindingCoverage, isIssuingPolicyFinal, isBindingEndorsementDraft, isIssuingEndorsement, isCancellingEndorsementDraft,
      setCoverageDirty, setCanSaveQuoteVersion, canSaveQuoteVersion, clearQuoteSentIndicator, setSelectedPortfolio, setViewingRiskTransactionSnapshot, setViewingVersionId, setViewingRiskTransactionId,
      setShowRestoreVersionModal, setShowPricingSteps, setShowCreateEndorsementModal, setEndorsementEffectiveDate, setEndorsementReason,
      handleCancelEndorsementDraft, handleReRate, handleSaveQuoteVersion, handleUnlockBoundMode, handleIssueQuote, handleBindCoverage, handleIssuePolicyFinal, handleBindEndorsementDraft, handleIssueEndorsement,
      reloadCurrentPolicy, refreshIssueReadiness, handleGenerateQuote, isGeneratingQuote, handleBindPolicy, isBindingPolicy,
    },
    service: {
      showRequestInfoModal, setShowRequestInfoModal, requestInfoStep, setRequestInfoStep, requestInfoMessage, setRequestInfoMessage,
      isRequestingInfo, setIsRequestingInfo, loadPolicies, setToastMessage, setShowToast, openCancelRequestModal, isRequestingCancellation, isApprovingCancellation, setIsApprovingCancellation,
    },
    modals: {
      showQuoteModal, setShowQuoteModal, submissionSuccess, setSubmissionSuccess, newQuote, setNewQuote, showPricingSteps, setShowPricingSteps,
      showHistoryModal, setShowHistoryModal, showTraceModal, setShowTraceModal, showRestoreVersionModal, setShowRestoreVersionModal, isRestoringVersion, setIsRestoringVersion,
      showCreateEndorsementModal, setShowCreateEndorsementModal, isCreatingEndorsementDraft, setIsCreatingEndorsementDraft, endorsementEffectiveDate, setEndorsementEffectiveDate, endorsementReason, setEndorsementReason,
      showDeleteModal, showBindModal, policyToDelete, showCancelRequestModal, cancelReason, setCancelReason, cancelEffectiveDate, setCancelEffectiveDate, isRequestingCancellation,
      showBindCoverageWorkflowModal, setShowBindCoverageWorkflowModal, showBindEndorsementWorkflowModal, setShowBindEndorsementWorkflowModal, closeActiveModal,
    },
    followUp: { showFollowUpDrawer, setShowFollowUpDrawer, activeFollowUpContext, followUpNote, setFollowUpNote, followUpType, setFollowUpType, addActiveFollowUpToBatch },
    parseDateLoose, toISODateOnly, calcExpiryDateFromStart, docs,
    handleCreateDraftPolicy, bindEndorsementDraftNow, handleIssueEndorsementFromWorkflow, isCreatingDraft,
  };
}
