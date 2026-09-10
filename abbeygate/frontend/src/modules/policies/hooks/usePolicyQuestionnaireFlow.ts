import { useCallback } from 'react';
import { policiesClient as api } from '../api/policiesClient';
import { asRecord } from '@/src/shared/lib/record';
import { policyQuestionnaireLastSentKey } from '../model/policyStorage';

type UsePolicyQuestionnaireFlowArgs = {
  selectedPortfolio: Record<string, unknown> | null;
  isSending: boolean;
  setIsSending: (sending: boolean) => void;
  questionnaireLastSentAt: Date | null;
  setQuestionnaireLastSentAt: (value: Date | null) => void;
  setQStatus: (status: 'Draft' | 'In Process' | 'Sent' | 'Submitted') => void;
  qStatus: string;
  getQuoteOrigin: (portfolio: unknown) => 'customer' | 'bo' | 'unknown';
  loadPolicyDetails: () => Promise<void>;
  setToastMessage: (message: string) => void;
  setShowToast: (show: boolean) => void;
  selectedProgramId?: string;
  selectedBinderId?: string;
  ensureProgramBinderAssigned: (policyId: string, programId: string, binderId: string) => Promise<boolean>;
};

export function usePolicyQuestionnaireFlow(args: UsePolicyQuestionnaireFlowArgs) {
  const {
    selectedPortfolio,
    isSending: _isSending,
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
  } = args;

  const handleSendQuestionnaire = useCallback(async () => {
    try {
      const currentPortfolio = selectedPortfolio;
      if (!currentPortfolio) return;

      setIsSending(true);

      if (currentPortfolio.isNew) {
        setToastMessage('Create the quote session first, then send the questionnaire.');
        setShowToast(true);
        setIsSending(false);
        return;
      }

      const policyId = String(currentPortfolio.id || '');
      if (!policyId || policyId === 'new') return;

      // A newly-created BO draft has no product until the operator's selected
      // Program + Binder pair is persisted. The dropdown auto-save is debounced,
      // so sending immediately after selection previously raced that save and
      // the backend correctly rejected the product-less questionnaire (ABY-470).
      if (!String(currentPortfolio.productType || '').trim()) {
        if (!selectedProgramId || !selectedBinderId) {
          setToastMessage('Select a program and binder before sending the questionnaire.');
          setShowToast(true);
          setIsSending(false);
          return;
        }
        const assigned = await ensureProgramBinderAssigned(policyId, selectedProgramId, selectedBinderId);
        if (!assigned) {
          setIsSending(false);
          return;
        }
      }

      const origin = getQuoteOrigin(currentPortfolio);
      const hasSent =
        Boolean(asRecord(asRecord(currentPortfolio).customerFlow).inviteSentAt) || Boolean(questionnaireLastSentAt);
      const kind: 'initial' | 'resend' = qStatus === 'Superseded' ? 'initial' : origin === 'customer' ? 'resend' : hasSent ? 'resend' : 'initial';

      const resp = await api.sendQuestionnaire(policyId, { kind });
      if (!resp.success) {
        setToastMessage(`Failed to send email: ${resp.error?.message || 'Unknown error'}`);
        setShowToast(true);
        setIsSending(false);
        return;
      }

      setQStatus('Sent');
      const sentAt = new Date(String(asRecord(resp.data).sentAt || Date.now()));
      localStorage.setItem(policyQuestionnaireLastSentKey(policyId), sentAt.toISOString());
      setQuestionnaireLastSentAt(sentAt);

      const recipient = asRecord(resp.data).recipient || 'the customer';
      setToastMessage(kind === 'initial' ? `Proposal email sent to ${recipient}.` : `Reminder email sent to ${recipient}.`);
      setShowToast(true);
      setIsSending(false);
      await loadPolicyDetails();
    } catch {
      setToastMessage('Failed to send questionnaire');
      setShowToast(true);
      setIsSending(false);
    }
  }, [
    getQuoteOrigin,
    ensureProgramBinderAssigned,
    loadPolicyDetails,
    questionnaireLastSentAt,
    qStatus,
    selectedPortfolio,
    selectedProgramId,
    selectedBinderId,
    setQStatus,
    setIsSending,
    setQuestionnaireLastSentAt,
    setShowToast,
    setToastMessage,
  ]);

  return {
    isSending: _isSending,
    handleSendQuestionnaire,
  };
}
