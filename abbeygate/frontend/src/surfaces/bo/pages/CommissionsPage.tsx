import React from 'react';
import { Toast, PageHeader, Button, Card, Input } from '@/src/shared/ui';
import { useCommissionsController } from '../controller/useCommissionsController';

const FinancialRulesPage: React.FC = () => {
  const ctrl = useCommissionsController();

  if (ctrl.loading) {
    return (
      <div className="ui-page max-w-5xl mx-auto">
        <div className="flex items-center justify-center h-64">
          <div className="text-slate-400 font-medium">Loading commission settings…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ui-page max-w-5xl mx-auto space-y-8">
      <Toast message={ctrl.toastMessage} isVisible={ctrl.showToast} onClose={ctrl.closeToast} type="success" />

      <PageHeader
        title="Commission Settings"
        subtitle="Persisted global commission rate and split settings."
        status={{ label: 'Settings-backed', tone: 'info' }}
        actions={(
          <div className="flex items-center gap-3">
            <Button variant="outline" size="lg" onClick={ctrl.goToPrograms}>
              Program pricing
            </Button>
            <Button size="lg" onClick={() => void ctrl.handleSave()} disabled={ctrl.saving || !ctrl.derived.splitValid}>
              {ctrl.saving ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        )}
      />

      <Card className="-pad border-none">
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Global commissions</div>
        <div className="text-xl font-black text-slate-900 mt-2">Persisted rate and split controls</div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Default commission rate</label>
            <div className="relative">
              <Input
                type="number"
                className="ui-input pr-10"
                value={ctrl.ratePct}
                onChange={(e) => ctrl.setRatePct(Number(e.target.value))}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-black">%</span>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
            <div className="text-sm font-black text-slate-800">Carrier remainder</div>
            <div className="text-2xl font-black text-brand-primary mt-2">{ctrl.derived.carrier.toFixed(1)}%</div>
            <div className="text-xs text-slate-500 font-bold mt-2">Computed from broker/MGA/wholesale splits.</div>
          </div>
        </div>

        <div className="mt-8 bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 text-xs font-black uppercase tracking-widest text-slate-400">
            Split components
          </div>
          <div className="p-6 space-y-4">
            {ctrl.components.map((component) => (
              <div key={component.id} className="flex items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div>
                  <div className="text-sm font-black text-slate-900">{component.name}</div>
                  <div className="text-xs text-slate-500 font-bold mt-1">{component.role}</div>
                </div>
                <div className="w-28 relative">
                  <Input
                    type="number"
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 pr-8 text-right font-black text-slate-900 focus:ring-2 focus:ring-brand-primary/20 outline-none"
                    value={component.percent}
                    onChange={(e) => ctrl.updateComponentPercent(component.id, Number(e.target.value))}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-black">%</span>
                </div>
              </div>
            ))}

            <div className={`text-center text-xs font-black uppercase tracking-widest ${ctrl.derived.splitValid ? 'text-brand-primary' : 'text-rose-600'}`}>
              Total commissions: {ctrl.derived.totalCommission.toFixed(1)}% • Carrier remainder: {ctrl.derived.carrier.toFixed(1)}%
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default FinancialRulesPage;
