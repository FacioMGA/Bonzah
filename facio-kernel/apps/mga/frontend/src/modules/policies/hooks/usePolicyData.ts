import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { policiesClient as api } from '../api/policiesClient';
import type { PolicyRecord } from '../model/policy';
import { normalizePolicyForState } from '../model/policyPageHelpers';
import { asRecord } from '@/src/shared/lib/record';
import { logger } from '@/src/shared/lib/logger';

type PortfolioView = 'list' | 'detail' | 'manual-entry';
type TabName = 'Policy Holder' | 'Underwriting' | 'Coverage' | 'Premium' | 'Billing' | 'Documents' | 'Communications' | 'Service' | 'Feed';

function toPolicyRecord(input: unknown): PolicyRecord | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  return {
    ...raw,
    id: raw.id ? String(raw.id) : undefined,
    policyId: raw.policyId ? String(raw.policyId) : undefined,
    policyNumber: raw.policyNumber ? String(raw.policyNumber) : undefined,
    productType: raw.productType ? String(raw.productType) : undefined,
    status: raw.status ? String(raw.status) : undefined,
    name: raw.name ? String(raw.name) : undefined,
    programId: raw.programId ? String(raw.programId) : undefined,
    binderId: raw.binderId ? String(raw.binderId) : undefined,
    quoteData:
      raw.quoteData && typeof raw.quoteData === 'object' && !Array.isArray(raw.quoteData)
        ? (raw.quoteData as Record<string, unknown>)
        : undefined,
    quoteResponse:
      raw.quoteResponse && typeof raw.quoteResponse === 'object' && !Array.isArray(raw.quoteResponse)
        ? (raw.quoteResponse as Record<string, unknown>)
        : undefined,
    contact:
      raw.contact && typeof raw.contact === 'object' && !Array.isArray(raw.contact)
        ? (raw.contact as Record<string, unknown>)
        : undefined,
  };
}

export function usePolicyData() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeId } = useParams();
  const currentRouteId = useRef(routeId);
  currentRouteId.current = routeId;
  const reloadEpoch = useRef(0);

  const sanitizeDetailSearch = (search: string | undefined): string => {
    const sp = new URLSearchParams(search || '');
    const keep = new URLSearchParams();
    const edit = String(sp.get('edit') || '').trim();
    const tab = String(sp.get('tab') || '').trim();
    if (edit) keep.set('edit', edit);
    if (tab) keep.set('tab', tab);
    const next = keep.toString();
    return next ? `?${next}` : '';
  };

  // View state: list at /policies, detail at /policies/:id
  const [view, setView] = useState<PortfolioView>('list');

  // Selected policy state
  const [selectedPortfolio, setSelectedPortfolio] = useState<PolicyRecord | null>(null);

  // Active tab state
  const [activeTab, setActiveTab] = useState<TabName>('Policy Holder');

  // Tab/hash mapping utilities
  const tabToHash = (tab: string): string =>
    tab
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

  const hashToTab = useMemo(() => {
    const tabs: TabName[] = ['Policy Holder', 'Underwriting', 'Coverage', 'Premium', 'Billing', 'Documents', 'Communications', 'Service', 'Feed'];
    const m = new Map<string, TabName>();
    for (const t of tabs) m.set(tabToHash(t), t);
    // Common aliases / backwards-compat
    m.set('policyholder', 'Policy Holder');
    m.set('policy-holder', 'Policy Holder');
    return m;
  }, []);
  const allTabs: TabName[] = ['Policy Holder', 'Underwriting', 'Coverage', 'Premium', 'Billing', 'Documents', 'Communications', 'Service', 'Feed'];

  // Route-driven view: list at /policies, detail at /policies/:id
  useEffect(() => {
    if (!routeId) {
      // Preserve the isNew placeholder while createNeutralDraftPolicy waits for its
      // API call to return. Once navigate(realId) fires, routeId will be set and
      // this branch won't run anymore.
      setSelectedPortfolio((prev) => (prev?.isNew ? prev : null));
      setView((prev) => (prev === 'detail' ? prev : 'list'));
      return;
    }

    if (routeId === 'new') {
      setView('detail');
      setSelectedPortfolio((prev) => (prev?.id === 'new' ? prev : { id: 'new', isNew: true }));
      if (!location.hash) setActiveTab('Policy Holder');
      return;
    }

    setView('detail');
    if (!selectedPortfolio || selectedPortfolio.id !== routeId) {
      // Preserve isNew placeholder data when the real policyId arrives so the workspace
      // doesn't flash blank while loadPolicyDetailsById fetches the real data.
      setSelectedPortfolio((prev) => (prev?.isNew && prev.id !== routeId ? { ...prev, id: routeId } : { id: routeId }));
      // If a hash is present (e.g. #underwriting), let the hash-driven effect pick the tab.
      if (!location.hash) setActiveTab('Policy Holder');
    }

    // Ensure a stable, shareable deep-link shape even when no explicit hash is provided.
    // Also support `?tab=billing` (used by CardCorp redirect) by converting to hash.
    if (!location.hash) {
      const safeSearch = sanitizeDetailSearch(location.search);
      try {
        const sp = new URLSearchParams(safeSearch || '');
        const tabQ = String(sp.get('tab') || '').trim().toLowerCase();
        if (tabQ) {
          navigate(
            { pathname: location.pathname, search: safeSearch, hash: `#${tabQ}` },
            { replace: true }
          );
          return;
        }
      } catch {
        // ignore
      }

      navigate(
        { pathname: location.pathname, search: safeSearch, hash: '#policy-holder' },
        { replace: true }
      );
    }
  }, [routeId, navigate, location.pathname, location.search, location.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link tabs via URL hash: /policies/:id#underwriting
  useEffect(() => {
    if (view !== 'detail') return;
    const raw = (location.hash || '').replace(/^#/, '').trim();
    if (!raw) return;
    const t = hashToTab.get(raw);
    if (t && t !== activeTab) setActiveTab(t);
    const params = new URLSearchParams(location.search || '');
    if (params.has('tab')) {
      params.delete('tab');
      const nextSearch = params.toString();
      navigate(
        { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '', hash: location.hash },
        { replace: true }
      );
    }
  }, [location.hash, location.pathname, location.search, navigate, view, hashToTab, activeTab]);

  // Wrapper for reloadCurrentPolicy - accepts dependencies from PolicyPage
  const reloadCurrentPolicy = async (
    opts?: { riskTransactionId?: string | null },
    dependencies?: {
      viewingRiskTransactionId: string | null;
      setViewingRiskTransactionSnapshot: (snapshot: Record<string, unknown>) => void;
    }
  ) => {
    if (!selectedPortfolio?.id) return;
    const policyId = selectedPortfolio.id;
    const request = ++reloadEpoch.current;
    try {
      const res = await api.getPolicy(selectedPortfolio.id);
      if (res.success && res.data) {
        const normalized = normalizePolicyForState({policyDataRaw:asRecord(res.data),prevPortfolio:selectedPortfolio});
        let next = normalized.nextPortfolio;
        if (activeTab === 'Underwriting') {
          const response = await api.getUWForm(policyId);
          const projection = asRecord(response.success ? response.data : {});
          next = {...next, programmeDefinition:projection.programmeDefinition ?? null, programmeDefinitionError:projection.programmeDefinitionError ?? null};
        }
        if (request !== reloadEpoch.current || currentRouteId.current !== policyId) return;
        setSelectedPortfolio(toPolicyRecord(next));
        // Also reload endorsements if we are on that tab, or simpler just EndorsementsPanel will handle its own refresh if mounted, 
        // but we need to update parent state (premium etc).
      }

      // If we are viewing a RiskTransaction version (issued history / endorsement draft), refresh its snapshot too.
      const rtId =
        typeof opts?.riskTransactionId === 'string'
          ? String(opts.riskTransactionId).trim()
          : (dependencies?.viewingRiskTransactionId ? String(dependencies.viewingRiskTransactionId).trim() : '');
      if (rtId && dependencies) {
        try {
          const v = await api.getPolicyVersionSnapshot(String(selectedPortfolio.id), String(rtId));
          if (v?.success && v.data) dependencies.setViewingRiskTransactionSnapshot(v.data as Record<string, unknown>);
        } catch {
          // best-effort
        }
      }
    } catch (e) {
      logger.error("Failed to reload policy", e);
    }
  };

  return {
    // Routing state
    routeId,
    view,
    setView,
    location,
    navigate,

    // Selected policy
    selectedPortfolio,
    setSelectedPortfolio,

    // Tab state
    activeTab,
    setActiveTab: (tab: string) => {
      const direct = allTabs.find((t) => t === tab);
      if (direct) {
        setActiveTab(direct);
        return;
      }
      const fromHash = hashToTab.get(String(tab || '').trim().replace(/^#/, ''));
      if (fromHash) setActiveTab(fromHash);
    },
    tabToHash,
    hashToTab,

    // Loading functions (wrappers that accept dependencies)
    reloadCurrentPolicy,
  };
}
