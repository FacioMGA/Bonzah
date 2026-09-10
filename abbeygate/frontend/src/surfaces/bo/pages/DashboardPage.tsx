import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import { PageHeader } from '@/src/shared/ui';
import { formatDateInputValueLocal, formatMoneyUI } from '@/src/shared/lib/format';
import { useQuery } from '@tanstack/react-query';
import { DateRangePicker, type DateRange } from '@/src/shared/ui';
import { ProgramFilter } from '@/src/surfaces/bo/components/ProgramFilter';
import { DashboardCoreKpis } from '@/src/modules/dashboard/views/DashboardCoreKpis';
import { DashboardIntelligencePanel } from '@/src/modules/dashboard/views/DashboardIntelligencePanel';
import { DashboardInsightStrip } from '@/src/modules/dashboard/views/DashboardInsightStrip';
import type { DashboardCore, DashboardIntelligence } from '@/src/modules/dashboard/model/types';

export interface DashboardProps {
  month: string;
  user: { name?: string } | null;
  onMonthChange: React.Dispatch<React.SetStateAction<string>>;
}

type UnderwriterData = { core?: DashboardCore };
type DashboardData = {
  intelligence?: DashboardIntelligence;
  dashboard?: { underwriter?: UnderwriterData };
};

function getTimedGreeting(userName?: string): string {
  const hour = new Date().getHours();
  const greeting = hour >= 5 && hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return userName ? `${greeting}, ${userName}!` : `${greeting}!`;
}

const DashboardPage: React.FC<DashboardProps> = ({ user }) => {
  const navigate = useNavigate();
  void navigate; // retained for future use in quick-action hooks

  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now, label: 'Month to date' };
  });
  const [programId, setProgramId] = useState<string | null>(null);
  const startDateValue = formatDateInputValueLocal(dateRange.start);
  const endDateValue = formatDateInputValueLocal(dateRange.end);

  const dashboardQuery = useQuery({
    queryKey: ['dashboard', startDateValue, endDateValue, programId],
    queryFn: async () => {
      const response = await api.getDashboard({
        start: startDateValue,
        end: endDateValue,
        programId: programId || undefined,
      });
      if (!response?.success) throw new Error(response?.error?.message || 'Failed to load dashboard data');
      return response.data as DashboardData;
    },
    staleTime: 30_000,
  });

  const dashboardData = useMemo(() => (dashboardQuery.data || {}) as DashboardData, [dashboardQuery.data]);
  const loading = dashboardQuery.isLoading;
  const error = dashboardQuery.error ? (dashboardQuery.error as Error).message : null;

  const uw = useMemo(() => dashboardData?.dashboard?.underwriter || null, [dashboardData]);
  const intelligence = useMemo(() => dashboardData?.intelligence || null, [dashboardData]);

  const moneyEUR = (n: number) => formatMoneyUI(Number(n || 0), 'EUR', { showCode: false });
  const pct = (v: number) => `${(Number(v || 0) * 100).toFixed(1)}%`;
  const deltaPill = (d: number, kind: 'eur' | 'pct' | 'num') => {
    const n = Number(d || 0);
    const positive = n >= 0;
    const text =
      kind === 'eur' ? `${positive ? '+' : ''}${moneyEUR(n)}` :
        kind === 'pct' ? `${positive ? '+' : ''}${(n * 100).toFixed(1)}%` :
          `${positive ? '+' : ''}${Math.round(n).toLocaleString()}`;
    return (
      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${positive ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-rose-50 text-rose-800 border-rose-100'}`}>
        {text}
      </span>
    );
  };

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="ui-page">
        <div className="space-y-6">
          <div className="h-10 w-56 bg-slate-100 rounded-2xl animate-pulse" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-3xl border border-slate-200 p-8">
                <div className="h-3 w-28 bg-slate-100 rounded-xl animate-pulse" />
                <div className="mt-4 h-8 w-36 bg-slate-100 rounded-xl animate-pulse" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="h-2.5 w-20 bg-slate-100 rounded-xl animate-pulse" />
                <div className="mt-3 h-8 w-12 bg-slate-100 rounded-xl animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="ui-page">
        <div className="flex items-center justify-center h-64">
          <div className="text-red-500 font-medium">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-10">

      {/* ── Header ── */}
      <PageHeader
        title={getTimedGreeting(user?.name?.split(' ')[0] || user?.name || 'Underwriter')}
        actions={(
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <ProgramFilter value={programId} onChange={setProgramId} />
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          </div>
        )}
      />

      {/* ── KPI cards ── */}
      <DashboardCoreKpis core={uw?.core} moneyEUR={moneyEUR} pct={pct} deltaPill={deltaPill} />

      {/* ── Smart Insight Strip ── */}
      {intelligence?.insights && intelligence.insights.length > 0 && (
        <DashboardInsightStrip insights={intelligence.insights} />
      )}

      {/* ── Intelligence panel ── */}
      {intelligence && (
        <DashboardIntelligencePanel intelligence={intelligence} />
      )}

    </div>
  );
};

export default DashboardPage;
