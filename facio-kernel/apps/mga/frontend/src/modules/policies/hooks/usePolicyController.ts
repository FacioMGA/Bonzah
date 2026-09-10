import { useEffect } from 'react';

type UsePolicyControllerArgs = {
  view: 'list' | 'detail' | 'manual-entry';
  selectedPolicyId?: string;
  detailTab?: string;
  loadPolicyDetailsById: (policyId: string) => Promise<void>;
};

export function usePolicyController(args: UsePolicyControllerArgs) {
  const { view, selectedPolicyId, detailTab, loadPolicyDetailsById } = args;

  useEffect(() => {
    if (view !== 'detail') return;
    if (!selectedPolicyId) return;
    void loadPolicyDetailsById(String(selectedPolicyId));
  }, [loadPolicyDetailsById, selectedPolicyId, view, detailTab]);

  return {
    loadPolicyDetailsById,
  };
}
