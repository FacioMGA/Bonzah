import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { PolicyRecord } from '../model/policy';

type PolicyLocation = {
  pathname: string;
  search?: string;
  hash?: string;
};

type UsePolicyRouteSyncArgs = {
  routeId?: string;
  location: PolicyLocation;
  navigate: (
    to: string | { pathname: string; search?: string; hash?: string },
    options?: { replace?: boolean; preventScrollReset?: boolean }
  ) => void;
  selectedPortfolio: PolicyRecord | null;
  setView: (view: 'list' | 'detail' | 'manual-entry') => void;
  /** Accepts either a direct value or a functional updater, matching React's setState contract. */
  setSelectedPortfolio: Dispatch<SetStateAction<PolicyRecord | null>>;
  setActiveTab: (tab: 'Policy Holder' | 'Underwriting' | 'Coverage' | 'Premium' | 'Billing' | 'Documents' | 'Service' | 'Feed') => void;
  onNewRoute: () => void;
};

export function usePolicyRouteSync(args: UsePolicyRouteSyncArgs) {
  const {
    routeId,
    location,
    navigate,
    selectedPortfolio,
    setView,
    setSelectedPortfolio,
    setActiveTab,
    onNewRoute,
  } = args;
  const handledNewRouteRef = useRef(false);

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

  useEffect(() => {
    if (!routeId) {
      // Don't wipe the isNew placeholder while createNeutralDraftPolicy is waiting
      // for its API call — the URL hasn't been updated to the real ID yet.
      if (selectedPortfolio?.isNew) return;
      setView('list');
      setSelectedPortfolio(null);
      return;
    }
    if (routeId === 'new') {
      if (!handledNewRouteRef.current) {
        handledNewRouteRef.current = true;
        onNewRoute();
      }
      return;
    }
    handledNewRouteRef.current = false;

    setView('detail');
    if (!selectedPortfolio || selectedPortfolio.id !== routeId) {
      // Preserve isNew placeholder data so the workspace doesn't blank out while
      // loadPolicyDetailsById fetches real data.
      setSelectedPortfolio((prev: PolicyRecord | null) => (prev?.isNew && prev.id !== routeId ? { ...prev, id: routeId } : { id: routeId }));
      if (!location.hash) setActiveTab('Policy Holder');
    }
  }, [location.hash, onNewRoute, routeId, selectedPortfolio, setActiveTab, setSelectedPortfolio, setView]);

  useEffect(() => {
    if (!routeId || routeId === 'new') return;
    if (location.hash) return;
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
      // no-op
    }
    navigate(
      { pathname: location.pathname, search: safeSearch, hash: '#policy-holder' },
      { replace: true }
    );
  }, [location.hash, location.pathname, location.search, navigate, routeId]);
}
