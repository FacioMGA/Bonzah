import { useEffect, useState } from 'react';
import { clientPortalApiClient as api } from '@/src/shared/api/clientPortalApiClient';
import type { Worksheet } from '@/src/modules/claims/model/worksheetTypes';
import type { DetailPolicyContext } from '../model/types';
import { extractCoverageRowsFromPolicy, toDisplayText } from '../model/selectors';
import { asRecord } from '@/src/shared/lib/record';

export function useDetailPolicy(worksheet: Worksheet | null) {
  const [detailPolicy, setDetailPolicy] = useState<DetailPolicyContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const policyId = String(worksheet?.policyId || '').trim();
      if (!policyId) {
        setDetailPolicy(null);
        return;
      }
      try {
        const pol = await api.getPolicy(policyId);
        if (!pol.success || !pol.data || cancelled) {
          setDetailPolicy(null);
          return;
        }
        const record = asRecord(pol.data);
        const vi = asRecord(record.vehicleInfo);
        const qd = asRecord(record.quoteData);
        const year = toDisplayText(vi.year ?? qd.year);
        const make = toDisplayText(vi.make ?? qd.make);
        const model = toDisplayText(vi.model ?? qd.model);
        const anchorTitle = [year, make, model].filter(Boolean).join(' ').trim()
          || `Policy ${String(worksheet?.policyNumber || '')}`;
        const premium = Number(record.totalPremium ?? record.premium ?? 0) || 0;
        setDetailPolicy({
          id: String(record.id || policyId),
          policyNumber: String(record.policyNumber || worksheet?.policyNumber || ''),
          holderName: String(asRecord(record.policyHolder).name || ''),
          anchorTitle,
          premium,
          currency: String(record.currency || 'EUR'),
          coverageRows: extractCoverageRowsFromPolicy(record),
        });
      } catch {
        if (!cancelled) setDetailPolicy(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [worksheet?.policyId, worksheet?.policyNumber]);

  return { detailPolicy, setDetailPolicy };
}

