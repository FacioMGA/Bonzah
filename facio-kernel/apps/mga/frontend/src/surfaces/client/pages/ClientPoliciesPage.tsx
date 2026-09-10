import React from 'react';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/shared/ui';
import { formatCompanyName, formatDateRangeUI, formatMoneyUI } from '@/src/shared/lib/format';
import { humanizePolicyStatus } from '@/src/modules/policies/model/policyDisplayLabels';

import { useClientPoliciesController } from '../controller/useClientPoliciesController';

export default function ClientPoliciesPage() {
  const ctrl = useClientPoliciesController();

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-10">
      <PageHeader
        title="Policies"
        subtitle="Active and historical policies."
        actions={(<Button variant="secondary" size="lg" onClick={ctrl.goToQuotes}>View quotes</Button>)}
      />

      <div className="flex items-center gap-6">
        <div className="relative flex-1">
          <svg className="absolute left-6 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <Input className="ui-input rounded-3xl pl-16 pr-6 py-4 text-base font-bold" placeholder="Search policies…" value={ctrl.q} onChange={(e) => ctrl.setQ(e.target.value)} />
        </div>
      </div>

      <div className="ui-table-wrap">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-10">Policy #</TableHead>
              <TableHead>Insured</TableHead>
              <TableHead>Effective</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Premium</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ctrl.loading ? (
              <TableRow><TableCell colSpan={5} className="text-center text-slate-400 font-medium">Loading…</TableCell></TableRow>
            ) : ctrl.filtered.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-slate-400 font-medium">No policies found.</TableCell></TableRow>
            ) : (
              ctrl.filtered.map((r) => {
                const key = String(r.status || '').toUpperCase().replace(/\s+/g, '_');
                const statusCls =
                  key === 'ACTIVE' ? 'bg-brand-primary/10 text-brand-primary'
                    : key === 'ISSUED' ? 'bg-sky-100/70 text-sky-900'
                      : key === 'EXPIRED' ? 'bg-rose-100/70 text-rose-900'
                        : 'bg-slate-100 text-slate-700';
                return (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => ctrl.goToPolicy(String(r.id))}>
                    <TableCell className="pl-10 font-black text-brand-primary text-xs tracking-tight">{String(r.policyNumber || r.id).toUpperCase()}</TableCell>
                    <TableCell className="font-extrabold text-slate-800">{formatCompanyName(r.insuredName || r.name || '—')}</TableCell>
                    <TableCell className="text-sm font-semibold text-slate-500">{formatDateRangeUI(r.startDate || r.start, r.endDate || r.end)}</TableCell>
                    <TableCell><span className={`px-3 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${statusCls}`}>{humanizePolicyStatus(String(r.status || ''))}</span></TableCell>
                    <TableCell className="text-right font-black text-slate-900">{formatMoneyUI(r.totalPremium || r.premium || 0, 'USD')}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {ctrl.hasMore && !ctrl.loading && (
        <div className="px-8 py-4 text-center">
          <Button onClick={ctrl.loadMore} variant="secondary" disabled={ctrl.loadingMore}>{ctrl.loadingMore ? 'Loading…' : 'Load more'}</Button>
        </div>
      )}
    </div>
  );
}
