import { useEffect } from 'react';

type UsePolicyControllerArgs = {
  view: 'list' | 'detail' | 'manual-entry';
  selectedPolicyId?: string;
  loadPolicyDetailsById: (policyId: string) => Promise<void>;
};

export function usePolicyController(args: UsePolicyControllerArgs) {
  const { view, selectedPolicyId, loadPolicyDetailsById } = args;

  useEffect(() => {
    if (view !== 'detail') return;
    if (!selectedPolicyId) return;
    void loadPolicyDetailsById(String(selectedPolicyId));
  }, [loadPolicyDetailsById, selectedPolicyId, view]);

  return {
    loadPolicyDetailsById,
  };
}
