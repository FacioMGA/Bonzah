import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { policiesClient as api } from '../../api/policiesClient';
import type { PolicyRecord, PolicyUwAnswers, UwAnswersSetter } from '../../model/policy';
import { policyFollowUpsSentKey } from '../../model/policyStorage';

import { logger } from '@/src/shared/lib/logger';
import { asRecord } from '@/src/shared/lib/record';
import { ProductRegistry } from '@/src/shared/lib/products';

/**
 * Wizard-step identifiers a UW follow-up can target. These are semantic step ids
 * that products may use — `policy-holder`, `driving-history`, and `vehicle-cover`
 * are motor wizard ids; other products add their own via their manifests.
 * The type is intentionally open (`string`) for multi-product support.
 */
export type RequestStep = string;
export type QuestionnaireStatus = 'Draft' | 'Sent' | 'In Process' | 'Submitted' | 'Follow-ups requested' | 'Superseded';
export type FollowUpSentMap = Record<string, { sentAt: string; status: 'sent' | 'viewed' | 'answered' }>;

type FollowUpContext = {
  questionLabel: string;
  fieldKey: string;
  stepKey: RequestStep;
};

type UsePolicyFollowUpsArgs = {
  selectedPortfolio: PolicyRecord | null;
  uwAnswers: PolicyUwAnswers;
  setUwAnswers: UwAnswersSetter;
  setQStatus: Dispatch<SetStateAction<QuestionnaireStatus>>;
  setIsSending: Dispatch<SetStateAction<boolean>>;
  setToastMessage: (message: string) => void;
  setShowToast: (show: boolean) => void;
};

const followUpsSentKeyForPolicy = (policyId: string) => policyFollowUpsSentKey(policyId);

export function usePolicyFollowUps(args: UsePolicyFollowUpsArgs) {
  const {
    selectedPortfolio,
    uwAnswers,
    setUwAnswers,
    setQStatus,
    setIsSending,
    setToastMessage,
    setShowToast,
  } = args;

  const [showFollowUpDrawer, setShowFollowUpDrawer] = useState(false);
  const [activeFollowUpContext, setActiveFollowUpContext] = useState<FollowUpContext | null>(null);
  const [followUpNote, setFollowUpNote] = useState('');
  const [followUpType, setFollowUpType] = useState('Ask for more detail');
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [followUpsSentMap, setFollowUpsSentMap] = useState<FollowUpSentMap>({});

  const toFollowUpSentKey = useCallback((req: unknown): string => {
    const row = asRecord(req);
    const fieldKey = String(row.fieldKey || '').trim();
    const stepKey = String(row.stepKey || '').trim();
    if (fieldKey) return stepKey ? `${stepKey}:${fieldKey}` : fieldKey;
    // Backward compatibility for older entries keyed by question copy.
    return String(row.question || '').trim();
  }, []);

  const readFollowUpsSentMap = useCallback((policyId: string): FollowUpSentMap => {
    try {
      const raw = localStorage.getItem(followUpsSentKeyForPolicy(policyId));
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      const out: FollowUpSentMap = {};
      for (const [k, v] of Object.entries(asRecord(parsed))) {
        const row = asRecord(v);
        const status = String(row.status || '').toLowerCase();
        if (!k || !row.sentAt || !['sent', 'viewed', 'answered'].includes(status)) continue;
        out[String(k)] = { sentAt: String(row.sentAt), status: status as 'sent' | 'viewed' | 'answered' };
      }
      return out;
    } catch {
      return {};
    }
  }, []);

  const writeFollowUpsSentMap = useCallback((policyId: string, next: FollowUpSentMap) => {
    try {
      localStorage.setItem(followUpsSentKeyForPolicy(policyId), JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const hydrateFollowUpsSentMap = useCallback((policyId: string) => {
    setFollowUpsSentMap(readFollowUpsSentMap(policyId));
  }, [readFollowUpsSentMap]);

  const openFollowUp = useCallback((ctx: FollowUpContext) => {
    setActiveFollowUpContext({
      questionLabel: String(ctx.questionLabel || '').trim() || 'Question',
      fieldKey: String(ctx.fieldKey || '').trim(),
      stepKey: ctx.stepKey || '',
    });
    setFollowUpNote('');
    setFollowUpType('Ask for more detail');
    setShowFollowUpDrawer(true);
  }, []);

  const addActiveFollowUpToBatch = useCallback(() => {
    if (!followUpNote.trim()) {
      alert('Please enter a note for the follow-up request.');
      return;
    }
    if (!activeFollowUpContext?.questionLabel || !activeFollowUpContext?.fieldKey) {
      alert('Missing follow-up context. Please close and try again.');
      return;
    }
    const newRequest = {
      question: activeFollowUpContext.questionLabel,
      fieldKey: activeFollowUpContext.fieldKey,
      stepKey: activeFollowUpContext.stepKey,
      note: followUpNote,
      type: followUpType,
    };
    const updatedRequests = [...(uwAnswers.followUpRequests || []), newRequest];
    const updatedAnswers = { ...uwAnswers, followUpRequests: updatedRequests };
    setUwAnswers(updatedAnswers);

    if (selectedPortfolio?.id) {
      api.submitUWForm(String(selectedPortfolio.id), updatedAnswers).catch((err) => logger.error('Autosave failed', err));
    }
    setShowFollowUpDrawer(false);
    setToastMessage('Added to Request Batch');
    setShowToast(true);
  }, [activeFollowUpContext, followUpNote, followUpType, selectedPortfolio?.id, setShowToast, setToastMessage, setUwAnswers, uwAnswers]);

  const handleSendBatch = useCallback(async () => {
    // Products declare their own batch minimum via manifest.rules.batchRules.minUnits.
    const portfolioProductType = String(asRecord(selectedPortfolio)?.productType || '');
    const manifest = ProductRegistry.get(portfolioProductType);
    const minUnits = manifest?.rules?.batchRules?.minUnits ?? 0;
    if (minUnits > 0) {
      const units = parseInt(String(uwAnswers.totalUnits || '0'), 10);
      if (!Number.isFinite(units) || units < minUnits) {
        alert(`We cannot process portfolios with fewer than ${minUnits} units.`);
        return;
      }
    }

    setIsSending(true);
    try {
      const policyId = String(selectedPortfolio?.id || '').trim();
      if (policyId) {
        await api.sendFollowUpBatch(policyId, uwAnswers.followUpRequests || []);
      }
    } catch (err) {
      logger.error('Failed to send batch email', err);
    }

    await new Promise((resolve) => setTimeout(resolve, 800));
    setQStatus('Follow-ups requested');
    setToastMessage(`Request Batch Sent! (${(uwAnswers.followUpRequests || []).length} items)`);
    setShowToast(true);
    setShowBatchModal(false);
    setIsSending(false);

    if (selectedPortfolio?.id) {
      const nowIso = new Date().toISOString();
      const nextMap: FollowUpSentMap = { ...readFollowUpsSentMap(String(selectedPortfolio.id)) };
      for (const req of (uwAnswers.followUpRequests || [])) {
        const followUpKey = toFollowUpSentKey(req);
        if (!followUpKey) continue;
        nextMap[followUpKey] = { sentAt: nowIso, status: 'sent' };
      }
      setFollowUpsSentMap(nextMap);
      writeFollowUpsSentMap(String(selectedPortfolio.id), nextMap);
    }

    const currentDrafts = uwAnswers.followUpRequests || [];
    const updatedAnswers = {
      ...uwAnswers,
      followUpRequests: [],
      outstandingRequests: [...currentDrafts],
    };
    setUwAnswers(updatedAnswers);

    try {
      const res = await api.submitUWForm(String(selectedPortfolio?.id || ''), updatedAnswers);
      if (!res.success) {
        alert(`Warning: Failed to save requests to server. The customer may not see them. Error: ${res.error?.message}`);
        logger.error('Submit UW Form failed:', res);
      }
    } catch (err) {
      logger.error('Failed to sync cleared batch:', err);
    }
  }, [readFollowUpsSentMap, selectedPortfolio, setIsSending, setQStatus, setShowToast, setToastMessage, setUwAnswers, toFollowUpSentKey, uwAnswers, writeFollowUpsSentMap]);

  return {
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
  };
}
