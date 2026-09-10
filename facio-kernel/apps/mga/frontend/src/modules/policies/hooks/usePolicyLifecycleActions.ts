import { useState } from 'react';
import { policiesClient as api } from '../api/policiesClient';
import { policyCrudApiClient } from '../api/policyCrudApiClient';
import { issuePolicy, unlockBoundMode } from '../commands/issuePolicy';
import { bindCoverage, bindPolicy, generateDraftPolicyPack } from '../commands/bindPolicy';
import {
  bindEndorsementDraft,
  cancelEndorsementDraft,
  createEndorsementDraft,
  issueEndorsement,
  rateEndorsementDraft,
  saveEndorsementVersion,
} from '../commands/endorsement';
import type { PolicyRecord, PolicyStateSetter, UnknownRecord, UnknownRecordSetter } from '../model/policy';
import type { EditingScope } from '../detail/PolicyWorkspaceContext';
import { policyDisplayStatus } from '../model/policyStateFlag';
import { buildEndorsementDraftSnapshotStub } from '../model/policyPageHelpers';

import { logger } from '@/src/shared/lib/logger';
import { asRecord } from '@/src/shared/lib/record';
import { hasOnlyAutoRefreshPricingBlockers } from '../model/issueReadinessDisplay';

type ApiResult<T = unknown> = {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown; blockers?: unknown };
};

type NavigateLike = (to: string | { pathname?: string; search?: string; hash?: string }, opts?: { replace?: boolean }) => void;
type WorkflowModal = 'bindCoverage' | 'bindEndorsement' | null;

type UsePolicyLifecycleActionsArgs = {
  selectedPortfolio: PolicyRecord | null;
  endorsementDraftRiskTransactionId: string | null;
  viewingRiskTransactionSnapshot: UnknownRecord | null;
  refreshPolicyVersions?: (policyId: string) => Promise<void>;
  refreshPolicyDocuments: (policyId: string) => Promise<void>;
  refreshIssueReadiness: (policyId: string, opts?: { riskTransactionId?: string | null }) => Promise<void>;
  reloadCurrentPolicy: (opts?: { riskTransactionId?: string | null }) => Promise<void>;
  loadPolicyDetails: () => Promise<void>;
  clearQuoteSentIndicator: () => void;
  /** Persists and reloads a pending program/binder choice before the quote is rated. */
  prepareRatingIdentity?: () => Promise<{ productType?: string } | null>;
  resolvePublicAutoSessionId: (policyId: string) => Promise<string>;
  setSelectedPortfolio: PolicyStateSetter;
  setViewingVersionId: React.Dispatch<React.SetStateAction<string | null>>;
  setViewingRiskTransactionId: React.Dispatch<React.SetStateAction<string | null>>;
  setViewingRiskTransactionSnapshot: UnknownRecordSetter;
  setEditingScope: (scope: EditingScope) => void;
  setCoverageDirty: React.Dispatch<React.SetStateAction<boolean>>;
  setToastMessage: (message: string) => void;
  setShowToast: (show: boolean) => void;
  /**
   * Optional setter for the toast tone. When supplied, lifecycle
   * failures (bind / send-quote / save-version / issue) flip the toast
   * to the `error` styling so an operator can immediately tell that
   * the action failed and that the message is the failure reason — not
   * a confirmation. Without it, the page falls back to the previous
   * always-success styling for back-compat. See ABY-88.
   */
  setToastType?: (type: 'success' | 'error' | 'info') => void;
  setQuoteSentAt: React.Dispatch<React.SetStateAction<Date | null>>;
  setQuoteSentKey: React.Dispatch<React.SetStateAction<string>>;
  toPolicyRecord: (value: unknown) => PolicyRecord;
  navigate: NavigateLike;
};

function asSnapshot(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return asRecord(value);
}

function firstBlockerMessage(value: unknown): string {
  const blockers = Array.isArray(value) ? value.map((entry) => asRecord(entry)) : [];
  const firstMessage = blockers
    .map((blocker) => String(blocker.message || blocker.code || '').trim())
    .find((message) => message.length > 0);
  return firstMessage || '';
}

function apiErrorMessage(result: ApiResult | undefined | null, fallback: string): string {
  const error = asRecord(result?.error);
  const direct = String(error.message || '').trim();
  const blockerMessage =
    firstBlockerMessage(error.blockers) ||
    firstBlockerMessage(asRecord(error.details).blockers);
  return blockerMessage || direct || fallback;
}

function getCoverageSelectionPayload(policy: unknown): { selected?: Record<string, boolean>; params?: Record<string, unknown>; source?: string } | undefined {
  const record = asRecord(policy);
  const directSelection = asRecord(record.coverageSelection);
  const snapshotSelection = asRecord(asSnapshot(record.stateSnapshot).coverageSelection);
  const coverageSelection = Object.keys(directSelection).length > 0 ? directSelection : snapshotSelection;
  const selectedRaw = coverageSelection.selected;
  const paramsRaw = coverageSelection.params;
  const selected =
    selectedRaw && typeof selectedRaw === 'object'
      ? Object.fromEntries(Object.entries(asRecord(selectedRaw)).map(([key, value]) => [key, Boolean(value)]))
      : undefined;
  const params = paramsRaw && typeof paramsRaw === 'object' ? asRecord(paramsRaw) : undefined;
  const source = typeof coverageSelection.source === 'string' && coverageSelection.source.trim()
    ? coverageSelection.source.trim()
    : undefined;
  if (!selected && !params) return undefined;
  return { ...(selected ? { selected } : {}), ...(params ? { params } : {}), ...(source ? { source } : {}) };
}

export function usePolicyLifecycleActions(args: UsePolicyLifecycleActionsArgs) {
  const {
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
  } = args;

  // Centralised so we never forget to flip the tone on the failure
  // branch of a lifecycle action. `setToastType` is optional so callers
  // that haven't migrated to the typed toast still work — they just
  // keep the legacy success styling.
  const showErrorToast = (message: string) => {
    setToastMessage(message);
    setToastType?.('error');
    setShowToast(true);
  };
  const showSuccessToast = (message: string) => {
    setToastMessage(message);
    setToastType?.('success');
    setShowToast(true);
  };

  const [isGeneratingQuote, setIsGeneratingQuote] = useState(false);
  const [isIssuingQuote, setIsIssuingQuote] = useState(false);
  const [isBindingPolicy, setIsBindingPolicy] = useState(false);
  const [isBindingCoverage, setIsBindingCoverage] = useState(false);
  const [activeWorkflowModal, setActiveWorkflowModal] = useState<WorkflowModal>(null);
  const showBindCoverageWorkflowModal = activeWorkflowModal === 'bindCoverage';
  const showBindEndorsementWorkflowModal = activeWorkflowModal === 'bindEndorsement';
  const [boundRiskTransactionId, setBoundRiskTransactionId] = useState<string | null>(null);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [isIssuingPolicyFinal, setIsIssuingPolicyFinal] = useState(false);
  const [isReRating, setIsReRatingAuto] = useState(false);
  const [isUnlockingBoundMode, setIsUnlockingBoundMode] = useState(false);
  const [canSaveQuoteVersion, setCanSaveQuoteVersion] = useState(false);
  const [isSavingQuoteVersion, setIsSavingQuoteVersion] = useState(false);
  const [isBindingEndorsementDraft, setIsBindingEndorsementDraft] = useState(false);
  const [isIssuingEndorsement, setIsIssuingEndorsement] = useState(false);
  const [isCancellingEndorsementDraft, setIsCancellingEndorsementDraft] = useState(false);

  const setShowBindCoverageWorkflowModal = (show: boolean) => {
    setActiveWorkflowModal((prev) => {
      if (show) return 'bindCoverage';
      return prev === 'bindCoverage' ? null : prev;
    });
  };
  const setShowBindEndorsementWorkflowModal = (show: boolean) => {
    setActiveWorkflowModal((prev) => {
      if (show) return 'bindEndorsement';
      return prev === 'bindEndorsement' ? null : prev;
    });
  };

  const handleGenerateQuote = async () => {
    if (!selectedPortfolio) return;
    const newTab = window.open('', '_blank');
    if (newTab) {
      newTab.document.write(`
        <html>
          <head>
            <title>Preparing Quote...</title>
            <style>
              body { display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; }
              .spinner { width: 40px; height: 40px; border: 4px solid #e2e8f0; border-top-color: #0f172a; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px; }
              @keyframes spin { to { transform: rotate(360deg); } }
              h2 { font-weight: 800; margin-bottom: 8px; }
              p { color: #64748b; font-weight: 500; }
            </style>
          </head>
          <body>
            <div class="spinner"></div>
            <h2>Generating PDF Quote...</h2>
            <p>Please wait while we prepare your professional quote.</p>
          </body>
        </html>
      `);
    }

    setIsGeneratingQuote(true);
    try {
      const policyId = String(selectedPortfolio?.id || '').trim();
      if (!policyId) throw new Error('Missing policy id');
      const res = await api.getQuoteDraft(policyId);
      if (res.success) {
        const quoteDraftData = asRecord(res.data);
        const googleDocUrl = String(quoteDraftData?.googleDocUrl || '');
        const localUrl = String(quoteDraftData?.localUrl || '');
        if (googleDocUrl) {
          if (newTab) newTab.location.href = googleDocUrl;
        } else if (localUrl) {
          if (newTab) newTab.location.href = localUrl;
          setToastMessage(`Google Drive Failed: ${res.error?.message || 'Unknown Error'}. Downloaded local copy instead.`);
          setShowToast(true);
        } else {
          if (newTab) newTab.close();
          setToastMessage('Quote generated but no URL returned.');
          setShowToast(true);
        }
      } else {
        if (newTab) newTab.close();
        setToastMessage('Failed to generate Google Doc quote. Please try again.');
        setShowToast(true);
      }
    } catch (error) {
      if (newTab) newTab.close();
      logger.error('Error generating quote:', error);
      setToastMessage('Error generating quote.');
      setShowToast(true);
    } finally {
      setIsGeneratingQuote(false);
    }
  };

  const handleIssueQuote = async () => {
    if (!selectedPortfolio) return;
    setIsIssuingQuote(true);
    try {
      const qr = asRecord(asRecord(selectedPortfolio)?.quoteResponse);
      const qrPrimaryOption = asRecord(qr.primaryOption);
      const quoteSentKey =
        String(qrPrimaryOption?.annualPremium ?? qrPrimaryOption?.totalPremium ?? qr?.annualPremium ?? '') +
        '|' +
        String(qr?.status ?? '');
      const policyId = String(selectedPortfolio?.id || '').trim();
      if (!policyId) throw new Error('Missing policy id');
      const res = await api.sendQuote(policyId);
      if (res.success) {
        const sentStatus = String(asRecord(res.data)?.status || '').toLowerCase();
        showSuccessToast(sentStatus === 'queued' ? 'Quote email queued for delivery.' : 'Quote email sent successfully.');
        const sentAtRaw = asRecord(res.data)?.timestamp;
        const sentAt = sentAtRaw ? new Date(String(sentAtRaw)) : new Date();
        setQuoteSentAt(sentAt);
        setQuoteSentKey(quoteSentKey);
        setSelectedPortfolio({ ...selectedPortfolio, status: 'QUOTED' });
      } else {
        // ABY-84 / ABY-87: Send-quote failures used to surface with the
        // success styling, which made it look like the email was sent
        // even when the backend returned `MISSING_EMAIL` or
        // `EMAIL_FAILED`. Mark the toast as an error and prefer the
        // backend's actionable message via `apiErrorMessage`.
        showErrorToast(`Failed to send quote: ${apiErrorMessage(res, 'Unknown error')}`);
      }
    } catch (error) {
      logger.error('Error sending quote:', error);
      showErrorToast('Error sending quote.');
    } finally {
      setIsIssuingQuote(false);
    }
  };

  const handleBindPolicy = async () => {
    const policyId = String(selectedPortfolio?.id || '').trim();
    if (!policyId) return;
    setIsBindingPolicy(true);
    try {
      const res = await bindPolicy(policyId);
      if (res.success) {
        showSuccessToast('Policy Successfully Bound!');
        const bindData = asRecord(res.data);
        const certUrl = String(bindData?.certificateUrl || asRecord(bindData?.certificate)?.url || '');
        if (certUrl) window.open(certUrl, '_blank', 'noopener,noreferrer');
        await refreshPolicyDocuments(policyId);
        const updatedRes = await api.getPolicy(policyId);
        if (updatedRes.success && updatedRes.data) setSelectedPortfolio(toPolicyRecord(updatedRes.data));
        await refreshIssueReadiness(policyId);
      } else {
        // ABY-88: Surface the canonical blocker list rather than just the
        // joined `error.message`. `apiErrorMessage` extracts the first
        // blocker from `error.blockers` / `error.details.blockers` so the
        // operator sees an actionable reason instead of "Unknown error".
        // Also force a readiness refresh so the Premium tab's blockers
        // panel updates in lock-step with the toast — when bind fails
        // the gate may have moved (e.g. PRICING_DRIFT, UW_INCOMPLETE)
        // and the previously-empty blockers panel was the source of the
        // "system lying" report.
        showErrorToast(`Failed to bind policy: ${apiErrorMessage(res, 'Unknown error')}`);
        await refreshIssueReadiness(policyId);
      }
    } catch (error) {
      logger.error('Error binding policy:', error);
      showErrorToast('Error binding policy.');
      try { await refreshIssueReadiness(policyId); } catch { /* best effort */ }
    } finally {
      setIsBindingPolicy(false);
    }
  };

  const handleBindCoverage = async () => {
    setBoundRiskTransactionId(null);
    setShowBindCoverageWorkflowModal(true);
  };

  const withTimeout = async <T,>(p: Promise<T>, ms: number, message: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        p,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const getLatestBoundInceptionRiskTxnId = async (policyId: string): Promise<string | null> => {
    try {
      const bundle = await policyCrudApiClient.getPolicyBundle(policyId);
      const history = (bundle?.success && Array.isArray(bundle?.data?.history)) ? bundle.data!.history : [];
      const inception = history.find((t: Record<string, unknown>) =>
        String(t?.transactionType || '').toUpperCase() === 'INCEPTION' && String(t?.status || '').toUpperCase() === 'BOUND'
      );
      return inception?.id ? String(inception.id) : null;
    } catch {
      return null;
    }
  };

  const refreshPremiumIfOnlyPricingIsStale = async (policyId: string): Promise<boolean> => {
    const readiness = await policyCrudApiClient.getIssueReadiness(policyId, { channel: 'bo' });
    const readinessData = asRecord(readiness?.data);
    const readinessBlockers = Array.isArray(readinessData?.blockers) ? readinessData.blockers.map((entry) => asRecord(entry)) : [];
    if (Boolean(readiness?.success && readinessData?.canIssue)) return true;
    if (!hasOnlyAutoRefreshPricingBlockers(readinessBlockers)) return false;
    const refreshed = await executeReRateAuto(policyId);
    if (!refreshed) throw new Error('Pricing could not be refreshed automatically. Please retry.');
    return true;
  };

  const ensureCoverageBound = async (policyId: string): Promise<string | null> => {
    const statusUpper = String(policyDisplayStatus(asRecord(selectedPortfolio)) || '').toUpperCase();
    const alreadyBound = statusUpper === 'BOUND' || statusUpper === 'BOUND_DRAFT_ISSUED' || statusUpper === 'ISSUED' || statusUpper === 'ACTIVE';
    if (alreadyBound) {
      const existing = await getLatestBoundInceptionRiskTxnId(policyId);
      if (existing) setBoundRiskTransactionId(existing);
      return existing;
    }

    setIsBindingCoverage(true);
    try {
      const res = await bindCoverage(policyId);
      if (!res?.success) throw new Error(res?.error?.message || 'Failed to bind coverage');
      const riskTxnId = String(res?.data?.riskTransactionId || '');
      setBoundRiskTransactionId(riskTxnId || null);
      await reloadCurrentPolicy();
      await refreshIssueReadiness(policyId);
      return riskTxnId || null;
    } finally {
      setIsBindingCoverage(false);
    }
  };

  const handleCreateDraftPolicy = async () => {
    if (!selectedPortfolio?.id) return;
    const policyId = selectedPortfolio.id;
    setIsCreatingDraft(true);
    try {
      await refreshPremiumIfOnlyPricingIsStale(policyId);
      const riskTxnId =
        boundRiskTransactionId ||
        (await ensureCoverageBound(policyId)) ||
        (await getLatestBoundInceptionRiskTxnId(policyId));
      const resp: ApiResult = await withTimeout(
        generateDraftPolicyPack(policyId, riskTxnId),
        60000,
        'Draft generation is taking too long. Please try again (or check the API logs).'
      );
      if (!resp?.success) throw new Error(apiErrorMessage(resp, 'Failed to generate draft policy documents'));
      setToastMessage('Draft policy documents generated.');
      setShowToast(true);
      setShowBindCoverageWorkflowModal(false);
      await refreshPolicyDocuments(policyId);
      await reloadCurrentPolicy();
      await refreshIssueReadiness(policyId);
    } catch (e) {
      await refreshIssueReadiness(policyId);
      setToastMessage((e as Error)?.message || 'Failed to generate draft documents');
      setShowToast(true);
      setShowBindCoverageWorkflowModal(false);
    } finally {
      setIsCreatingDraft(false);
    }
  };

  const handleIssuePolicyFinal = async () => {
    if (!selectedPortfolio?.id) return;
    const policyId = selectedPortfolio.id;
    setIsIssuingPolicyFinal(true);
    try {
      const readiness = await policyCrudApiClient.getIssueReadiness(policyId, { channel: 'bo' });
      const readinessData = asRecord(readiness?.data);
      const readinessBlockers = Array.isArray(readinessData?.blockers) ? readinessData.blockers.map((entry) => asRecord(entry)) : [];
      const readinessCanIssue = Boolean(readiness?.success && readinessData?.canIssue)
        || (hasOnlyAutoRefreshPricingBlockers(readinessBlockers) && await executeReRateAuto(policyId));
      if (!readinessCanIssue) {
        const firstBlockerMessage = String(readinessBlockers[0]?.message || '').trim();
        throw new Error(firstBlockerMessage || 'Issue readiness check failed');
      }
      await ensureCoverageBound(policyId);
      const resp: ApiResult = await withTimeout(
        issuePolicy(policyId),
        60000,
        'Issuance is taking too long. Please try again (or check the API logs).'
      );
      if (!resp?.success) throw new Error(apiErrorMessage(resp, 'Failed to issue policy'));
      const issuedRiskTransactionId = String(asRecord(resp?.data).riskTransactionId || '').trim() || null;
      setToastMessage('Policy issued. Review documents and their recorded delivery status.');
      setShowToast(true);
      setShowBindCoverageWorkflowModal(false);
      await refreshPolicyDocuments(policyId);
      if (issuedRiskTransactionId) setViewingRiskTransactionId(issuedRiskTransactionId);
      await reloadCurrentPolicy(issuedRiskTransactionId ? { riskTransactionId: issuedRiskTransactionId } : undefined);
      if (refreshPolicyVersions) await refreshPolicyVersions(policyId);
      await refreshIssueReadiness(policyId);
    } catch (e) {
      await refreshIssueReadiness(policyId);
      setToastMessage((e as Error)?.message || 'Failed to issue policy');
      setShowToast(true);
      setShowBindCoverageWorkflowModal(false);
    } finally {
      setIsIssuingPolicyFinal(false);
    }
  };

  const handleUnlockBoundMode = async () => {
    if (!selectedPortfolio?.id) return;
    const policyId = selectedPortfolio.id;
    setIsUnlockingBoundMode(true);
    try {
      const res = await unlockBoundMode(policyId);
      if (!res?.success) throw new Error(res?.error?.message || 'Failed to unlock');
      setToastMessage('Bound mode cancelled. Policy unlocked for editing.');
      setShowToast(true);
      await reloadCurrentPolicy();
      await refreshIssueReadiness(policyId);
    } catch (e) {
      setToastMessage((e as Error)?.message || 'Failed to unlock');
      setShowToast(true);
    } finally {
      setIsUnlockingBoundMode(false);
    }
  };

  const executeReRateAuto = async (policyIdToRate?: string, riskTransactionIdToRate?: string | null, quoteDataOverride?: UnknownRecord, productTypeOverride?: string): Promise<boolean> => {
    const targetId = policyIdToRate || selectedPortfolio?.id;
    if (!targetId) return false;
    try {
      clearQuoteSentIndicator();
      setIsReRatingAuto(true);
      const draftRiskTxnId =
        String(riskTransactionIdToRate || '').trim() ||
        (targetId === selectedPortfolio?.id ? String(endorsementDraftRiskTransactionId || '').trim() : '');
      if (draftRiskTxnId) {
        const resp = await rateEndorsementDraft(String(targetId), draftRiskTxnId);
        if (!resp?.success) {
          setToastMessage(resp?.error?.message || 'Failed to recalculate endorsement premium');
          setShowToast(true);
          return false;
        }
        setCoverageDirty(false);
        setCanSaveQuoteVersion(true);
        await reloadCurrentPolicy({ riskTransactionId: draftRiskTxnId });
        await refreshIssueReadiness(targetId, { riskTransactionId: draftRiskTxnId });
        if (refreshPolicyVersions) await refreshPolicyVersions(targetId);
        return true;
      }

      const quoteData: UnknownRecord | undefined = quoteDataOverride
        || (targetId === selectedPortfolio?.id ? (asRecord(selectedPortfolio).quoteData as UnknownRecord | undefined) : undefined);
      const coverageSelection = targetId === selectedPortfolio?.id ? getCoverageSelectionPayload(selectedPortfolio) : undefined;
      const productType = String(productTypeOverride || asRecord(selectedPortfolio).productType || '').trim().toUpperCase();
      const publicId = await resolvePublicAutoSessionId(targetId);
      // ABY-48: when no public session exists for this policy,
      // `resolvePublicAutoSessionId` returns the BO policy UUID as a
      // fallback. Hitting the public-session rate endpoint with that
      // value 404s and the misleading "404 page was not found" toast
      // surfaces RIGHT AFTER a successful UW save — making operators
      // think the save itself failed. Detect the fallback and skip
      // the auto re-rate cleanly. Operators can still trigger a
      // manual re-rate from the premium tab.
      if (!publicId || publicId === targetId) {
        return false;
      }
      const resp = await policyCrudApiClient.rateQuote(productType, publicId, {
        quoteData,
        ...(coverageSelection ? { coverageSelection } : {}),
      });
      if (!resp?.success) {
        setToastMessage(resp?.error?.message || 'Failed to recalculate premium');
        setShowToast(true);
        return false;
      }

      const nextQr = resp.data;
      const nextLifecycleStatus =
        String(nextQr?.status || '').toLowerCase() === 'declined'
          ? 'DECLINED'
          : String(nextQr?.status || '').toLowerCase() === 'referral'
            ? 'REFERRAL'
            : 'QUOTED';

      if (targetId === selectedPortfolio?.id) {
        setSelectedPortfolio((prev) => ({
          ...asRecord(prev),
          ...(quoteData ? { quoteData } : {}),
          quoteResponse: nextQr,
          status: nextLifecycleStatus,
        }));
        setCoverageDirty(false);
        setCanSaveQuoteVersion(true);
        await refreshIssueReadiness(targetId);
      } else {
        setToastMessage('New version created and rated successfully');
        setShowToast(true);
        navigate(`/policies/${targetId}`, { replace: true });
      }
      return true;
    } catch (e) {
      setToastMessage((e as Error)?.message || 'Failed to recalculate premium');
      setShowToast(true);
      return false;
    } finally {
      setIsReRatingAuto(false);
    }
  };

  const handleReRate = async (quoteDataOverride?: UnknownRecord) => {
    if (!selectedPortfolio?.id) return;
    const ratingIdentity = prepareRatingIdentity ? await prepareRatingIdentity() : {};
    if (prepareRatingIdentity && !ratingIdentity) return;
    const productTypeOverride = ratingIdentity?.productType;
    const statusUpper = String(policyDisplayStatus(asRecord(selectedPortfolio)) || '').toUpperCase();
    const isIssuedLifecycleLike = ['ISSUED', 'ACTIVE', 'BOUND', 'BOUND_DRAFT_ISSUED', 'ENDORSEMENT_IN_PROGRESS'].includes(statusUpper);

    // Premium recalculation on issued lifecycle must occur in an endorsement draft workspace.
    if (isIssuedLifecycleLike && !endorsementDraftRiskTransactionId) {
      try {
        const policyId = String(selectedPortfolio.id);
        const effectiveDate = new Date().toISOString().slice(0, 10);
        const draftResp = await createEndorsementDraft(policyId, {
          effectiveDate,
          reason: 'Premium recalculation',
        });
        if (!draftResp?.success) {
          setToastMessage(draftResp?.error?.message || 'Failed to create endorsement draft for recalculation');
          setShowToast(true);
          return;
        }

        const newRiskTxnId = String(asRecord(draftResp.data).riskTransactionId || '').trim();
        if (!newRiskTxnId) {
          setToastMessage('Failed to open endorsement workspace for recalculation');
          setShowToast(true);
          return;
        }

        setViewingVersionId(null);
        setViewingRiskTransactionSnapshot(buildEndorsementDraftSnapshotStub(newRiskTxnId));
        setViewingRiskTransactionId(newRiskTxnId);
        await executeReRateAuto(policyId, newRiskTxnId, undefined, productTypeOverride);
        return;
      } catch (e) {
        setToastMessage((e as Error)?.message || 'Failed to create endorsement draft for recalculation');
        setShowToast(true);
        return;
      }
    }

    await executeReRateAuto(undefined, undefined, quoteDataOverride, productTypeOverride);
  };

  const bindEndorsementDraftNow = async () => {
    if (!selectedPortfolio?.id || !endorsementDraftRiskTransactionId) return;
    try {
      setIsBindingEndorsementDraft(true);
      const resp = await bindEndorsementDraft(String(selectedPortfolio.id), String(endorsementDraftRiskTransactionId));
      if (!resp?.success) throw new Error(resp?.error?.message || 'Failed to bind endorsement');
      setToastMessage('Endorsement bound');
      setShowToast(true);
      await reloadCurrentPolicy();
      await refreshIssueReadiness(String(selectedPortfolio.id));
    } catch (e) {
      setToastMessage((e as Error)?.message || 'Failed to bind endorsement');
      setShowToast(true);
    } finally {
      setIsBindingEndorsementDraft(false);
    }
  };

  const handleBindEndorsementDraft = async () => {
    if (!selectedPortfolio?.id) return;
    if (!endorsementDraftRiskTransactionId) {
      setToastMessage('Endorsement draft is still loading. Wait a moment and try again, or reopen the draft from Premium history.');
      setShowToast(true);
      return;
    }
    setShowBindEndorsementWorkflowModal(true);
  };

  const handleCancelEndorsementDraft = async () => {
    if (!selectedPortfolio?.id || !endorsementDraftRiskTransactionId) return;
    try {
      setIsCancellingEndorsementDraft(true);
      const resp = await cancelEndorsementDraft(String(selectedPortfolio.id), String(endorsementDraftRiskTransactionId));
      if (!resp?.success) throw new Error(resp?.error?.message || 'Failed to cancel endorsement draft');
      setToastMessage('Endorsement draft cancelled');
      setShowToast(true);
      setViewingVersionId(null);
      setViewingRiskTransactionId(null);
      setViewingRiskTransactionSnapshot(null);
      setEditingScope(null);
      await loadPolicyDetails();
    } catch (e) {
      setToastMessage((e as Error)?.message || 'Failed to cancel endorsement draft');
      setShowToast(true);
    } finally {
      setIsCancellingEndorsementDraft(false);
    }
  };

  const handleIssueEndorsement = async () => {
    if (!selectedPortfolio?.id || !endorsementDraftRiskTransactionId) return;
    try {
      setIsIssuingEndorsement(true);
      const draftSnapshot = asSnapshot(
        asRecord(viewingRiskTransactionSnapshot)?.snapshotDraft
        || asRecord(viewingRiskTransactionSnapshot)?.snapshot
      );
      const workspace = asRecord(draftSnapshot.endorsementWorkspace);
      const isCancellationEndorsement = String(workspace.reasonCode || '').toUpperCase() === 'CANCELLATION';
      const resp = await issueEndorsement(
        String(selectedPortfolio.id),
        String(endorsementDraftRiskTransactionId),
        { confirmManualRefundAck: isCancellationEndorsement ? true : undefined }
      );
      if (!resp?.success) throw new Error(resp?.error?.message || 'Failed to issue endorsement');
      setToastMessage(isCancellationEndorsement ? 'Cancellation endorsement issued. Billing credit created (manual refund).' : 'Endorsement issued');
      setShowToast(true);
      setViewingRiskTransactionId(null);
      setViewingRiskTransactionSnapshot(null);
      await refreshPolicyDocuments(String(selectedPortfolio.id));
      await refreshIssueReadiness(String(selectedPortfolio.id));
      await loadPolicyDetails();
    } catch (e) {
      setToastMessage((e as Error)?.message || 'Failed to issue endorsement');
      setShowToast(true);
    } finally {
      setIsIssuingEndorsement(false);
    }
  };

  const handleIssueEndorsementFromWorkflow = async () => {
    if (!selectedPortfolio?.id || !endorsementDraftRiskTransactionId) return;
    const policyId = String(selectedPortfolio.id);
    try {
      setIsIssuingEndorsement(true);
      const draftSnapshot = asSnapshot(
        asRecord(viewingRiskTransactionSnapshot)?.snapshotDraft
        || asRecord(viewingRiskTransactionSnapshot)?.snapshot
      );
      const workspace = asRecord(draftSnapshot.endorsementWorkspace);
      const isCancellationEndorsement = String(workspace.reasonCode || '').toUpperCase() === 'CANCELLATION';
      const txStatusUpper = String(asRecord(viewingRiskTransactionSnapshot)?.status || '').toUpperCase();
      if (txStatusUpper === 'DRAFT') {
        const bindResp = await bindEndorsementDraft(policyId, String(endorsementDraftRiskTransactionId));
        if (!bindResp?.success) throw new Error(bindResp?.error?.message || 'Failed to bind endorsement');
      }
      const issueResp = await issueEndorsement(policyId, String(endorsementDraftRiskTransactionId), {
        confirmManualRefundAck: isCancellationEndorsement ? true : undefined,
      });
      if (!issueResp?.success) throw new Error(issueResp?.error?.message || 'Failed to issue endorsement');
      setToastMessage(
        isCancellationEndorsement
          ? 'Cancellation endorsement issued. Billing credit created (manual refund).'
          : 'Endorsement issued and documents generated.'
      );
      setShowToast(true);
      setShowBindEndorsementWorkflowModal(false);
      setViewingRiskTransactionId(null);
      setViewingRiskTransactionSnapshot(null);
      await refreshPolicyDocuments(policyId);
      await refreshIssueReadiness(policyId);
      await loadPolicyDetails();
    } catch (e) {
      setToastMessage((e as Error)?.message || 'Failed to issue endorsement');
      setShowToast(true);
      setShowBindEndorsementWorkflowModal(false);
    } finally {
      setIsIssuingEndorsement(false);
    }
  };

  const handleSaveQuoteVersion = async () => {
    if (!selectedPortfolio?.id) return;
    try {
      setIsSavingQuoteVersion(true);
      if (endorsementDraftRiskTransactionId) {
        const policyId = String(selectedPortfolio.id);
        const resp = await saveEndorsementVersion(policyId, {
          sourceRiskTransactionId: String(endorsementDraftRiskTransactionId),
        });
        if (!resp?.success) throw new Error(resp?.error?.message || 'Failed to save endorsement version');
        const nextRiskTxnId = String(asRecord(resp.data).riskTransactionId || '').trim();

        setViewingVersionId(null);
        setViewingRiskTransactionSnapshot(null);
        setViewingRiskTransactionId(nextRiskTxnId);
        setCanSaveQuoteVersion(false);
        setCoverageDirty(false);
        setToastMessage('Endorsement draft version saved');
        setShowToast(true);
        await reloadCurrentPolicy({ riskTransactionId: nextRiskTxnId });
        await refreshIssueReadiness(policyId, { riskTransactionId: nextRiskTxnId });
        if (refreshPolicyVersions) await refreshPolicyVersions(policyId);
        return;
      }

      const res = await policyCrudApiClient.saveQuoteHistory(String(selectedPortfolio.id));
      if (!res?.success) throw new Error(apiErrorMessage(res, 'Failed to save version'));
      setToastMessage('Version saved');
      setShowToast(true);
      setCanSaveQuoteVersion(false);
      await reloadCurrentPolicy();
      if (refreshPolicyVersions) await refreshPolicyVersions(String(selectedPortfolio.id));
    } catch (e) {
      setToastMessage((e as Error)?.message || 'Failed to save version');
      setShowToast(true);
    } finally {
      setIsSavingQuoteVersion(false);
    }
  };

  return {
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
  };
}
