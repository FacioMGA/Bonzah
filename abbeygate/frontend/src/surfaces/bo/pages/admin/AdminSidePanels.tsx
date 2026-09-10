import React from 'react';
import { formatDateUI } from '@/src/shared/lib/format';
import type { AuditEntry, RolePreset } from './admin.types';

type Props = {
  rolePresets: RolePreset[];
  audit: AuditEntry[];
};

export function AdminSidePanels({ rolePresets, audit }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-xl font-black text-slate-900 tracking-tight">Roles & permissions (presets)</h2>
        </div>
        <div className="p-6 space-y-6">
          {rolePresets.map((preset) => (
            <div key={preset.name} className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-sm font-black text-slate-900">{preset.name}</div>
              <ul className="mt-2 space-y-1 text-sm text-slate-600 font-medium list-disc list-inside">
                {preset.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-xl font-black text-slate-900 tracking-tight">Audit trail</h2>
        </div>
        <div className="p-6 space-y-3">
          {audit.map((entry, idx) => (
            <div key={idx} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div className="text-xs font-black text-slate-700 uppercase tracking-widest">{entry.action}</div>
              <div className="text-sm text-slate-700 font-medium mt-1">{entry.detail}</div>
              <div className="text-[11px] text-slate-500 mt-2">
                {formatDateUI(entry.at, { withTime: true })} • <span className="font-bold">{entry.actor}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
