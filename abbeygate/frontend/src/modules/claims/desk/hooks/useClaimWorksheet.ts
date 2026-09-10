import { useCallback, useState } from 'react';
import { claimsApiClient as api } from '@/src/modules/claims/api/claimsApiClient';
import type { Worksheet } from '@/src/modules/claims/model/worksheetTypes';

export function useClaimWorksheet() {
  const [worksheet, setWorksheet] = useState<Worksheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const loadWorksheet = useCallback(async (claimId: string) => {
    if (!claimId) return null;
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.getClaimWorksheet(claimId);
      if (res.success && res.data) {
        const next = res.data as Worksheet;
        setWorksheet(next);
        return next;
      }
      setWorksheet(null);
      setLoadError(res.error?.message || 'Failed to load claim worksheet');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    worksheet,
    setWorksheet,
    loading,
    loadError,
    setLoadError,
    loadWorksheet,
  };
}

