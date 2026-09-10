import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import { logger } from '@/src/shared/lib/logger';

type GlobalCommissionsSettings = {
  rate?: number;
  splits?: {
    retailBroker?: number;
    mga?: number;
    wholesale?: number;
    carrier?: number;
  };
};

export type CommissionComponent = {
  id: 'retail' | 'mga' | 'wholesale';
  name: string;
  role: string;
  percent: number;
};

const DEFAULT_COMPONENTS: CommissionComponent[] = [
  { id: 'retail', name: 'Retail broker commission', role: 'Retail broker', percent: 10 },
  { id: 'mga', name: 'MGA fee', role: 'MGA fee', percent: 15 },
  { id: 'wholesale', name: 'Wholesale broker commission', role: 'Wholesale broker', percent: 5 },
];

export function useCommissionsController() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [ratePct, setRatePct] = useState<number>(23);
  const [components, setComponents] = useState<CommissionComponent[]>(DEFAULT_COMPONENTS);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.getSettings('global_commissions');
        if (res.success && res.data) {
          const data = (res.data || {}) as GlobalCommissionsSettings;
          if (typeof data.rate === 'number') setRatePct(Math.round(data.rate * 100));
          const splits = data.splits || {};
          setComponents([
            { ...DEFAULT_COMPONENTS[0], percent: Number(splits.retailBroker ?? DEFAULT_COMPONENTS[0].percent) },
            { ...DEFAULT_COMPONENTS[1], percent: Number(splits.mga ?? DEFAULT_COMPONENTS[1].percent) },
            { ...DEFAULT_COMPONENTS[2], percent: Number(splits.wholesale ?? DEFAULT_COMPONENTS[2].percent) },
          ]);
        }
      } catch (e) {
        logger.error('Failed to load commission settings', e);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const derived = useMemo(() => {
    const totalCommission = components.reduce((sum, c) => sum + (Number(c.percent) || 0), 0);
    const carrier = Math.max(0, 100 - totalCommission);
    const splitValid = totalCommission <= 100;
    return { totalCommission, carrier, splitValid };
  }, [components]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const retail = components.find((c) => c.id === 'retail')?.percent ?? 0;
      const mga = components.find((c) => c.id === 'mga')?.percent ?? 0;
      const wholesale = components.find((c) => c.id === 'wholesale')?.percent ?? 0;
      const carrier = Math.max(0, 100 - (retail + mga + wholesale));
      await api.saveSettings('global_commissions', {
        rate: ratePct / 100,
        splits: { retailBroker: retail, mga, wholesale, carrier },
      });
      setToastMessage('Commission settings saved.');
      setShowToast(true);
    } catch (e) {
      logger.error(e);
      window.alert('Failed to save commission settings.');
    } finally {
      setSaving(false);
    }
  }, [components, ratePct]);

  const updateComponentPercent = useCallback((componentId: CommissionComponent['id'], percent: number) => {
    setComponents((prev) => prev.map((c) => (c.id === componentId ? { ...c, percent } : c)));
  }, []);

  const closeToast = useCallback(() => setShowToast(false), []);
  const goToPrograms = useCallback(() => navigate('/programs'), [navigate]);

  return {
    loading,
    saving,
    toastMessage,
    showToast,
    ratePct,
    setRatePct,
    components,
    derived,
    handleSave,
    updateComponentPercent,
    closeToast,
    goToPrograms,
  };
}
