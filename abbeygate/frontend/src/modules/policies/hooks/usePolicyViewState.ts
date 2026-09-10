import { useState } from 'react';

export type RequestInfoStep = 'policy-holder' | 'driving-history' | 'vehicle-cover' | 'your-quote' | 'payment' | '';
type NewQuoteState = {
  insuredName: string;
  productType: string;
  segment: string;
  premium: string;
  agent: string;
};

type ActivePolicyModal =
  | { type: 'deletePolicy'; policyId: string }
  | { type: 'bindPolicy' }
  | { type: 'cancelRequest' }
  | { type: 'requestInfo'; step: RequestInfoStep; message: string }
  | null;

export function usePolicyViewState() {
  const [showCreateEndorsementModal, setShowCreateEndorsementModal] = useState(false);
  const [endorsementEffectiveDate, setEndorsementEffectiveDate] = useState('');
  const [endorsementReason, setEndorsementReason] = useState('');
  const [isCreatingEndorsementDraft, setIsCreatingEndorsementDraft] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showTraceModal, setShowTraceModal] = useState(false);
  const [showRestoreVersionModal, setShowRestoreVersionModal] = useState(false);
  const [isRestoringVersion, setIsRestoringVersion] = useState(false);
  const [newQuote, setNewQuote] = useState<NewQuoteState>({
    insuredName: '',
    productType: '',
    segment: '',
    premium: '',
    agent: 'TrustLine Agency',
  });
  const [submissionSuccess, setSubmissionSuccess] = useState(false);
  const [activeModal, setActiveModal] = useState<ActivePolicyModal>(null);
  const [showPricingSteps, setShowPricingSteps] = useState(false);
  const [isRequestingInfo, setIsRequestingInfo] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelEffectiveDate, setCancelEffectiveDate] = useState('');
  const [isRequestingCancellation, setIsRequestingCancellation] = useState(false);
  const [isApprovingCancellation, setIsApprovingCancellation] = useState(false);

  const showDeleteModal = activeModal?.type === 'deletePolicy';
  const policyToDelete = activeModal?.type === 'deletePolicy' ? activeModal.policyId : null;
  const showBindModal = activeModal?.type === 'bindPolicy';
  const showCancelRequestModal = activeModal?.type === 'cancelRequest';
  const showRequestInfoModal = activeModal?.type === 'requestInfo';
  const requestInfoMessage = activeModal?.type === 'requestInfo' ? activeModal.message : '';
  const requestInfoStep = activeModal?.type === 'requestInfo' ? activeModal.step : '';

  const closeActiveModal = () => setActiveModal(null);
  const openDeletePolicyModal = (policyId: string) => setActiveModal({ type: 'deletePolicy', policyId });
  const openBindPolicyModal = () => setActiveModal({ type: 'bindPolicy' });
  const openCancelRequestModal = () => setActiveModal({ type: 'cancelRequest' });
  const openRequestInfoModal = (step: RequestInfoStep = '', message = '') => {
    setActiveModal({ type: 'requestInfo', step, message });
  };

  const setShowRequestInfoModal = (show: boolean) => {
    setActiveModal((prev) => {
      if (show) {
        if (prev?.type === 'requestInfo') return prev;
        return { type: 'requestInfo', step: '', message: '' };
      }
      return prev?.type === 'requestInfo' ? null : prev;
    });
  };
  const setRequestInfoStep = (step: RequestInfoStep) => {
    setActiveModal((prev) => {
      if (prev?.type !== 'requestInfo') return prev;
      return { ...prev, step };
    });
  };
  const setRequestInfoMessage = (message: string) => {
    setActiveModal((prev) => {
      if (prev?.type !== 'requestInfo') return prev;
      return { ...prev, message };
    });
  };

  return {
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
    activeModal,
    closeActiveModal,
    openDeletePolicyModal,
    openBindPolicyModal,
    openCancelRequestModal,
    openRequestInfoModal,
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
  };
}
