import React, { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { policiesClient as api } from '../api/policiesClient';
import { cancellationApiClient } from '../api/cancellationApiClient';
import { policyCrudApiClient } from '../api/policyCrudApiClient';
import { initialUwAnswers, isQuoteSubmittedStatus, normalizePolicyForState } from '../model/policyPageHelpers';
import { logger } from '@/src/shared/lib/logger';
import { asRecord } from '@/src/shared/lib/record';
import type { PolicyUwAnswers } from '../model/policy';
import type { EditingScope } from '../detail/PolicyWorkspaceContext';
import { policyQuestionnaireLastSentKey } from '../model/policyStorage';

type UnknownRecord = Record<string, unknown>;
type PolicyLike = Record<string, unknown> | null;

function customerConflictMatches(details: unknown): UnknownRecord[] {
  const record = asRecord(details);
  return Array.isArray(record.matches) ? record.matches.map((match) => asRecord(match)) : [];
}

function buildCustomerConflictPrompt(matches: UnknownRecord[]): string {
  const lines = matches.slice(0, 3).map((match, index) => {
    const name = String(match.name || 'Existing customer').trim();
    const email = String(match.email || '').trim();
    const nif = String(match.nif || '').trim();
    const reasons = Array.isArray(match.reasons) ? match.reasons.join(', ') : 'match';
    return `${index + 1}. ${name}${email ? ` <${email}>` : ''}${nif ? `, NIF ${nif}` : ''} (${reasons})`;
  });
  return [
    'A customer account already exists with this email or NIF.',
    '',
    ...lines,
    '',
    'Attach this policy to the first matching customer? Choose Cancel to create a new customer instead.',
  ].join('\n');
}

type UsePolicyCrudActionsArgs = {
  location: { search?: string; pathname: string };
  view: string;
  activeTab: string;
  selectedPortfolio: PolicyLike;
  routeSetters: {
    setView: (value: string) => void;
    setSelectedPortfolio: (value: unknown) => void;
    setActiveTab: (value: string) => void;
    navigate: (to: string | { pathname: string; search?: string; hash?: string }, opts?: { replace?: boolean }) => void;
  };
  quoteSession: {
    forceEditOnNextLoadRef: React.MutableRefObject<boolean>;
    DEFAULT_AUTO_QUOTE_DATA: Record<string, unknown>;
    resolvePublicAutoSessionId: (policyId: string) => Promise<string>;
    getQuoteOrigin: (selectedPortfolio: unknown) => string;
  };
  viewState: {
    newQuote: Record<string, unknown> | null;
    setShowQuoteModal: (show: boolean) => void;
    setSubmissionSuccess: (value: boolean) => void;
    policyToDelete: string | null;
    closeActiveModal: () => void;
    cancelReason: string;
    setCancelReason: (value: string) => void;
    cancelEffectiveDate: string;
    setCancelEffectiveDate: (value: string) => void;
    setIsRequestingCancellation: (value: boolean) => void;
    openDeletePolicyModal: (id: string) => void;
  };
  uw: {
    uwAnswers: PolicyUwAnswers;
    setUwAnswers: React.Dispatch<React.SetStateAction<PolicyUwAnswers>>;
    setQStatus: (value: 'Draft' | 'Sent' | 'In Process' | 'Submitted' | 'Follow-ups requested' | 'Superseded') => void;
    readQuestionnaireLastSentAt: (policyId: string) => Date | null;
    setQuestionnaireLastSentAt: (value: Date | null) => void;
    hydrateFollowUpsSentMap: (policyId: string) => void;
  };
  ui: {
    loading: boolean;
    setLoading: React.Dispatch<React.SetStateAction<boolean>>;
    setEditingScope: (scope: EditingScope) => void;
    toast: (message: string) => void;
    setToastMessage: (message: string) => void;
    setShowToast: (show: boolean) => void;
  };
  form: {
    validatePolicyHolderAll: (selected: unknown) => Record<string, string>;
    mapServerValidationToFieldErrors: (details: unknown) => void;
  };
  endorsementDraftRiskTransactionId: string | null;
  reloadCurrentPolicy: (opts?: { riskTransactionId?: string | null }) => Promise<void>;
  refreshPolicyDocuments: (policyId: string) => Promise<void>;
  /** Set to true by createNeutralDraftPolicy; cleared after the first PH save so that
   *  only the initial creation flow auto-advances the editing scope to 'underwriting'. */
  isInitialCreationFlowRef: React.MutableRefObject<boolean>;
};

export function usePolicyCrudActions(args: UsePolicyCrudActionsArgs) {
  const queryClient = useQueryClient();
  const {
    location,
    view,
    activeTab,
    selectedPortfolio,
    routeSetters,
    quoteSession,
    viewState,
    uw,
    ui,
    form,
    endorsementDraftRiskTransactionId,
    reloadCurrentPolicy,
    refreshPolicyDocuments,
    isInitialCreationFlowRef,
  } = args;

  const lastLoadedPolicyIdRef = useRef<string | null>(null);
  const {
    setView,
    setSelectedPortfolio,
    setActiveTab,
    navigate,
  } = routeSetters;

  const loadPolicies = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['policies', 'recordList'] });
  }, [queryClient]);

  const closeDeletePolicyModal = () => {
    viewState.closeActiveModal();
  };

  const handleDeletePolicy = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    viewState.openDeletePolicyModal(id);
  };

  const detailRequest = useRef(0);
  const loadPolicyDetailsByIdRef = useRef<((policyId: string) => Promise<void>) | null>(null);
  const loadPolicyDetailsById = async (policyId: string) => {
    if (!policyId || policyId === 'new') return;
    const request = ++detailRequest.current;
    ui.setLoading(true);
    const wantsEdit = new URLSearchParams(location.search || '').get('edit') === '1';

    const switchingPolicy = lastLoadedPolicyIdRef.current !== policyId;
    lastLoadedPolicyIdRef.current = policyId;
    if (switchingPolicy) {
      uw.setUwAnswers(initialUwAnswers);
      if (quoteSession.forceEditOnNextLoadRef.current || wantsEdit) {
        ui.setEditingScope('policyHolder');
        quoteSession.forceEditOnNextLoadRef.current = false;
      } else {
        ui.setEditingScope(null);
      }
      uw.setQStatus('Draft');
    }
    const lastSentAt = uw.readQuestionnaireLastSentAt(String(policyId));
    uw.setQuestionnaireLastSentAt(lastSentAt);
    uw.hydrateFollowUpsSentMap(String(policyId));
    if (activeTab === 'Documents') {
      refreshPolicyDocuments(policyId);
    }

    try {
      const response = await api.getPolicy(policyId);
      if(request !== detailRequest.current)return;
      if(!response.success || !response.data)throw new Error(response.error?.message || 'Policy could not be loaded in this workspace.');
      if (response.success && response.data) {
        const policyData = asRecord(response.data);

        const normalized = normalizePolicyForState({
          policyDataRaw: policyData,
          prevPortfolio: selectedPortfolio,
        });

        if (switchingPolicy) {
          const serverInviteAtRaw = asRecord(policyData?.customerFlow)?.inviteSentAt;
          const serverInviteAt = serverInviteAtRaw ? new Date(String(serverInviteAtRaw)) : null;
          if (serverInviteAt && !Number.isNaN(serverInviteAt.getTime())) {
            uw.setQuestionnaireLastSentAt(serverInviteAt);
          }
          uw.setQStatus(serverInviteAt || lastSentAt ? 'Sent' : 'Draft');
        }
        // Superseded check — must run after the basic Sent/Draft hydration above so it wins.
        const customerFlow = asRecord(policyData?.customerFlow);
        if (String(customerFlow.questionnaireSupersededAt || '').trim()) {
          uw.setQStatus('Superseded');
          // Clear the localStorage timestamp so the send button label resets correctly.
          if (typeof window !== 'undefined') {
            localStorage.removeItem(policyQuestionnaireLastSentKey(String(policyData.id)));
          }
          uw.setQuestionnaireLastSentAt(null);
        }

        const backendUwData = normalized.backendUwData;
        setSelectedPortfolio(() => normalized.nextPortfolio);

        if (activeTab === 'Underwriting') {
          try {
            const uwRes = await api.getUWForm(policyId);
            if(request !== detailRequest.current)return;
            const uwData = uwRes?.success ? uwRes.data : {};
            const uwRecord = asRecord(uwData);
            setSelectedPortfolio({
              ...asRecord(normalized.nextPortfolio),
              programmeDefinition: uwRecord.programmeDefinition ?? null,
              programmeDefinitionError: uwRecord.programmeDefinitionError ?? null,
            });
            uw.setUwAnswers({
              ...initialUwAnswers,
              ...(uwData && typeof uwData === 'object' ? uwData : {}),
            });
          } catch {
            uw.setUwAnswers(initialUwAnswers);
          }
        } else {
          uw.setUwAnswers({
            ...initialUwAnswers,
            ...backendUwData,
          });
        }

        const serverInviteAt = asRecord(policyData?.customerFlow)?.inviteSentAt;
        const persistedInviteAt = uw.readQuestionnaireLastSentAt(String(policyId));
        const hasInvite = Boolean(serverInviteAt) || Boolean(persistedInviteAt);
        // Superseded takes precedence over Sent/Draft — product changed after questionnaire was sent.
        const isSuperseded = !!String(asRecord(policyData?.customerFlow).questionnaireSupersededAt || '').trim();
        if (isSuperseded) {
          uw.setQStatus('Superseded');
          uw.setQuestionnaireLastSentAt(null);
        } else {
          uw.setQStatus(hasInvite ? 'Sent' : 'Draft');
        }
        viewState.setSubmissionSuccess(isQuoteSubmittedStatus(policyData.status));
      }
    } catch (err) {
      logger.error('Failed to load policy details:', err);
      if(request === detailRequest.current){setSelectedPortfolio({id:policyId,loadError:err instanceof Error ? err.message : 'Policy unavailable in this workspace.'});ui.setEditingScope(null);}
    } finally {if(request === detailRequest.current)ui.setLoading(false);}
  };

  const loadPolicyDetails = async () => {
    const selectedId = String(asRecord(selectedPortfolio).id || '').trim();
    if (!selectedId) return;
    await loadPolicyDetailsById(selectedId);
  };
  loadPolicyDetailsByIdRef.current = loadPolicyDetailsById;
  const loadPolicyDetailsByIdStable = React.useCallback(async (policyId: string) => {
    await loadPolicyDetailsByIdRef.current?.(policyId);
  }, []);

  const handleCreateSubmission = async () => {
    try {
      const productType = String(asRecord(viewState.newQuote).productType || '').trim().toUpperCase();
      if (!productType) throw new Error('Product type is required to create a submission');
      const rawName = String(viewState.newQuote?.insuredName || '').trim();
      const resp = await api.createPolicy({
        productType,
        ...(rawName ? { name: rawName } : {}),
      });
      const policyId = String(asRecord(resp?.data).id || '').trim();
      if (!resp?.success || !policyId) throw new Error(resp?.error?.message || 'Failed to create submission');

      isInitialCreationFlowRef.current = true;
      quoteSession.forceEditOnNextLoadRef.current = true;
      viewState.setShowQuoteModal(false);
      navigate({ pathname: `/policies/${policyId}`, search: '?edit=1', hash: '#policy-holder' });
      setSelectedPortfolio({ id: policyId });
      setView('detail');
      setActiveTab('Policy Holder');
    } catch (err) {
      logger.error('Exception during submission:', err);
      ui.setToastMessage((err as Error)?.message || 'Failed to create new submission');
      ui.setShowToast(true);
    }
  };

  const handleConfirmDelete = async () => {
    if (!viewState.policyToDelete) return;
    try {
      const response = await api.deletePolicy(viewState.policyToDelete);
      if (response.success) {
        queryClient.invalidateQueries({ queryKey: ['policies', 'recordList'] });
        loadPolicies();
        if (view === 'detail') {
          setView('list');
          setSelectedPortfolio(null);
        }
        closeDeletePolicyModal();
      } else {
        ui.setToastMessage('Failed to delete policy');
        ui.setShowToast(true);
      }
    } catch (err) {
      logger.error('Failed to delete policy:', err);
      ui.setToastMessage('Error deleting policy');
      ui.setShowToast(true);
    }
  };

  const handleSavePolicy = async () => {
    if (!selectedPortfolio || ui.loading) return;
    try {
      if (asRecord(selectedPortfolio).isNew) {
        ui.toast('Create the quote session first, then save policy data.');
        return;
      }
      logger.info('--- Saving Existing Policy (V2 + Header Update) ---');
      ui.setLoading(true);
      await api.submitUWForm(String(asRecord(selectedPortfolio).id || ''), uw.uwAnswers);
      await loadPolicyDetails();
      await loadPolicies();
      ui.toast('Changes saved successfully!');
      ui.setEditingScope(null);
    } catch (err) {
      logger.error('Failed to save changes:', err);
      ui.setToastMessage(`Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      ui.setShowToast(true);
    } finally {
      ui.setLoading(false);
    }
  };

  const handleSavePolicyHolder = async () => {
    if (!selectedPortfolio) return;
    const selectedId = String(asRecord(selectedPortfolio).id || '').trim();
    if (asRecord(selectedPortfolio).isNew && (!selectedId || selectedId === 'new')) {
      await handleSavePolicy();
      return;
    }
    try {
      ui.setLoading(true);
      const errors = form.validatePolicyHolderAll(selectedPortfolio);
      if (Object.keys(errors).length > 0) {
        const firstError = Object.values(errors).find((message) => String(message || '').trim());
        ui.toast(firstError ? `Please fix: ${firstError}` : 'Please fix the highlighted fields before saving.');
        return;
      }
      const quoteData = asRecord(selectedPortfolio)?.quoteData || {};

      // After a successful save, advance the editing scope:
      //   - Initial creation (isInitialCreationFlowRef=true): navigate to UW in edit mode.
      //   - All subsequent PH edits: return to view mode (null scope) on the current tab.
      const advanceEditingScope = () => {
        if (isInitialCreationFlowRef.current) {
          isInitialCreationFlowRef.current = false;
          ui.setEditingScope('underwriting');
          const nextSearchParams = new URLSearchParams(location.search || '');
          nextSearchParams.delete('tab');
          nextSearchParams.delete('edit');
          const nextSearch = nextSearchParams.toString();
          setActiveTab('Underwriting');
          navigate(
            {
              pathname: `/policies/${String(asRecord(selectedPortfolio).id || '')}`,
              search: nextSearch ? `?${nextSearch}` : '',
              hash: '#underwriting',
            },
            { replace: true }
          );
        } else {
          ui.setEditingScope(null);
        }
      };

      if (endorsementDraftRiskTransactionId) {
        const resp = await api.patchEndorsementDraft(
          String(asRecord(selectedPortfolio).id),
          String(endorsementDraftRiskTransactionId),
          { quoteData }
        );
        if (!resp?.success) {
          form.mapServerValidationToFieldErrors(resp?.error?.details);
          ui.toast(resp?.error?.message || 'Failed to save endorsement policy holder details');
          return;
        }
        await reloadCurrentPolicy();
        ui.setEditingScope(null);
        return;
      }

      const productType = String(asRecord(selectedPortfolio).productType || '').trim().toUpperCase();
      if (!productType) {
        const resp = await api.submitUWForm(String(asRecord(selectedPortfolio).id || ''), {
          quoteDataUpdates: quoteData,
        });
        if (!resp?.success) {
          form.mapServerValidationToFieldErrors(resp?.error?.details);
          ui.toast(resp?.error?.message || 'Failed to save policy holder details');
          return;
        }

        advanceEditingScope();
        await loadPolicyDetails();
        await loadPolicies();
        ui.toast('Policy holder updated.');
        return;
      }

      const existingPublicId = String(asRecord(selectedPortfolio).publicSessionToken || '').trim();
      const publicId = existingPublicId || await quoteSession.resolvePublicAutoSessionId(String(asRecord(selectedPortfolio).id || ''));
      const resp = await policyCrudApiClient.patchQuoteSession(productType, publicId, { quoteData, step: 'policy-holder', materializeAccount: true, origin: 'bo' });
      if (!resp?.success) {
        if (resp?.error?.code === 'CUSTOMER_ACCOUNT_CONFLICT') {
          const matches = customerConflictMatches(resp.error.details);
          const firstMatchId = String(matches[0]?.policyHolderId || '').trim();
          if (firstMatchId) {
            const attachExisting = window.confirm(buildCustomerConflictPrompt(matches));
            const resolution = attachExisting
              ? { action: 'attachExisting', policyHolderId: firstMatchId }
              : { action: 'createNew' };
            const resolved = await policyCrudApiClient.patchQuoteSession(productType, publicId, {
              quoteData,
              step: 'policy-holder',
              materializeAccount: true,
              origin: 'bo',
              customerAccountResolution: resolution,
            });
            if (resolved?.success) {
              advanceEditingScope();
              await loadPolicyDetails();
              await loadPolicies();
              ui.toast(attachExisting ? 'Policy attached to existing customer.' : 'New customer created and attached.');
              return;
            }
            form.mapServerValidationToFieldErrors(resolved?.error?.details);
            ui.toast(resolved?.error?.message || 'Failed to save policy holder details');
            return;
          }
        }
        form.mapServerValidationToFieldErrors(resp?.error?.details);
        ui.toast(resp?.error?.message || 'Failed to save policy holder details');
        return;
      }

      advanceEditingScope();
      await loadPolicyDetails();
      await loadPolicies();
      ui.toast('Policy holder updated.');
    } catch (err) {
      logger.error('Failed to save policy holder:', err);
      ui.toast('Failed to save policy holder.');
    } finally {
      ui.setLoading(false);
    }
  };

  const handleCancelPolicyHolder = async () => {
    const selectedId = String(asRecord(selectedPortfolio).id || '').trim();
    if (!selectedId || selectedId === 'new') {
      setView('list');
      setSelectedPortfolio(null);
      ui.setEditingScope(null);
      navigate('/policies', { replace: true });
      return;
    }
    try {
      ui.setLoading(true);
      const latest = await api.getPolicy(selectedId);
      const latestRecord = asRecord(latest?.data);
      const latestQuoteData = asRecord(latestRecord.quoteData);
      const statusUpper = String(latestRecord.status || '').toUpperCase();
      const isTemporaryDraft =
        statusUpper === 'DRAFT' &&
        !String(latestRecord.productType || '').trim() &&
        Object.keys(latestQuoteData).every((key) => key === '__meta');

      if (isTemporaryDraft) {
        const deleted = await api.deletePolicy(selectedId);
        if (!deleted?.success) throw new Error(deleted?.error?.message || 'Failed to discard draft');
        await loadPolicies();
        setView('list');
        setSelectedPortfolio(null);
        ui.setEditingScope(null);
        navigate('/policies', { replace: true });
        ui.toast('Draft discarded.');
        return;
      }

      await loadPolicyDetails();
      ui.setEditingScope(null);
      ui.toast('Edits discarded.');
    } catch (err) {
      logger.error('Failed to cancel policy holder edit:', err);
      ui.toast((err as Error)?.message || 'Failed to cancel edits.');
    } finally {
      ui.setLoading(false);
    }
  };

  const handleCancelRequest = async () => {
    const selectedId = String(asRecord(selectedPortfolio).id || '').trim();
    if (!selectedId) return;
    try {
      viewState.setIsRequestingCancellation(true);
      const resp = await cancellationApiClient.requestPolicyCancellation(selectedId, {
        reason: viewState.cancelReason || undefined,
        requestedEffectiveDate: viewState.cancelEffectiveDate || undefined,
      });
      if (!resp?.success) throw new Error(resp?.error?.message || 'Failed to request cancellation');
      ui.toast('Cancellation request recorded and sent to UW/ops (best-effort).');
      viewState.closeActiveModal();
      viewState.setCancelReason('');
      viewState.setCancelEffectiveDate('');
      await loadPolicyDetails();
      await loadPolicies();
    } catch (e) {
      ui.toast((e as Error).message || 'Failed to request cancellation');
    } finally {
      viewState.setIsRequestingCancellation(false);
    }
  };

  return {
    loadPolicies,
    closeDeletePolicyModal,
    handleDeletePolicy,
    handleConfirmDelete,
    handleCreateSubmission,
    handleSavePolicy,
    handleSavePolicyHolder,
    handleCancelPolicyHolder,
    handleCancelRequest,
    loadPolicyDetails,
    loadPolicyDetailsByIdStable,
  };
}
