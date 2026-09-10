/**
 * usePolicyDetailViewController — Domain logic for the policy workspace header, status badge, and cancellation.
 *
 * Owns:
 *   - Cancellation request derivation (status, chip class, actions)
 *   - Cancellation endorsement processing and rejection
 *   - Header derivation (title, policyholder name, coverage, status)
 *   - Edit-mode URL param handling
 *   - Tabs container horizontal scroll
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { policiesClient as api } from '../api/policiesClient';
import { formatCompanyName, formatDateUI, formatMoneyUI } from '@/src/shared/lib/format';
import type { PolicyRecord, UnknownRecordSetter } from '../model/policy';
import { policyDisplayStatus } from '../model/policyStateFlag';
import { humanizePolicyStatus } from '../model/policyDisplayLabels';
import { asRecord } from '@/src/shared/lib/record';
import { ProductRegistry, readPath, buildRiskIdentityFromManifest } from '@/src/shared/lib/products';
import type { EditingScope } from '../detail/PolicyWorkspaceContext';

// ── Helper utilities ──────────────────────────────────────────────

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

function toDisplayText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (typeof value === 'object') {
        const raw = asRecord(value);
        const candidate = raw.label ?? raw.value ?? raw.name ?? raw.title ?? '';
        if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate).trim();
    }
    return '';
}

// ── Exports ───────────────────────────────────────────────────────

export { asSnapshot, toDisplayText, formatDateUI, formatMoneyUI, formatCompanyName, policyDisplayStatus };

// ── Controller Types ──────────────────────────────────────────────

type Location = { search?: string; pathname: string; hash?: string };
type NavigateFn = (
    to: string | { pathname: string; search?: string; hash?: string },
    options?: { replace?: boolean; preventScrollReset?: boolean },
) => void;

type CancellationDeps = {
    selectedPortfolio: PolicyRecord | null;
    viewingRiskTransactionSnapshot: Record<string, unknown> | null;
    endorsementDraftRiskTransactionId?: string | null;
    questionnaireLastSentAt?: string | Date | null;
    qStatus?: string;
    getQuoteOrigin: (portfolio: unknown) => string;
    // Setters from parent
    setIsApprovingCancellation: (v: boolean) => void;
    setViewingVersionId: (v: string | null) => void;
    setViewingRiskTransactionSnapshot: UnknownRecordSetter;
    setViewingRiskTransactionId: (v: string | null) => void;
    setToastMessage: (v: string) => void;
    setShowToast: (v: boolean) => void;
    loadPolicyDetails: () => Promise<void>;
    loadPolicies: () => Promise<void>;
    setActiveTab: (tab: string) => void;
    navigate: NavigateFn;
    location: Location;
    editingScope: EditingScope;
    setEditingScope: (scope: EditingScope) => void;
    isApprovingCancellation: boolean;
};

// ── Controller ────────────────────────────────────────────────────

export function usePolicyDetailViewController(deps: CancellationDeps) {
    const {
        selectedPortfolio,
        viewingRiskTransactionSnapshot,
        endorsementDraftRiskTransactionId,
        questionnaireLastSentAt,
        qStatus,
        getQuoteOrigin,
        setIsApprovingCancellation,
        setViewingVersionId,
        setViewingRiskTransactionSnapshot,
        setViewingRiskTransactionId,
        setToastMessage,
        setShowToast,
        loadPolicyDetails,
        loadPolicies,
        setActiveTab: _setActiveTab,
        navigate,
        location,
        editingScope: _editingScope,
        setEditingScope,
        isApprovingCancellation,
    } = deps;
    void _editingScope; // consumed only by the URL-param effect; suppress unused-var lint

    // ── Local state ─────────────────────────────────────────────
    const tabsContainerRef = useRef<HTMLDivElement>(null);
    const [showRejectCancellationModal, setShowRejectCancellationModal] = useState(false);
    const [rejectCancellationReason, setRejectCancellationReason] = useState('');

    // ── Effects ─────────────────────────────────────────────────

    // Horizontal scroll on tab bar
    useEffect(() => {
        const handleTabsWheel = (e: WheelEvent) => {
            if (!tabsContainerRef.current) return;
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
            e.preventDefault();
            tabsContainerRef.current.scrollLeft += e.deltaY;
        };
        const container = tabsContainerRef.current;
        if (container) container.addEventListener('wheel', handleTabsWheel, { passive: false });
        return () => {
            if (container) container.removeEventListener('wheel', handleTabsWheel);
        };
    }, []);

    // URL-param edit handler — ?edit=1 means "edit the tab identified by the current hash".
    // Consumed once, then cleaned from the URL to prevent accidental re-entry on future
    // hash/search changes.  editingScope intentionally NOT in deps: we only react to URL
    // changes, never to internal scope transitions.
    useEffect(() => {
        const params = new URLSearchParams(location?.search || '');
        if (params.get('edit') !== '1') return;

        const hash = (location.hash || '').replace(/^#/, '').trim();
        const hashToScope: Record<string, EditingScope> = {
            'policy-holder': 'policyHolder',
            'policyholder':  'policyHolder',
            'underwriting':  'underwriting',
            'coverage':      'coverage',
            'premium':       'premium',
        };
        setEditingScope(hashToScope[hash] ?? 'policyHolder');

        // Strip ?edit=1 so future hash changes don't accidentally re-enter edit mode.
        const next = new URLSearchParams(location.search);
        next.delete('edit');
        const nextSearch = next.toString();
        navigate(
            { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '', hash: location.hash },
            { replace: true },
        );
    }, [location.hash, location.pathname, location.search, navigate, setEditingScope]);

    // ── Cancellation request derivation ─────────────────────────

    const cancellation = useMemo(() => {
        const policySnapshot = asSnapshot(
            asRecord(selectedPortfolio)?.stateCurrent
                ? asRecord(asRecord(selectedPortfolio).stateCurrent).snapshot
                : null,
        );
        const draftSnapshot = asSnapshot(
            asRecord(viewingRiskTransactionSnapshot).snapshotDraft ||
            asRecord(viewingRiskTransactionSnapshot).snapshot,
        );
        const endorsementWorkspace = asRecord(draftSnapshot.endorsementWorkspace);
        const cancellationRequest = asRecord(
            asRecord(selectedPortfolio)?.cancellationRequest || policySnapshot.cancellationRequest,
        );
        const requestedAt = String(cancellationRequest.requestedAt || '').trim();
        const requestedBy = String(cancellationRequest.requestedBy || '').trim() || 'Policyholder';
        const reason = String(cancellationRequest.reason || '').trim() || '—';
        const requestedEffectiveDate = String(cancellationRequest.requestedEffectiveDate || '').trim();
        const statusRaw = String(cancellationRequest.status || '').trim().toUpperCase();
        const policyStatusUpper = String(policyDisplayStatus(asRecord(selectedPortfolio)) || '').toUpperCase();
        const hasRequest =
            Boolean(statusRaw) || Boolean(requestedAt) || Boolean(requestedEffectiveDate) || reason !== '—';

        const rowStatus = (() => {
            if (policyStatusUpper === 'CANCELLED') return 'CANCELLED';
            if (policyStatusUpper === 'CANCELLATION_REQUESTED' && statusRaw === 'PROCESSING') return 'PROCESSING';
            if (policyStatusUpper === 'CANCELLATION_REQUESTED' && !statusRaw) return 'RECEIVED';
            if (['RECEIVED', 'PROCESSING', 'REJECTED', 'CANCELLED'].includes(statusRaw)) return statusRaw;
            return statusRaw || 'RECEIVED';
        })();

        const chipClass = (() => {
            if (rowStatus === 'PROCESSING') return 'bg-blue-50 text-blue-700 border-blue-200';
            if (rowStatus === 'REJECTED') return 'bg-slate-50 text-slate-700 border-slate-200';
            if (rowStatus === 'CANCELLED') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
            return 'bg-amber-50 text-amber-700 border-amber-200';
        })();

        const canHandle = hasRequest && !['REJECTED', 'CANCELLED'].includes(rowStatus);
        const endorsementInProgress =
            Boolean(endorsementDraftRiskTransactionId) &&
            String(endorsementWorkspace.reasonCode || '').trim().toUpperCase() === 'CANCELLATION';

        return {
            policyStatusUpper,
            hasRequest,
            requestedAt,
            requestedBy,
            reason,
            requestedEffectiveDate,
            rowStatus,
            chipClass,
            canHandle,
            endorsementInProgress,
        };
    }, [selectedPortfolio, viewingRiskTransactionSnapshot, endorsementDraftRiskTransactionId]);

    // ── Header derivation ───────────────────────────────────────

    const header = useMemo(() => {
        const selectedPortfolioRecord = asRecord(selectedPortfolio);
        const productType = String(selectedPortfolioRecord.productType || '');
        const manifest = ProductRegistry.get(productType);
        const source = { ...asRecord(selectedPortfolioRecord.quoteData), ...asRecord(selectedPortfolioRecord.vehicleInfo) };
        const placeholderTitle = 'New Submission';

        // Read policyholder name from the canonical
        // `quoteData.proposer.{firstName,lastName}` shape.
        const policyholderName = (() => {
            const qdRecord = asRecord(asRecord(selectedPortfolio).quoteData);
            const proposer = asRecord(qdRecord.proposer);
            const fn = toDisplayText(proposer.firstName);
            const ln = toDisplayText(proposer.lastName);
            const full = [fn, ln].filter(Boolean).join(' ').trim();
            return formatCompanyName(full || toDisplayText(selectedPortfolio?.name) || '—');
        })();

        let insuredTitle: string = placeholderTitle;
        let coverageType: string = '';
        if (manifest) {
            const identity = buildRiskIdentityFromManifest(manifest, source);
            const trimmed = (identity.primary || '').trim();
            // ABY-86 (cont.): The previous gate only set `insuredTitle`
            // when the manifest produced a non-default risk identity
            // (e.g. a vehicle plate). For products / states where the
            // risk identity is the customer (home pre-property entry,
            // every product before the customer's specific risk has
            // been captured), the gate left `insuredTitle` as
            // "New Submission" even after the policyholder was saved.
            // Now: prefer the manifest's risk identity when meaningful,
            // otherwise fall back to the policyholder name so the page
            // header reflects who the submission is for as soon as we
            // know it.
            if (trimmed && trimmed !== (manifest.displayName || '')) {
                insuredTitle = trimmed;
            } else if (policyholderName && policyholderName !== '—') {
                insuredTitle = policyholderName;
            }
            // Coverage comes from the manifest's coverage list column primary paths
            const coverPrimary = manifest.listColumns.coverage.primaryPaths
                .map((p) => readPath(source, p))
                .find((v) => typeof v === 'string' && v.trim().length > 0);
            coverageType = typeof coverPrimary === 'string' ? coverPrimary : '';
        } else if (policyholderName && policyholderName !== '—') {
            insuredTitle = policyholderName;
        }

        const businessId = String(selectedPortfolio?.policyNumber || '—');

        return { insuredTitle, coverageType, policyholderName, businessId };
    }, [selectedPortfolio]);

    // ── Status badge derivation ─────────────────────────────────

    const statusBadge = useMemo(() => {
        const rawStatus = String(policyDisplayStatus(asRecord(selectedPortfolio)) || 'DRAFT');
        const statusKey = rawStatus.toUpperCase().replace(/\s+/g, '_');
        const label = humanizePolicyStatus(statusKey) || 'Draft';

        const quoteOrigin = getQuoteOrigin(selectedPortfolio);
        const isSelfOnboardingFlow = quoteOrigin === 'customer';
        const hasUwInvite =
            Boolean(asRecord(asRecord(selectedPortfolio).customerFlow).inviteSentAt) ||
            Boolean(questionnaireLastSentAt);
        const hasQuestionnaireInvite = !isSelfOnboardingFlow && hasUwInvite;
        const questionnaireSubstatus = hasQuestionnaireInvite
            ? (qStatus === 'In Process' ? 'Questionnaire in progress' : 'Questionnaire sent')
            : null;

        const complianceState = String(asRecord(selectedPortfolio).complianceState || 'PASS').toUpperCase();
        const complianceReasons = Array.isArray(asRecord(selectedPortfolio).complianceReasons)
            ? (asRecord(selectedPortfolio).complianceReasons as unknown[]).map((v) => String(v || '')).filter(Boolean)
            : [];
        const complianceDotClass =
            complianceState === 'FAIL' ? 'bg-rose-500' : complianceState === 'WARN' ? 'bg-amber-500' : 'bg-emerald-500';
        const complianceTitle = complianceReasons.length
            ? `Compliance: ${complianceState} - ${complianceReasons.join(', ')}`
            : `Compliance: ${complianceState}`;

        const statusClasses =
            ['ACTIVE', 'BOUND', 'BOUND_DRAFT_ISSUED', 'QUOTED', 'AWAITING_PAYMENT'].includes(statusKey)
                ? 'bg-brand-primary/10 text-brand-primary'
                : ['ISSUED'].includes(statusKey)
                    ? 'bg-sky-100/70 text-sky-900'
                    : ['EXPIRED', 'CANCELLED', 'CANCELED', 'DECLINED'].includes(statusKey)
                        ? 'bg-rose-100/70 text-rose-900'
                        : 'bg-amber-100/70 text-amber-900';

        const premiumDisplay = (() => {
            const qr = asRecord(asRecord(selectedPortfolio).quoteResponse);
            const primaryOption = asRecord(qr.primaryOption);
            const cost = asRecord(primaryOption.costDetails);
            const currencyRaw = String(qr.currency || 'EUR').toUpperCase();
            const currency = (currencyRaw === 'USD' || currencyRaw === 'GBP' || currencyRaw === 'EUR') ? currencyRaw : 'EUR';
            const total = Number(cost.totalPremium ?? primaryOption.annualPremium ?? 0);
            return total > 0 ? formatMoneyUI(total, currency) : null;
        })();

        return {
            statusKey,
            label,
            statusClasses,
            questionnaireSubstatus,
            complianceDotClass,
            complianceTitle,
            premiumDisplay,
            isSelfOnboardingFlow,
            hasUwInvite,
        };
    }, [selectedPortfolio, questionnaireLastSentAt, qStatus, getQuoteOrigin]);

    // ── Cancellation actions ────────────────────────────────────

    const processCancellationRequest = useCallback(async () => {
        if (!selectedPortfolio?.id) return;
        try {
            setIsApprovingCancellation(true);
            const effectiveDate = cancellation.requestedEffectiveDate || new Date().toISOString().slice(0, 10);
            const reason = cancellation.reason === '—'
                ? 'Cancellation requested by policyholder'
                : `Cancellation requested: ${cancellation.reason}`;
            const resp = await api.createEndorsementDraft(String(selectedPortfolio.id), {
                effectiveDate,
                reason,
                reasonCode: 'CANCELLATION',
            });
            if (!resp?.success) throw new Error(resp?.error?.message || 'Failed to process cancellation request');
            const riskTransactionId = String(asRecord(resp.data).riskTransactionId || '').trim();
            if (!riskTransactionId) throw new Error('Cancellation endorsement was created without a draft id');
            await api.rateEndorsementDraft(String(selectedPortfolio.id), riskTransactionId);
            await loadPolicyDetails();
            await loadPolicies();
            setViewingVersionId(null);
            setViewingRiskTransactionSnapshot(null);
            setViewingRiskTransactionId(riskTransactionId);
            try {
                const snap = await api.getPolicyVersionSnapshot(String(selectedPortfolio.id), String(riskTransactionId));
                if (snap?.success && snap.data) setViewingRiskTransactionSnapshot(snap.data as Record<string, unknown>);
            } catch {
                // best effort
            }
            _setActiveTab('Premium');
            navigate({ pathname: location.pathname, search: location.search, hash: '#premium' });
            setToastMessage('Cancellation endorsement created. Review and issue in Premium.');
            setShowToast(true);
        } catch (e) {
            alert((e as Error).message || 'Failed to process cancellation request');
        } finally {
            setIsApprovingCancellation(false);
        }
    }, [
        selectedPortfolio, cancellation.requestedEffectiveDate, cancellation.reason,
        setIsApprovingCancellation, loadPolicyDetails, loadPolicies,
        setViewingVersionId, setViewingRiskTransactionSnapshot, setViewingRiskTransactionId,
        _setActiveTab, navigate, location, setToastMessage, setShowToast,
    ]);

    const rejectCancellationRequest = useCallback(async () => {
        if (!selectedPortfolio?.id) return;
        try {
            setIsApprovingCancellation(true);
            const reason = rejectCancellationReason.trim();
            const resp = await api.rejectCancellation(String(selectedPortfolio.id), { reason: reason || undefined });
            if (!resp?.success) throw new Error(resp?.error?.message || 'Failed to reject cancellation');
            setToastMessage('Cancellation request rejected.');
            setShowToast(true);
            setShowRejectCancellationModal(false);
            setRejectCancellationReason('');
            await loadPolicyDetails();
            await loadPolicies();
        } catch (e) {
            alert((e as Error).message || 'Failed to reject cancellation');
        } finally {
            setIsApprovingCancellation(false);
        }
    }, [
        selectedPortfolio, rejectCancellationReason,
        setIsApprovingCancellation, setToastMessage, setShowToast, loadPolicyDetails, loadPolicies,
    ]);

    return {
        tabsContainerRef,
        showRejectCancellationModal,
        setShowRejectCancellationModal,
        rejectCancellationReason,
        setRejectCancellationReason,
        cancellation,
        header,
        statusBadge,
        processCancellationRequest,
        rejectCancellationRequest,
        isApprovingCancellation,
    };
}
