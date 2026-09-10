import { useEffect, useState } from 'react';
import { pricingApiClient } from '../../api/pricingApiClient';
import { asRecord } from '@/src/shared/lib/record';

type UsePolicyPremiumTabArgs = {
  activeTab: string;
  selectedPolicyId: string | null;
  selectedProductType?: string;
  quoteData: unknown;
  quoteResponse: unknown;
};

export function usePolicyPremiumTab(args: UsePolicyPremiumTabArgs) {
  const { activeTab, selectedPolicyId, selectedProductType, quoteData, quoteResponse } = args;
  const [excessImpact, setAutoExcessImpact] = useState<number | null>(null);
  const [excessImpactLoading, setAutoExcessImpactLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== 'Premium') return;
    if (!selectedPolicyId) return;
    if (!selectedProductType) return;

    const qr = asRecord(quoteResponse);
    const primary = asRecord(qr?.primaryOption);
    const cost = asRecord(primary?.costDetails);
    const currentTotal = Number(cost?.totalPremium ?? primary?.annualPremium ?? 0);
    if (!Number.isFinite(currentTotal) || currentTotal <= 0) {
      setAutoExcessImpact(null);
      return;
    }

    const qd = asRecord(quoteData);
    const currentExcess = (() => {
      const n = parseInt(String(qd?.requiredExcess || '').replace(/[^0-9]/g, '') || '0', 10);
      return Number.isFinite(n) && n > 0 ? n : 250;
    })();
    const baselineExcess = 250;
    if (currentExcess === baselineExcess) {
      setAutoExcessImpact(0);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setAutoExcessImpactLoading(true);
        const resp = await pricingApiClient.calculateProductPremium(selectedPolicyId, qd, baselineExcess);
        if (cancelled) return;
        if (!resp?.success) {
          setAutoExcessImpact(null);
          return;
        }
        const basePrimary = resp?.data?.primaryOption;
        const baseCost = basePrimary?.costDetails;
        const baselineTotal = Number(baseCost?.totalPremium ?? basePrimary?.annualPremium ?? 0);
        if (!Number.isFinite(baselineTotal)) {
          setAutoExcessImpact(null);
          return;
        }
        setAutoExcessImpact(currentTotal - baselineTotal);
      } catch {
        if (!cancelled) setAutoExcessImpact(null);
      } finally {
        if (!cancelled) setAutoExcessImpactLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, quoteData, quoteResponse, selectedPolicyId, selectedProductType]);

  return { excessImpact, excessImpactLoading };
}
