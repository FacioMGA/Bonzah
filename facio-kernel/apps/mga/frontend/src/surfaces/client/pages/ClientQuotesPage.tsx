import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/shared/ui';
import { clientPortalClient as api } from '@/src/surfaces/client/api/clientPortalClient';
import { formatDateUI, formatMoneyUI, formatCompanyName } from '@/src/shared/lib/format';
import { humanizePolicyStatus } from '@/src/modules/policies/model/policyDisplayLabels';
import { ClientQuoteEntryPanel } from '../components/ClientQuoteEntryPanel';

type ClientQuoteRow = {
  id?: string;
  policyId?: string;
  policyNumber?: string;
  insuredName?: string;
  name?: string;
  status?: string;
  totalPremium?: number;
  premium?: number;
  startDate?: string;
  inceptionDate?: string;
  start?: string;
  policy?: { inceptionDate?: string };
};

export default function ClientQuotesPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rows, setRows] = useState<ClientQuoteRow[]>([]);
  const [q, setQ] = useState('');

  const PAGE_SIZE = 25;
  const STATUS_IN = ['DRAFT', 'INTAKE', 'QUOTE_CREATED', 'QUOTE CREATED', 'QUOTE_SENT', 'QUOTE SENT', 'REFERRAL', 'INFO_REQUIRED', 'QUOTED', 'AWAITING_PAYMENT', 'QUOTE'];
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const loadSeqRef = useRef(0);

  const [qDebounced, setQDebounced] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const loadPage = async (p: number, opts?: { replace?: boolean }) => {
    const replace = Boolean(opts?.replace);
    const seq = ++loadSeqRef.current;
    if (p === 1 || replace) setLoading(true);
    else setLoadingMore(true);

    try {
      const res = await api.listPolicies({
        page: p,
        pageSize: PAGE_SIZE,
        statusIn: STATUS_IN,
        q: qDebounced || undefined,
        projection: 'compact',
      });
      if (seq !== loadSeqRef.current) return;

      const policies = res?.success && res?.data ? (Array.isArray(res.data) ? res.data : []) : [];
      const incoming = policies
        .map((it) => {
          const row = (it || {}) as ClientQuoteRow;
          return { ...row, id: row.id || row.policyId };
        })
        .filter((it) => Boolean(it?.id));

      setRows((prev) => {
        const base = (p === 1 || replace) ? [] : (Array.isArray(prev) ? prev : []);
        const combined = [...base, ...incoming];
        const seen = new Set<string>();
        return combined.filter((r) => {
          const id = String(r?.id || '');
          if (!id) return false;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
      });

      const pagination = (res as { pagination?: { page?: number; totalPages?: number } }).pagination;
      if (pagination && typeof pagination.page === 'number' && typeof pagination.totalPages === 'number') {
        setHasMore(pagination.page < pagination.totalPages);
      } else {
        setHasMore(incoming.length === PAGE_SIZE);
      }
      setPage(p);
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    setRows([]);
    setPage(1);
    setHasMore(true);
    void loadPage(1, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDebounced]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => String(r.insuredName || r.name || r.policyNumber || r.id || '').toLowerCase().includes(s));
  }, [rows, q]);

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-10">
      <PageHeader
        title="Quotes"
        subtitle="Review, approve and bind quotes."
        actions={(
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => navigate('/quote/start')}>
              Get a quote
            </Button>
            <Button variant="secondary" size="lg" onClick={() => navigate('/client/policies')}>
              View policies
            </Button>
          </div>
        )}
      />

      <ClientQuoteEntryPanel />

      <div className="flex items-center gap-6">
        <div className="relative flex-1">
          <svg className="absolute left-6 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <Input
            className="ui-input rounded-3xl pl-16 pr-6 py-4 text-base font-bold"
            placeholder="Search quotes…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="ui-table-wrap">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-10">Quote ID</TableHead>
              <TableHead>Insured</TableHead>
              <TableHead>Program</TableHead>
              <TableHead>Effective</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Est. premium</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-slate-400 font-medium">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-slate-400 font-medium">No quotes found.</TableCell></TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/client/quotes/${r.id}`)}>
                  <TableCell className="pl-10 font-black text-brand-primary text-xs tracking-tight">
                    {String(r.policyNumber || r.id).toUpperCase()}
                  </TableCell>
                  <TableCell className="font-extrabold text-slate-800">{formatCompanyName(r.insuredName || r.name || '—')}</TableCell>
                  <TableCell className="text-sm font-semibold text-slate-600">Auto Insurance</TableCell>
                  <TableCell className="text-sm font-semibold text-slate-500">
                    {formatDateUI(r.startDate || r.policy?.inceptionDate || r.inceptionDate || r.start || '—')}
                  </TableCell>
                  <TableCell>
                    <span className="px-3 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-amber-100/70 text-amber-900">
                      {humanizePolicyStatus(String(r.status || 'PENDING'))}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-black text-slate-900">
                    {formatMoneyUI(r.totalPremium || r.premium || 0, 'USD')}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {hasMore && !loading && (
        <div className="px-8 py-4 text-center">
          <Button onClick={() => loadPage(page + 1)} variant="secondary" disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
