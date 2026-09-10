import { useCallback, useEffect, useMemo, useState } from 'react';
import { clientPortalApiClient as api } from '@/src/shared/api/clientPortalApiClient';
import { asRecord } from '@/src/shared/lib/record';
import { useClaimWorksheet } from './useClaimWorksheet';
import { useDetailPolicy } from './useDetailPolicy';
import {
  hasMeaningfulIntakeData,
  selectAuditIndicator,
  selectAvailableDevelopmentTypes,
  selectAwaitingFnolResponse,
  selectIntakeStatusPill,
  selectVisibleTabs,
} from '../model/selectors';
import type { PolicyOption } from '../model/types';

export function useClaimsDeskVM(args: { routeClaimId: string; isDetailView: boolean }) {
  const { routeClaimId, isDetailView } = args;
  const [policies, setPolicies] = useState<PolicyOption[]>([]);
  const {
    worksheet,
    setWorksheet,
    loading,
    loadError,
    setLoadError,
    loadWorksheet,
  } = useClaimWorksheet();
  const { detailPolicy, setDetailPolicy } = useDetailPolicy(worksheet);

  const loadPolicies = useCallback(async () => {
    const res = await api.listPolicies({ page: 1, pageSize: 300, projection: 'compact' });
    if (!res.success || !Array.isArray(res.data)) return;
    // ABY-260 — Match the policy-list adapter's policy-holder
    // resolution order (`frontend/src/modules/policies/list/policiesAdapter.ts:168-175`).
    // The compact projection returns BOTH `policyholderDisplay` (the
    // canonical policy-holder display name written by
    // `policyListIndex`) and `insuredName` (the insured-side label,
    // which for commercial / multi-named-insured policies frequently
    // differs from the policy holder — that mismatch is what the
    // claims desk's LinkPolicyModal surfaced when Effie searched a
    // home policy and saw a name that was not the policy holder).
    // Read `policyholderDisplay` first so the dropdown labels match
    // the policy detail page; keep the legacy fallbacks so the row
    // still renders for any future projection that hasn't populated
    // the canonical field yet. `asRecord` from
    // `@/src/shared/lib/record` is the shared narrowing helper — do
    // not redeclare locally (the `no-new-any` diff ratchet forbids
    // re-introducing broad map casts at boundaries).
    const rows = Array.isArray(res.data) ? res.data : [];
    const next = rows
      .map((row) => {
        const r = asRecord(row);
        const holder = asRecord(r.policyHolder);
        const insuredName = String(
          r.policyholderDisplay
          || holder.name
          || r.insuredName
          || r.insuredDisplay
          || r.policyHolderName
          || r.insured
          || '',
        );
        return {
          id: String(r.id || ''),
          policyNumber: String(r.policyNumber || ''),
          insuredName,
        };
      })
      .filter((row) => row.id);
    setPolicies(next);
  }, []);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  useEffect(() => {
    if (!isDetailView || !routeClaimId) {
      setWorksheet(null);
      setDetailPolicy(null);
      return;
    }
    void loadWorksheet(routeClaimId);
  }, [isDetailView, routeClaimId, loadWorksheet, setDetailPolicy, setWorksheet]);

  const caseMode = Boolean(worksheet?.case?.isUnlinked);
  const hasIntakeData = useMemo(
    () => hasMeaningfulIntakeData(worksheet),
    [worksheet],
  );
  const awaitingFnolResponse = useMemo(
    () => selectAwaitingFnolResponse(worksheet, caseMode, hasIntakeData),
    [worksheet, caseMode, hasIntakeData],
  );
  const availableDevelopmentTypes = useMemo(
    () => selectAvailableDevelopmentTypes(worksheet, caseMode),
    [worksheet, caseMode],
  );
  const visibleTabs = useMemo(
    () => selectVisibleTabs(caseMode, awaitingFnolResponse),
    [caseMode, awaitingFnolResponse],
  );
  const intakeStatusPill = useMemo(
    () => selectIntakeStatusPill(worksheet, caseMode, awaitingFnolResponse),
    [worksheet, caseMode, awaitingFnolResponse],
  );
  const auditIndicator = useMemo(
    () => selectAuditIndicator(worksheet),
    [worksheet],
  );

  return {
    state: {
      worksheet,
      loading,
      loadError,
      policies,
      detailPolicy,
    },
    derived: {
      caseMode,
      hasMeaningfulIntakeData: hasIntakeData,
      awaitingFnolResponse,
      availableDevelopmentTypes,
      visibleTabs,
      intakeStatusPill,
      auditIndicator,
    },
    actions: {
      loadPolicies,
      reloadWorksheet: async () => {
        if (!routeClaimId) return null;
        return await loadWorksheet(routeClaimId);
      },
      loadWorksheet,
      setLoadError,
      setWorksheet,
    },
  };
}

