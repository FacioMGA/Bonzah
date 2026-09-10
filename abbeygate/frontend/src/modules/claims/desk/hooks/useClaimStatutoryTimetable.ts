import { useEffect, useState } from 'react';
import { claimsApiClient as api } from '@/src/modules/claims/api/claimsApiClient';
import type { ClaimStatutoryTimetableResult } from '@/src/modules/claims/model/statutoryTimetableTypes';

type State = {
  loading: boolean;
  error: string;
  data: ClaimStatutoryTimetableResult | null;
};

/**
 * Loads the derived statutory claims-handling timetable for a claim. The
 * backend recomputes it on every read, so this is a plain fetch keyed on the
 * claim id (no local mutation, no cache invalidation to manage).
 */
export function useClaimStatutoryTimetable(claimId: string | undefined): State {
  const [state, setState] = useState<State>({ loading: false, error: '', data: null });

  useEffect(() => {
    if (!claimId) {
      setState({ loading: false, error: '', data: null });
      return;
    }
    let cancelled = false;
    setState({ loading: true, error: '', data: null });
    void (async () => {
      try {
        const res = await api.getClaimStatutoryTimetable(claimId);
        if (cancelled) return;
        if (res.success && res.data) {
          setState({ loading: false, error: '', data: res.data });
        } else {
          setState({ loading: false, error: res.error?.message || 'Failed to load statutory timetable', data: null });
        }
      } catch (error) {
        if (cancelled) return;
        setState({ loading: false, error: error instanceof Error ? error.message : 'Failed to load statutory timetable', data: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claimId]);

  return state;
}
