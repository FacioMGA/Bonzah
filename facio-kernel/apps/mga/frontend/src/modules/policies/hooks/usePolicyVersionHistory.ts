import { useState, useEffect, useMemo, useCallback } from 'react';
import { policiesClient as api } from '../api/policiesClient';
import { policyCrudApiClient } from '../api/policyCrudApiClient';
import {
  normalizeStatusToken,
  isIssuedLifecycleStatus,
  resolveEndorsementDraftRiskTransactionId,
} from '../model/policyPageHelpers';
import { asRecord } from '@/src/shared/lib/record';
import { toPolicyRecord } from '../queries/getPolicyVM';
import { selectDisplayedPortfolio } from '../model/policyPageSelectors';
import { REGION_CONFIG } from '@/src/shared/config/region';

type UnknownRecord = Record<string, unknown>;

interface UsePolicyVersionHistoryOpts {
    selectedPortfolio: UnknownRecord | null;
}

/**
 * Manages policy version history state — versions, risk transactions,
 * snapshots, and lifecycle mode flags.
 *
 * This hook handles ONLY state orchestration, not domain rules.
 * It does NOT interpret quoteData or questionnaire fields.
 */
export function usePolicyVersionHistory({
    selectedPortfolio,
}: UsePolicyVersionHistoryOpts) {
    // --- State ---
    const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);
    const [policyVersions, setPolicyVersions] = useState<UnknownRecord[]>([]);
    const [viewingRiskTransactionId, setViewingRiskTransactionId] = useState<string | null>(null);
    const [viewingRiskTransactionSnapshot, setViewingRiskTransactionSnapshot] = useState<UnknownRecord | null>(null);

    // --- Reset on policy change ---
    useEffect(() => {
        setViewingVersionId(null);
        setViewingRiskTransactionId(null);
        setViewingRiskTransactionSnapshot(null);
        setPolicyVersions([]);
    }, [selectedPortfolio?.id]);

    // --- Load versions ---
    const refreshPolicyVersions = useCallback(async (policyId: string) => {
        if (!policyId || policyId === 'new') return;
        try {
            const v = await api.listPolicyVersions(String(policyId));
            if (v?.success) setPolicyVersions(Array.isArray(v.data) ? v.data : []);
        } catch {
            // best-effort refresh
        }
    }, []);

    useEffect(() => {
        let mounted = true;
        (async () => {
            if (!selectedPortfolio?.id || selectedPortfolio.id === 'new') return;
            try {
                const res = await api.listPolicyVersions(String(selectedPortfolio.id));
                if (!mounted) return;
                const data = (res?.success && Array.isArray(res.data)) ? res.data : [];

                // Fallback: if versions endpoint returns nothing, use bundle.history (older but proven endpoint).
                if (data.length === 0) {
                    try {
                        const bundle = await policyCrudApiClient.getPolicyBundle(String(selectedPortfolio.id));
                        const history = (bundle?.success && bundle?.data?.history) ? bundle.data.history : [];
                        const mapped = Array.isArray(history)
                            ? history.map((rt: UnknownRecord) => {
                                const st = normalizeStatusToken(rt?.status);
                                const ty = normalizeStatusToken(rt?.transactionType);
                                let parsedPricing: UnknownRecord | null = null;
                                if (st === 'BOUND' && rt?.pricingFinal) {
                                    if (typeof rt.pricingFinal === 'string') {
                                        try {
                                            const parsed = JSON.parse(rt.pricingFinal);
                                            parsedPricing = parsed && typeof parsed === 'object' ? asRecord(parsed) : null;
                                        } catch {
                                            parsedPricing = null;
                                        }
                                    } else if (typeof rt.pricingFinal === 'object') {
                                        parsedPricing = asRecord(rt.pricingFinal);
                                    }
                                }
                                const prem = parsedPricing?.premium ?? null;
                                return {
                                    riskTransactionId: String(rt?.id || ''),
                                    transactionNumber: rt?.transactionNumber,
                                    transactionType: ty,
                                    status: st,
                                    effectiveDate: rt?.effectiveDate,
                                    expiryDate: rt?.expiryDate,
                                    premiumSnapshot: prem,
                                    currency: parsedPricing?.currency || REGION_CONFIG.defaultCurrency,
                                };
                            })
                            : [];
                        setPolicyVersions(mapped.filter((v: UnknownRecord) => Boolean(v?.riskTransactionId)));
                    } catch {
                        setPolicyVersions([]);
                    }
                    return;
                }

                setPolicyVersions(data);
            } catch {
                if (mounted) setPolicyVersions([]);
            }
        })();
        return () => { mounted = false; };
    }, [selectedPortfolio?.id]);

    // --- Derived values ---
    const latestIssuedRiskTransactionId = useMemo(() => {
        const latestIssued = (policyVersions || []).find((v: UnknownRecord) =>
            normalizeStatusToken(v?.status) === 'BOUND' &&
            ['INCEPTION', 'ENDORSEMENT', 'RENEWAL'].includes(normalizeStatusToken(v?.transactionType))
        );
        return latestIssued?.riskTransactionId ? String(latestIssued.riskTransactionId) : null;
    }, [policyVersions]);

    const selectedPortfolioStatusNormalized = normalizeStatusToken(asRecord(selectedPortfolio)?.status);

    // Default: when policy is issued, view the latest issued RiskTransaction version
    useEffect(() => {
        if (!selectedPortfolio?.id || selectedPortfolio.id === 'new') return;
        const isIssued = isIssuedLifecycleStatus(selectedPortfolioStatusNormalized);
        if (!isIssued) return;
        if (viewingRiskTransactionId) return;
        if (latestIssuedRiskTransactionId) setViewingRiskTransactionId(String(latestIssuedRiskTransactionId));
    }, [latestIssuedRiskTransactionId, selectedPortfolio?.id, selectedPortfolioStatusNormalized, viewingRiskTransactionId]);

    // Load selected RiskTransaction snapshot when switching versions
    useEffect(() => {
        let mounted = true;
        (async () => {
            if (!selectedPortfolio?.id || !viewingRiskTransactionId) return;
            try {
                const res = await api.getPolicyVersionSnapshot(String(selectedPortfolio.id), String(viewingRiskTransactionId));
                if (!mounted) return;
                if (res?.success && res.data) setViewingRiskTransactionSnapshot(asRecord(res.data));
                else setViewingRiskTransactionSnapshot(null);
            } catch {
                if (mounted) setViewingRiskTransactionSnapshot(null);
            }
        })();
        return () => { mounted = false; };
    }, [selectedPortfolio?.id, viewingRiskTransactionId]);

    const endorsementDraftRiskTransactionId = useMemo(
        () =>
            resolveEndorsementDraftRiskTransactionId({
                viewingRiskTransactionId,
                viewingRiskTransactionSnapshot,
                policyVersions,
            }),
        [viewingRiskTransactionId, viewingRiskTransactionSnapshot, policyVersions],
    );

    const isIssuedLifecycle = useMemo(() => {
        return isIssuedLifecycleStatus(asRecord(selectedPortfolio)?.status);
    }, [selectedPortfolio]);

    const isIssuedRecordMode = useMemo(() => {
        return isIssuedLifecycle && !endorsementDraftRiskTransactionId;
    }, [isIssuedLifecycle, endorsementDraftRiskTransactionId]);

    const billingRiskTransactionId = useMemo(() => {
        return String(viewingRiskTransactionId || latestIssuedRiskTransactionId || '').trim() || null;
    }, [viewingRiskTransactionId, latestIssuedRiskTransactionId]);

    const displayedPortfolio = useMemo(() => {
        return selectDisplayedPortfolio({
            selectedPortfolio,
            viewingRiskTransactionId,
            viewingRiskTransactionSnapshot,
            viewingVersionId,
            toPolicyRecord,
        });
    }, [selectedPortfolio, viewingRiskTransactionId, viewingRiskTransactionSnapshot, viewingVersionId]);

    return {
        // State
        viewingVersionId,
        setViewingVersionId,
        policyVersions,
        setPolicyVersions,
        viewingRiskTransactionId,
        setViewingRiskTransactionId,
        viewingRiskTransactionSnapshot,
        setViewingRiskTransactionSnapshot,
        // Derived
        displayedPortfolio,
        latestIssuedRiskTransactionId,
        billingRiskTransactionId,
        endorsementDraftRiskTransactionId,
        isIssuedLifecycle,
        isIssuedRecordMode,
        // Actions
        refreshPolicyVersions,
    };
}
