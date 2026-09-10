import { useEffect, useState } from 'react';
import { policyCrudApiClient } from '../../api/policyCrudApiClient';
import { usePolicyPremiumTab } from './usePolicyPremiumTab';
import { asRecord } from '@/src/shared/lib/record';

type UnknownRecord = Record<string, unknown>;

type UsePolicyPremiumActionsArgs = {
  activeTab: string;
  selectedPolicyId: string | null;
  selectedProductType: string;
  quoteData: unknown;
  quoteResponse: unknown;
};

export function usePolicyPremiumActions(args: UsePolicyPremiumActionsArgs) {
  const { activeTab, selectedPolicyId, selectedProductType, quoteData, quoteResponse } = args;
  const [mbeTemplates, setMbeTemplates] = useState<UnknownRecord[]>([]);
  const [coverageDirty, setCoverageDirty] = useState(false);

  useEffect(() => {
    if (activeTab !== 'Premium') return;
    if (mbeTemplates.length > 0) return;
    if (!selectedPolicyId) return;
    policyCrudApiClient
      .listMbeTemplates({ policyId: selectedPolicyId })
      .then((res: { success?: boolean; data?: unknown[] }) => {
        if (res?.success && Array.isArray(res.data)) {
          setMbeTemplates(res.data.map((item: unknown) => asRecord(item)));
        }
      })
      .catch(() => { });
  }, [activeTab, mbeTemplates.length, selectedPolicyId]);

  useEffect(() => {
    if (!selectedPolicyId) return;
    setCoverageDirty(false);
  }, [selectedPolicyId]);

  const { excessImpact, excessImpactLoading } = usePolicyPremiumTab({
    activeTab,
    selectedPolicyId,
    selectedProductType,
    quoteData,
    quoteResponse,
  });

  return {
    mbeTemplates,
    coverageDirty,
    setCoverageDirty,
    excessImpact,
    excessImpactLoading,
  };
}
