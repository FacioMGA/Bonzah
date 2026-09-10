/**
 * Client Dashboard Controller — CHAMPS Application Layer
 *
 * Owns:
 *   - Bootstrap data loading (with in-flight deduplication)
 *   - Lazy document and feed loading
 *   - Route-aware policy selection
 *   - All state management
 *
 * Consumes ONLY VM types from the contract layer.
 * Never exposes raw DTOs downstream.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { clientPortalClient as api } from '@/src/surfaces/client/api/clientPortalClient';
import {
    mapPolicyToVM,
    mapBootstrapToVM,
    mapDocumentsToVM,
    mapFeedEventsToVM,
} from '../api/mappers/dashboardMapper';
import {
    sortPoliciesByRecency,
    partitionPolicies,
    getTimedGreeting,
    resolveGreetingName,
    DASHBOARD_DISPLAY_CONFIG,
} from '../model/clientDashboardModel';
import type {
    DashboardPolicyVM,
    ClaimVM,
    DocumentVM,
    ActivityItemVM,
} from '../types/dashboard.contract';
import type { DocumentDTO, FeedEventDTO, PolicyDTO, ClaimDTO } from '../types/dashboard.contract';
import { isClientVisiblePolicy } from '../api/mappers/dashboardMapper';

function fallbackPolicyVm(policy: PolicyDTO): DashboardPolicyVM {
    return {
        key: String(policy.policyId || policy.id || ''),
        productType: String(policy.productType || '').trim().toUpperCase(),
        productLabel: 'Insurance',
        vehicleTitle: 'Insurance Policy',
        registration: 'Registration unavailable',
        policyNumber: String(policy.policyNumber || policy.policyId || policy.id || '—'),
        coverType: 'Insurance',
        coverageItems: [],
        endorsementItems: [],
        statusMeta: { title: 'Active', detail: '', canAddDriver: true, tone: 'active' },
        startDate: String(policy.effectiveDate || policy.inceptionDate || policy.startDate || ''),
        endDate: String(policy.endDate || policy.expiryDate || ''),
        isPast: false,
        currency: 'EUR',
        drivers: [{ fullName: 'Policy holder', dob: '', licenseYears: '', isPrimary: true }],
        excess: { total: 0, compulsory: 0, voluntary: 0 },
        coverageExcessRows: [],
        additionalExcessRows: [],
        ncb: { years: 0, isProtected: false },
        premium: 0,
        premiumRows: [],
        declaredValue: 0,
        mileage: '—',
        vehicleUse: 'Not declared',
        parking: 'Not declared',
        country: '',
        licenseType: '',
        licenseYears: 0,
        paymentMethodLabel: '',
        paymentStatus: '',
        outstandingBalance: 0,
    };
}

// ─── Bootstrap in-flight dedup (application concern) ───

let bootstrapInFlight: Promise<{ policies: PolicyDTO[]; claims: ClaimDTO[] }> | null = null;

async function loadBootstrap(): Promise<{ policies: PolicyDTO[]; claims: ClaimDTO[] }> {
    if (bootstrapInFlight) return bootstrapInFlight;
    bootstrapInFlight = (async () => {
        const [pRes, cRes] = await Promise.all([
            api.listPolicies({ page: 1, pageSize: 200 }),
            api.listClaims({ page: 1, pageSize: 200, include: ['infoRequests'] }),
        ]);
        return {
            policies: pRes.success && pRes.data ? (Array.isArray(pRes.data) ? pRes.data : []) : [],
            claims: cRes.success && cRes.data ? (Array.isArray(cRes.data) ? cRes.data : []) : [],
        };
    })();
    try {
        return await bootstrapInFlight;
    } finally {
        bootstrapInFlight = null;
    }
}

// ─── User info from storage (application concern) ───

function readUserName(): string | undefined {
    try {
        const raw = localStorage.getItem('user_info');
        if (!raw) return undefined;
        const parsed = JSON.parse(raw);
        const name = String(parsed?.name || '').trim();
        const username = String(parsed?.username || parsed?.email || '').trim();
        return name || username || undefined;
    } catch {
        return undefined;
    }
}

// ─── Controller ───

export function useClientDashboardController() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // ─── Bootstrap state ───
    const [loading, setLoading] = useState(true);
    const [policies, setPolicies] = useState<DashboardPolicyVM[]>([]);
    const [claims, setClaims] = useState<ClaimVM[]>([]);
    const [userName, setUserName] = useState<string | undefined>(undefined);

    // ─── UI state ───
    const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
    const [showPremiumBreakdownFor, setShowPremiumBreakdownFor] = useState<string | null>(null);
    const [showAllActivityByPolicy, setShowAllActivityByPolicy] = useState<Record<string, boolean>>({});

    // ─── Lazy-loaded data ───
    const [docsByPolicy, setDocsByPolicy] = useState<Record<string, DocumentVM[]>>({});
    const [docsLoadingPolicyId, setDocsLoadingPolicyId] = useState<string | null>(null);
    const [feedByPolicy, setFeedByPolicy] = useState<Record<string, ActivityItemVM[]>>({});
    const [feedLoadingPolicyId, setFeedLoadingPolicyId] = useState<string | null>(null);

    // ─── Bootstrap load ───

    useEffect(() => {
        let cancelled = false;
        setUserName(readUserName());
        setLoading(true);
        (async () => {
            const raw = await loadBootstrap();
            if (cancelled) return;
            try {
                const vm = mapBootstrapToVM(raw);
                setPolicies(vm.policies);
                setClaims(vm.claims);
            } catch {
                const fallbackPolicies = (raw.policies || [])
                    .filter(isClientVisiblePolicy)
                    .map((policy) => {
                        try {
                            return mapPolicyToVM(policy);
                        } catch {
                            return fallbackPolicyVm(policy);
                        }
                    });
                const fallbackClaims = (raw.claims || []).map((claim) => ({
                    id: String(claim.id || ''),
                    status: String(claim.status || ''),
                    claimNumber: String(claim.claimNumber || claim.id || ''),
                    policyId: String(claim.policyId || ''),
                    reportedDate: String(claim.reportedDate || claim.createdAt || ''),
                    hasClaimForm: false,
                }));
                setPolicies(fallbackPolicies);
                setClaims(fallbackClaims);
            }
        })()
            .catch(() => {
                if (cancelled) return;
                setPolicies([]);
                setClaims([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, []);

    // ─── Derived policy lists ───

    const sorted = useMemo(() => sortPoliciesByRecency(policies), [policies]);
    const { active: activePolicies, expired: expiredPolicies } = useMemo(
        () => partitionPolicies(sorted),
        [sorted],
    );

    // ─── Policy selection (route-aware) ───

    const focusedPolicyId = String(searchParams.get('policy') || '').trim();

    const focusPolicy = (policyId: string) => {
        const next = new URLSearchParams(searchParams);
        next.set('policy', policyId);
        setSearchParams(next);
    };

    const clearFocusedPolicy = () => {
        const next = new URLSearchParams(searchParams);
        next.delete('policy');
        setSearchParams(next, { replace: true });
        setShowPremiumBreakdownFor(null);
    };

    // Auto-focus single policy
    useEffect(() => {
        if (activePolicies.length !== 1) return;
        const onlyKey = activePolicies[0].key;
        if (focusedPolicyId === onlyKey) return;
        const next = new URLSearchParams(searchParams);
        next.set('policy', onlyKey);
        setSearchParams(next, { replace: true });
    }, [focusedPolicyId, activePolicies, searchParams, setSearchParams]);

    const selectedPolicy = useMemo(() => {
        if (!activePolicies.length) return null;
        if (activePolicies.length === 1) return activePolicies[0];
        return activePolicies.find((p) => p.key === focusedPolicyId) || null;
    }, [activePolicies, focusedPolicyId]);

    const isPortfolioMode = activePolicies.length > 1 && !selectedPolicy;

    // ─── Hydrate selected policy from detail endpoint ───
    // listPolicies can be a compact projection; refresh selected policy to keep
    // mutable nested fields (e.g., additionalDrivers) accurate after endorsements.
    useEffect(() => {
        const selectedKey = selectedPolicy?.key || '';
        if (!selectedKey) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await api.getPolicy(selectedKey);
                if (cancelled || !res?.success || !res.data) return;
                const hydratedVm = mapPolicyToVM(res.data as PolicyDTO);
                setPolicies((prev) => {
                    const idx = prev.findIndex((p) => p.key === hydratedVm.key);
                    if (idx < 0) return prev;
                    const next = [...prev];
                    next[idx] = hydratedVm;
                    return next;
                });
            } catch {
                // keep current list snapshot; detail hydration is best-effort
            }
        })();
        return () => { cancelled = true; };
    }, [selectedPolicy?.key]);

    // ─── Claims by policy ───

    const claimsByPolicy = useMemo(() => {
        const byId: Record<string, ClaimVM[]> = {};
        claims.forEach((claim) => {
            if (!claim.policyId) return;
            if (!byId[claim.policyId]) byId[claim.policyId] = [];
            byId[claim.policyId].push(claim);
        });
        Object.values(byId).forEach((list) => {
            list.sort((a, b) => new Date(b.reportedDate || 0).getTime() - new Date(a.reportedDate || 0).getTime());
        });
        return byId;
    }, [claims]);

    // ─── Lazy-load documents ───

    useEffect(() => {
        const selectedKey = selectedPolicy?.key || '';
        if (!selectedKey) return;
        if (docsByPolicy[selectedKey]) return;
        let cancelled = false;
        setDocsLoadingPolicyId(selectedKey);
        (async () => {
            try {
                const res = await api.listPolicyDocuments(selectedKey);
                if (cancelled) return;
                const rawDocs = res.success && Array.isArray(res.data) ? (res.data as DocumentDTO[]) : [];
                let authToken: string | null = null;
                try {
                    authToken = localStorage.getItem('auth_token');
                } catch {
                    authToken = null;
                }
                setDocsByPolicy((prev) => ({ ...prev, [selectedKey]: mapDocumentsToVM(rawDocs, authToken) }));
            } catch {
                if (cancelled) return;
                setDocsByPolicy((prev) => ({ ...prev, [selectedKey]: [] }));
            } finally {
                if (!cancelled) setDocsLoadingPolicyId(null);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedPolicy?.key, docsByPolicy]);

    // ─── Lazy-load feed ───

    useEffect(() => {
        const selectedKey = selectedPolicy?.key || '';
        if (!selectedKey) return;
        if (feedByPolicy[selectedKey]) return;
        let cancelled = false;
        setFeedLoadingPolicyId(selectedKey);
        (async () => {
            try {
                const res = await api.getPolicyFeed(selectedKey);
                if (cancelled) return;
                const rawEvents = res.success && Array.isArray(res.data) ? (res.data as FeedEventDTO[]) : [];
                setFeedByPolicy((prev) => ({ ...prev, [selectedKey]: mapFeedEventsToVM(rawEvents) }));
            } catch {
                if (cancelled) return;
                setFeedByPolicy((prev) => ({ ...prev, [selectedKey]: [] }));
            } finally {
                if (!cancelled) setFeedLoadingPolicyId(null);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedPolicy?.key, feedByPolicy]);

    // ─── Greeting ───

    const greetingFirstName = useMemo(
        () => resolveGreetingName(userName, activePolicies, focusedPolicyId),
        [userName, activePolicies, focusedPolicyId],
    );
    const greeting = getTimedGreeting(greetingFirstName);

    // ─── Detail props for selected policy ───

    const selectedPolicyKey = selectedPolicy?.key || '';
    const docs = docsByPolicy[selectedPolicyKey] || [];
    const docsLoading = docsLoadingPolicyId === selectedPolicyKey && !docsByPolicy[selectedPolicyKey];
    const feed = feedByPolicy[selectedPolicyKey] || [];
    const feedLoading = feedLoadingPolicyId === selectedPolicyKey && !feedByPolicy[selectedPolicyKey];
    const isBreakdownOpen = showPremiumBreakdownFor === selectedPolicyKey;
    const showAllActivity = Boolean(showAllActivityByPolicy[selectedPolicyKey]);
    const policyClaims = claimsByPolicy[selectedPolicyKey] || [];
    const openClaimStatuses = DASHBOARD_DISPLAY_CONFIG.status.openClaimStatuses as readonly string[];
    const openClaims = policyClaims.filter((c) => openClaimStatuses.includes(c.status.toUpperCase().replace(/\s+/g, '_')));
    const topClaim = openClaims[0] || policyClaims[0] || null;
    const pendingClaimFormClaim = policyClaims.find((c) => c.hasClaimForm) || null;

    return {
        // Loading
        loading,

        // Greeting
        greeting,

        // Tab
        activeTab,
        setActiveTab,
        counts: { active: activePolicies.length, expired: expiredPolicies.length },

        // Policy lists
        activePolicies,
        expiredPolicies,

        // Selection
        selectedPolicy,
        isPortfolioMode,
        focusPolicy,
        clearFocusedPolicy,

        // Navigation
        navigate,
        searchParams,

        // Detail view props (only valid when selectedPolicy !== null)
        detail: {
            docs,
            docsLoading,
            feed,
            feedLoading,
            isBreakdownOpen,
            showAllActivity,
            topClaim,
            pendingClaimFormClaim,
            toggleBreakdown: () => setShowPremiumBreakdownFor(isBreakdownOpen ? null : selectedPolicyKey),
            toggleShowAllActivity: () =>
                setShowAllActivityByPolicy((prev) => ({
                    ...prev,
                    [selectedPolicyKey]: !showAllActivity,
                })),
        },
    };
}

export type ClientDashboardController = ReturnType<typeof useClientDashboardController>;
