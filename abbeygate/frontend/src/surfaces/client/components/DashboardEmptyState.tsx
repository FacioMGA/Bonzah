import React from 'react';

export function DashboardEmptyState() {
    return (
        <section className="space-y-4">
            <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">Policies</h2>
            <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
                <div className="text-base font-black text-slate-900">No policies yet</div>
                <div className="mt-2 text-sm font-semibold text-slate-600">
                    Start with a quote to see your wallet cards here.
                </div>
            </div>
        </section>
    );
}
