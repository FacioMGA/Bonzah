import { useEffect, useState } from 'react';
import { asRecord } from '@/src/shared/lib/record';

type UnknownRecord = Record<string, unknown>;

type GetPolicyVersionSnapshot = (
  policyId: string,
  riskTransactionId: string,
) => Promise<{ success?: boolean; data?: { snapshot?: { quoteData?: unknown } } }>;

function getByPath(obj: unknown, path: string) {
  try {
    return String(path || '')
      .split('.')
      .filter(Boolean)
      .reduce<unknown>((acc: unknown, key: string) => asRecord(acc)[key], obj);
  } catch {
    return undefined;
  }
}

function normalizeCompare(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value).trim();
}

export function usePolicyEndorsementDiff(params: {
  selectedPolicyId?: string | null;
  endorsementDraftRiskTransactionId?: string | null;
  latestIssuedRiskTransactionId?: string | null;
  getPolicyVersionSnapshot: GetPolicyVersionSnapshot;
}) {
  const {
    selectedPolicyId,
    endorsementDraftRiskTransactionId,
    latestIssuedRiskTransactionId,
    getPolicyVersionSnapshot,
  } = params;
  const [endorsementBaselineQuoteData, setEndorsementBaselineQuoteData] = useState<UnknownRecord | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!selectedPolicyId) return;
      if (!endorsementDraftRiskTransactionId) {
        if (mounted) setEndorsementBaselineQuoteData(null);
        return;
      }
      if (!latestIssuedRiskTransactionId) return;
      try {
        const response = await getPolicyVersionSnapshot(String(selectedPolicyId), String(latestIssuedRiskTransactionId));
        if (!mounted) return;
        const quoteData = response?.success && response?.data ? response.data?.snapshot?.quoteData : null;
        setEndorsementBaselineQuoteData(quoteData && typeof quoteData === 'object' ? asRecord(quoteData) : null);
      } catch {
        if (mounted) setEndorsementBaselineQuoteData(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [endorsementDraftRiskTransactionId, getPolicyVersionSnapshot, latestIssuedRiskTransactionId, selectedPolicyId]);

  const endorsementFieldChanged = (path: string, selectedQuoteData: unknown) => {
    if (!endorsementDraftRiskTransactionId) return false;
    if (!endorsementBaselineQuoteData) return false;
    const current = getByPath(asRecord(selectedQuoteData) || {}, path);
    const baseline = getByPath(endorsementBaselineQuoteData, path);
    return normalizeCompare(current) !== normalizeCompare(baseline);
  };

  return {
    endorsementFieldChanged,
  };
}
