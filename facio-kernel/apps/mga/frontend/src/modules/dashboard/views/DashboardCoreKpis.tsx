import React from 'react';
import { motion } from 'framer-motion';
import { DashboardCore } from '@/src/modules/dashboard/model/types';

type Props = {
  core?: DashboardCore;
  moneyEUR: (n: number) => string;
  pct: (n: number) => string;
  deltaPill: (d: number, kind: 'eur' | 'pct' | 'num') => React.ReactNode;
};

export function DashboardCoreKpis({ core, moneyEUR, pct, deltaPill }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
      <motion.div whileHover={{ y: -2 }} className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200 shadow-sm">
        <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.15em]">Written premium</p>
        <div className="mt-3 flex items-baseline justify-between gap-2 flex-wrap">
          <span className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">{moneyEUR(core?.writtenPremium || 0)}</span>
          {deltaPill(core?.deltas?.writtenPremium || 0, 'eur')}
        </div>
      </motion.div>

      <motion.div whileHover={{ y: -2 }} className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200 shadow-sm">
        <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.15em]">Incurred claims</p>
        <div className="mt-3 flex items-baseline justify-between gap-2 flex-wrap">
          <span className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">{moneyEUR(core?.incurredClaims || 0)}</span>
          {deltaPill(core?.deltas?.incurredClaims || 0, 'eur')}
        </div>
      </motion.div>

      <motion.div whileHover={{ y: -2 }} className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200 shadow-sm">
        <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.15em]">Loss ratio</p>
        <div className="mt-3 flex items-baseline justify-between gap-2 flex-wrap">
          {(() => {
            const ratio = Number(core?.lossRatio || 0);
            const pctVal = ratio * 100;
            const color = pctVal < 60
              ? 'text-emerald-600'
              : pctVal < 80
                ? 'text-amber-500'
                : 'text-rose-600';
            return (
              <span className={`text-2xl md:text-3xl font-black tracking-tight ${color}`}>
                {pct(ratio)}
              </span>
            );
          })()}
          {deltaPill(core?.deltas?.lossRatio || 0, 'pct')}
        </div>
      </motion.div>

      <motion.div whileHover={{ y: -2 }} className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200 shadow-sm">
        <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.15em]">Policies</p>
        <div className="mt-3 flex items-baseline justify-between gap-2 flex-wrap">
          <span className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">{Number(core?.policyCount || 0).toLocaleString()}</span>
          {deltaPill(core?.deltas?.policyCount || 0, 'num')}
        </div>
      </motion.div>
    </div>
  );
}
