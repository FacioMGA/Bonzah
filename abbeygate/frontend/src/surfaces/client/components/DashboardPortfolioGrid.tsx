/**
 * DashboardPortfolioGrid — multi-policy card grid.
 * Consumes only DashboardPolicyVM.
 */
import React from 'react';
import { Button } from '@/src/shared/ui';
import { ShieldCheck } from 'lucide-react';
import { formatDateUI } from '@/src/shared/lib/format';
import type { DashboardPolicyVM } from '../types/dashboard.contract';

interface Props {
    policies: DashboardPolicyVM[];
    onSelect: (policyId: string) => void;
}

export function DashboardPortfolioGrid({ policies, onSelect }: Props) {
    return (
        <div className="space-y-4">
            <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">Your Active Portfolio</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {policies.map((policy) => (
                    <article key={policy.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                        <div className="text-xl font-black text-slate-900">{policy.vehicleTitle}</div>
                        <div className="text-sm font-semibold text-slate-500">{policy.registration}</div>
                        <div className="text-sm font-semibold text-slate-600">
                            {policy.coverType} · Renews {formatDateUI(policy.endDate)}
                        </div>
                        <div className="inline-flex items-center gap-2 text-sm font-black text-emerald-700">
                            <ShieldCheck className="w-4 h-4" />
                            <span>{policy.statusMeta.title}</span>
                        </div>
                        <Button className="w-full" onClick={() => onSelect(policy.key)}>
                            Manage policy
                        </Button>
                    </article>
                ))}
            </div>
        </div>
    );
}
