import { useEffect, useRef, useState } from 'react';
import type { QuoteData, QuoteResponse } from '../../types';
import { questionnaireToRating } from '../../questionnaireProjection';
import {
  generateStep4QuoteDocuments,
  getCachedStep4ExtrasPricing,
  loadStep4ExtrasPricing,
  loadStep4Recommendations,
  postStep4RecommendationSelected,
  postStep4RecommendationsDisplayed,
  rateStep4BundleSelection,
  sendStep4QuoteEmail,
  type ExtrasPricingResult,
  type RecommendationItem,
  type RecsPayload,
  verifyUserSession,
} from './step4QuoteApi';
import { isBreakdownCoverIncluded, parseExcess, type BundleSelection } from './step4QuoteDomain';

type UseStep4QuoteControllerArgs = {
  policyId: string;
  quoteStatus: string | undefined;
  quoteReference: string;
  quote: QuoteResponse | null;
  data: QuoteData;
  isComprehensiveCover: boolean;
  currentHasNcbFromQuote: boolean;
  currentHasVipFromQuote: boolean;
  currentHasRoadsideFromQuote: boolean;
  onProceedToPayment: () => void;
  onRequestCall: () => Promise<void>;
  onRatedQuote: (raw: unknown) => void;
};

export function useStep4QuoteController(args: UseStep4QuoteControllerArgs) {
  const normalizedQuoteStatus = String(args.quoteStatus || '').trim().toLowerCase();
  const [recs, setRecs] = useState<RecsPayload | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [initialRecsDone, setInitialRecsDone] = useState(false);
  const [initialExtrasDone, setInitialExtrasDone] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showVerifyCode, setShowVerifyCode] = useState(false);
  const [sendingQuoteEmail, setSendingQuoteEmail] = useState(false);
  const [emailQuoteStatus, setEmailQuoteStatus] = useState<{ kind: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [requestingCallback, setRequestingCallback] = useState(false);
  const [callbackRequested, setCallbackRequested] = useState(false);
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [applyingBundleId, setApplyingBundleId] = useState<string | null>(null);
  const recsLoadedKeyRef = useRef<string | null>(null);
  const extrasLoadedKeyRef = useRef<string | null>(null);
  const [extrasPricing, setExtrasPricing] = useState<{
    loading: boolean;
    baseAnnual: number | null;
    vipAnnual: number | null;
    ncbAnnual: number | null;
  }>({
    loading: false,
    baseAnnual: null,
    vipAnnual: null,
    ncbAnnual: null,
  });

  useEffect(() => {
    if (normalizedQuoteStatus !== 'quoted') {
      setInitialRecsDone(true);
      setInitialExtrasDone(true);
      return;
    }
    setInitialRecsDone(false);
    setInitialExtrasDone(false);
  }, [args.policyId, args.quoteReference, normalizedQuoteStatus]);

  useEffect(() => {
    if (!args.policyId) return;
    if (normalizedQuoteStatus !== 'quoted') return;

    let cancelled = false;
    (async () => {
      try {
        const key = `${args.policyId}:${args.quoteReference}`;
        if (recsLoadedKeyRef.current === key) {
          setInitialRecsDone(true);
          return;
        }
        setRecsLoading(true);
        setRecsError(null);
        const payload = await loadStep4Recommendations({ key, policyId: args.policyId });
        if (cancelled) return;
        setRecs(payload);
        recsLoadedKeyRef.current = key;
        const shown = Array.isArray(payload?.recommendations)
          ? (payload.recommendations as RecommendationItem[]).map((item) => String(item?.bundleId || '')).filter(Boolean)
          : [];
        if (shown.length) {
          void postStep4RecommendationsDisplayed({
            policyId: args.policyId,
            quoteReference: args.quoteReference,
            artifactVersion: payload?.artifactVersion,
            modelKey: payload?.modelKey,
            shownBundleIds: shown,
          });
        }
      } catch (error) {
        if (!cancelled) setRecsError((error as Error)?.message || 'Failed to load recommendations');
      } finally {
        if (!cancelled) {
          setRecsLoading(false);
          setInitialRecsDone(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [args.policyId, args.quoteReference, normalizedQuoteStatus]);

  useEffect(() => {
    if (!args.policyId) return;
    if (normalizedQuoteStatus !== 'quoted') return;

    let cancelled = false;
    const baseExcess =
      Number(args.quote?.primaryOption?.voluntaryExcess || 0) ||
      Number(args.quote?.primaryOption?.totalExcess || 0) ||
      parseExcess(args.data.requiredExcess);
    const baseAnnual = Number(args.quote?.primaryOption?.annualPremium ?? 0) || null;
    const cacheKey = `${args.policyId}:${args.quoteReference}:${baseExcess}:${args.currentHasNcbFromQuote ? 1 : 0}:${args.currentHasVipFromQuote ? 1 : 0}`;
    if (extrasLoadedKeyRef.current === cacheKey) {
      setInitialExtrasDone(true);
      return;
    }

    const cached = getCachedStep4ExtrasPricing(cacheKey);
    if (cached) {
      setExtrasPricing({ loading: false, ...cached });
      extrasLoadedKeyRef.current = cacheKey;
      setInitialExtrasDone(true);
      return;
    }

    (async () => {
      setExtrasPricing({ loading: true, baseAnnual, vipAnnual: null, ncbAnnual: null });
      const result: ExtrasPricingResult = await loadStep4ExtrasPricing({
        cacheKey,
        policyId: args.policyId,
        data: args.data,
        baseExcess,
        baseAnnual,
        currentHasNcbFromQuote: args.currentHasNcbFromQuote,
        currentHasVipFromQuote: args.currentHasVipFromQuote,
        currentHasRoadsideFromQuote: args.currentHasRoadsideFromQuote,
        isComprehensiveCover: args.isComprehensiveCover,
      });
      if (cancelled) return;
      setExtrasPricing({ loading: false, ...result });
      extrasLoadedKeyRef.current = cacheKey;
      setInitialExtrasDone(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    args.currentHasNcbFromQuote,
    args.currentHasRoadsideFromQuote,
    args.currentHasVipFromQuote,
    args.data,
    args.isComprehensiveCover,
    args.policyId,
    args.quote,
    args.quote?.primaryOption?.annualPremium,
    args.quote?.primaryOption?.voluntaryExcess,
    args.quote?.primaryOption?.totalExcess,
    args.quote?.reference,
    args.quote?.status,
    args.quoteReference,
    normalizedQuoteStatus,
  ]);

  useEffect(() => {
    if (!emailQuoteStatus) return;
    const timeout = window.setTimeout(() => setEmailQuoteStatus(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [emailQuoteStatus]);

  const requestCallback = async () => {
    if (requestingCallback || callbackRequested) return;
    setRequestingCallback(true);
    setCallbackError(null);
    try {
      await args.onRequestCall();
      setCallbackRequested(true);
    } catch (error) {
      setCallbackError((error as Error)?.message || 'Could not request callback. Please try again.');
    } finally {
      setRequestingCallback(false);
    }
  };

  const proceedToPayment = () => {
    args.onProceedToPayment();
  };

  const downloadQuotePdf = async () => {
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    setDownloading(true);
    try {
      const generated = await generateStep4QuoteDocuments({ policyId: args.policyId });
      if (!generated.success) throw new Error(generated.message || 'Error');
      const docs = generated.documents || [];
      const quoteDoc = docs.find((doc) => String(doc?.type || '').includes('QUOTE')) || docs[0];
      const storageUri = String(quoteDoc?.storageUri || '').trim();
      const url = quoteDoc?.publicUrl || (/^https?:\/\//i.test(storageUri) ? storageUri : '');
      if (!url) throw new Error('Quote PDF URL is missing.');
      if (popup) popup.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      if (popup) popup.close();
      alert('Could not generate PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const sendQuoteEmail = async (options: { verifiedEmail?: string; quoteEmailProof?: string; authToken?: string }) => {
    if (sendingQuoteEmail) return;
    setSendingQuoteEmail(true);
    setEmailQuoteStatus({ kind: 'info', message: 'Sending quote email...' });
    try {
      const result = await sendStep4QuoteEmail({
        policyId: args.policyId,
        verifiedEmail: options.verifiedEmail,
        quoteEmailProof: options.quoteEmailProof,
        authToken: options.authToken,
      });
      if (!result.success) throw new Error(result.message);
      setEmailQuoteStatus({ kind: 'success', message: 'Quote email sent with PDF attachment.' });
    } catch (error) {
      const message = (error as Error)?.message || 'Quote email could not be sent. Please try again.';
      setEmailQuoteStatus({ kind: 'error', message });
      throw error;
    } finally {
      setSendingQuoteEmail(false);
    }
  };

  const triggerQuoteEmail = async () => {
    setEmailQuoteStatus(null);
    if (sendingQuoteEmail) return;
    const authToken = String(localStorage.getItem('auth_token') || '').trim();
    if (!authToken) {
      setShowVerifyCode(true);
      return;
    }
    const hasValidSession = await verifyUserSession(authToken);
    if (!hasValidSession) {
      setShowVerifyCode(true);
      return;
    }
    try {
      await sendQuoteEmail({ authToken });
    } catch {
      // status already set in sendQuoteEmail
    }
  };

  const sendVerifiedQuoteEmail = async (payload: { data?: Record<string, unknown> }) => {
    const verifiedEmail = String(
      (payload.data && typeof payload.data === 'object' ? payload.data.email : '') ||
      args.data?.proposer?.email ||
      ''
    ).trim().toLowerCase();
    const quoteEmailProof = String(
      payload.data && typeof payload.data === 'object' ? payload.data.quoteEmailProof : ''
    ).trim();
    if (!verifiedEmail || !quoteEmailProof) {
      throw new Error('Verification failed. Please request a new code and try again.');
    }
    await sendQuoteEmail({ verifiedEmail, quoteEmailProof });
    setShowVerifyCode(false);
  };

  const applyBundleSelection = async (params: {
    bundleId: string;
    selection: BundleSelection;
    rec?: RecommendationItem;
    currentBundle: BundleSelection;
    setCurrentBundle: (next: BundleSelection) => void;
    minAllowedExcess: number;
  }) => {
    const bundleId = String(params.bundleId || '').trim();
    const nextSelection = params.selection;
    if (!bundleId || !nextSelection?.excess) return;
    if (Number(nextSelection.excess) < params.minAllowedExcess) return;

    const previousSelection = params.currentBundle;
    setApplyingBundleId(bundleId || 'applying');
    params.setCurrentBundle(nextSelection);

    void postStep4RecommendationSelected({
      policyId: args.policyId,
      quoteRef: args.quote?.reference,
      artifactVersion: recs?.artifactVersion,
      modelKey: recs?.modelKey,
      shownBundleIds: Array.isArray(recs?.recommendations)
        ? recs.recommendations.map((item) => String(item?.bundleId || '')).filter(Boolean)
        : undefined,
      selectedBundleId: bundleId,
    });

    const selectedOptions = {
      'CV 172': Boolean(nextSelection.claimProtection),
      'COV-ROADSIDE': isBreakdownCoverIncluded({
        isComprehensiveCover: args.isComprehensiveCover,
        vipRoadsideSelected: Boolean(nextSelection.vipRoadside),
        alreadyOnQuote: Boolean(args.currentHasRoadsideFromQuote),
      }),
      'COV-ROADSIDE-VIP': Boolean(nextSelection.vipRoadside),
    };

    try {
      const rated = await rateStep4BundleSelection({
        policyId: args.policyId,
        quoteData: questionnaireToRating(args.data).quoteData,
        overrideExcess: nextSelection.excess,
        selectedOptions,
      });
      if (!rated.success) throw new Error(rated.message);
      args.onRatedQuote(rated.data);
    } catch (error) {
      params.setCurrentBundle(previousSelection);
      alert((error as Error)?.message || 'Could not apply this option. Please try again.');
    } finally {
      setApplyingBundleId(null);
    }
  };

  return {
    recommendations: {
      payload: recs,
      loading: recsLoading,
      error: recsError,
      initialDone: initialRecsDone,
    },
    extras: {
      pricing: extrasPricing,
      initialDone: initialExtrasDone,
    },
    communications: {
      downloading,
      showVerifyCode,
      setShowVerifyCode,
      sendingQuoteEmail,
      emailQuoteStatus,
      setEmailQuoteStatus,
      requestingCallback,
      callbackRequested,
      callbackError,
    },
    actions: {
      proceedToPayment,
      requestCallback,
      downloadQuotePdf,
      triggerQuoteEmail,
      sendVerifiedQuoteEmail,
      applyBundleSelection,
      parseExcess,
    },
    selection: {
      applyingBundleId,
      setApplyingBundleId,
    },
  };
}
