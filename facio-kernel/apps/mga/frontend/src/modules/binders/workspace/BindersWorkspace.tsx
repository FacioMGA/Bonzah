import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Card } from '@/src/shared/ui';
import { getBinderDetail } from '../queries/getBinderDetail';
import { getBinderUsage } from '../queries/getBinderUsage';
import { publishBinder as publishBinderCommand } from '../commands/publishBinder';
import { simulateBinderCheck } from '../commands/simulateBinderCheck';
import { createBinder as createBinderCommand } from '../commands/createBinder';
import { updateBinder as updateBinderCommand } from '../commands/updateBinder';
import { BindersListView } from '../views/BindersListView';
import { BinderDetailView } from '../views/BinderDetailView';
import { BinderCreateEditView } from '../views/BinderCreateEditView';
import type { BinderDetailBundle, BinderSimulationResult, BinderUsageSummary } from '../model/readModels';
import type { BinderTabKey } from '../views/BinderTabs';

const VALID_TABS: BinderTabKey[] = ['overview', 'agreement', 'authority', 'financials-reporting', 'parties-documents', 'usage'];
const BINDER_BASE_PATH = '/configure/binders';

function normalizeTab(raw: string | undefined): BinderTabKey {
  const value = String(raw || 'overview').trim() as BinderTabKey;
  return VALID_TABS.includes(value) ? value : 'overview';
}

export default function BindersWorkspace() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id?: string; tab?: string }>();
  const binderId = String(params.id || '').trim();
  const activeTab = normalizeTab(params.tab);
  const isCreate = location.pathname === `${BINDER_BASE_PATH}/new`;
  const isEdit = Boolean(binderId && location.pathname.endsWith('/edit'));
  const isDetail = Boolean(binderId && !isEdit);

  const [detail, setDetail] = useState<BinderDetailBundle | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [usage, setUsage] = useState<BinderUsageSummary | null>(null);
  const [simulation, setSimulation] = useState<BinderSimulationResult | null>(null);
  const [simulationLoading, setSimulationLoading] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!binderId) return;
    setDetailLoading(true);
    setDetailError('');
    try {
      const [bundle, usageSummary] = await Promise.all([
        getBinderDetail(binderId),
        getBinderUsage(binderId).catch(() => null),
      ]);
      setDetail(bundle);
      setUsage(usageSummary);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : 'Failed to load binder');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [binderId]);

  useEffect(() => {
    if (isDetail || isEdit) {
      void loadDetail();
    }
  }, [isDetail, isEdit, loadDetail]);

  const refresh = useCallback(() => {
    if (isDetail || isEdit) void loadDetail();
  }, [isDetail, isEdit, loadDetail]);

  const onPublish = useCallback(async () => {
    if (!binderId) return;
    setSaveError('');
    try {
      await publishBinderCommand(binderId);
      await loadDetail();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to publish binder');
    }
  }, [binderId, loadDetail]);

  const onSimulate = useCallback(async (input: { territory?: string; riskLocationCountry?: string; insuredDomicileCountry?: string; vehicleValue?: number }) => {
    if (!binderId) return;
    setSimulationLoading(true);
    try {
      const result = await simulateBinderCheck(binderId, input);
      setSimulation(result);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Simulation failed');
    } finally {
      setSimulationLoading(false);
    }
  }, [binderId]);

  const onCreateOrUpdate = useCallback(async (payload: {
    coverholderName: string;
    agreementNumber: string;
    status: string;
    startDate: string;
    endDate: string;
    config: Record<string, unknown>;
  }) => {
    setSaving(true);
    setSaveError('');
    try {
      if (isEdit && binderId) {
        await updateBinderCommand(binderId, {
          coverholderName: payload.coverholderName,
          agreementNumber: payload.agreementNumber,
          status: payload.status,
          startDate: payload.startDate ? new Date(`${payload.startDate}T00:00:00.000Z`).toISOString() : undefined,
          endDate: payload.endDate ? new Date(`${payload.endDate}T00:00:00.000Z`).toISOString() : undefined,
          config: payload.config as never,
        });
        navigate(`${BINDER_BASE_PATH}/${encodeURIComponent(binderId)}/overview`);
      } else {
        const id = await createBinderCommand({
          coverholderName: payload.coverholderName,
          agreementNumber: payload.agreementNumber,
          status: payload.status,
          startDate: payload.startDate ? new Date(`${payload.startDate}T00:00:00.000Z`).toISOString() : undefined,
          endDate: payload.endDate ? new Date(`${payload.endDate}T00:00:00.000Z`).toISOString() : undefined,
          config: payload.config as never,
        });
        navigate(`${BINDER_BASE_PATH}/${encodeURIComponent(id)}/authority`);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save binder');
    } finally {
      setSaving(false);
    }
  }, [binderId, isEdit, navigate]);

  const content = useMemo(() => {
    if (isCreate || isEdit) {
      return (
        <BinderCreateEditView
          mode={isEdit ? 'edit' : 'create'}
          initial={isEdit ? detail : null}
          onSubmit={onCreateOrUpdate}
          saving={saving}
          error={saveError}
        />
      );
    }
    if (isDetail) {
      if (detailLoading) return <Card className="border border-slate-200 p-6 text-sm font-semibold text-slate-500">Loading binder...</Card>;
      if (detailError || !detail) return <Card className="border border-rose-200 bg-rose-50 p-6 text-sm font-semibold text-rose-700">{detailError || 'Binder not found'}</Card>;
      return (
        <BinderDetailView
          bundle={detail}
          usage={usage}
          activeTab={activeTab}
          simulation={simulation}
          simulationLoading={simulationLoading}
          onTabChange={(tab) => navigate(`${BINDER_BASE_PATH}/${encodeURIComponent(binderId)}/${tab}`)}
          onRefresh={refresh}
          onPublish={onPublish}
          onSimulate={onSimulate}
        />
      );
    }
    return (
      <BindersListView />
    );
  }, [
    activeTab,
    binderId,
    detail,
    detailError,
    detailLoading,
    isCreate,
    isDetail,
    isEdit,
    navigate,
    onCreateOrUpdate,
    onPublish,
    onSimulate,
    saveError,
    saving,
    simulation,
    simulationLoading,
    refresh,
    usage,
  ]);

  return content;
}
