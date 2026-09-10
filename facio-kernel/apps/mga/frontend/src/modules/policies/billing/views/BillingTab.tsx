import React from 'react';
import { Button } from '@/src/shared/ui';
import { Copy, CreditCard, FileText, Undo2 } from 'lucide-react';
import {
  getPaymentProviderLabel,
  getPaymentTransactionStatusLabel,
  getPaymentTransactionTypeLabel,
  getReconciliationStatusLabel,
} from '@/src/modules/policies/model/policyDisplayLabels';

export function Billing(props: {
  selectedPortfolio: { id?: string } | null;
  billingSummary: {
    currency?: string;
    targetAmount?: number;
    paid?: number;
    refunded?: number;
    balance?: number;
    transactions?: Array<Record<string, unknown>>;
    reconciliation?: { lines?: Array<Record<string, unknown>> };
  } | null;
  billingLoading: boolean;
  onOpenCharge: (balance: number) => void;
  onOpenRefund: (balance: number, lastChargeId: string) => void;
  onToast: (message: string) => void;
}) {
  const {
    selectedPortfolio,
    billingSummary,
    billingLoading,
    onOpenCharge,
    onOpenRefund,
    onToast,
  } = props;

  return (
    <div className="space-y-8 max-w-6xl animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="space-y-8">
          <div className="h-0.5" />

          {(() => {
            const currency = String(billingSummary?.currency || 'EUR').toUpperCase();
            const curSym = currency === 'EUR' ? '€' : `${currency} `;
            const chargedRaw =
              (billingSummary as { charged?: number } | null)?.charged ?? billingSummary?.targetAmount ?? 0;
            const charged = Number(chargedRaw) || 0;
            const paid = Number(billingSummary?.paid || 0) || 0;
            const refunded = Number(billingSummary?.refunded || 0) || 0;
            const balance = Number(billingSummary?.balance || 0) || 0;
            const accountMode = String((billingSummary as { accountMode?: string } | null)?.accountMode || '').toLowerCase();

            const balanceState = balance > 0.005 ? 'due' : balance < -0.005 ? 'credit' : 'settled';
            const balanceText =
              balanceState === 'settled'
                ? 'Settled'
                : `${curSym}${Math.abs(balance).toFixed(2)} ${balanceState === 'due' ? 'Due' : 'Credit'}`;
            const balanceToneCls =
              balanceState === 'due'
                ? 'text-red-700'
                : balanceState === 'credit'
                  ? 'text-emerald-700'
                  : 'text-brand-primary';

            const txns: Array<Record<string, unknown>> = Array.isArray(billingSummary?.transactions)
              ? (billingSummary.transactions as Array<Record<string, unknown>>)
              : [];
            const recLines: Array<Record<string, unknown>> = Array.isArray(
              (billingSummary as { reconciliation?: { lines?: unknown[] } } | undefined)?.reconciliation?.lines
            )
              ? (((billingSummary as { reconciliation?: { lines?: unknown[] } }).reconciliation?.lines || []) as Array<Record<string, unknown>>)
              : [];
            const recIssues = recLines.filter((l) => {
              const st = String(l?.status || '').toUpperCase();
              return st === 'DISCREPANCY' || st === 'UNAPPLIED';
            });
            const successfulCharges = txns.filter(
              (t) =>
                String(t?.type || '').toLowerCase() === 'charge' &&
                ['PAID', 'CAPTURED', 'AUTHORIZED'].includes(String(t?.status || '').toUpperCase()),
            );
            const lastCharge = successfulCharges[0];
            const creditTxn = txns.find((t) => {
              const type = String(t?.type || '').toLowerCase();
              const status = String(t?.status || '').toUpperCase();
              return type === 'credit' || status === 'CREDIT_CREATED';
            });
            const creditAmount = Number(creditTxn?.amount || 0);
            const hasCreditToRefund = Boolean(creditTxn && creditAmount > 0);

            return (
              <>
                <div className="flex items-start justify-between gap-8 flex-wrap">
                  <div className="min-w-72">
                    <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Balance</div>
                    <div className={`text-3xl font-black ${balanceToneCls}`}>{balanceText}</div>
                    {accountMode === 'policy' && (
                      <div className="mt-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Policy account (lifetime)</div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-x-14 gap-y-3 text-xs text-slate-500 font-semibold">
                      <span className="inline-flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                        Charged {curSym}{charged.toFixed(2)}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <CreditCard className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                        Paid {curSym}{paid.toFixed(2)}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <Undo2 className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                        Refunded {curSym}{refunded.toFixed(2)}
                      </span>
                    </div>

                    {balanceState === 'credit' && (
                      <div className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-emerald-50 text-emerald-900 border border-emerald-200 text-xs font-black uppercase tracking-widest">
                        Refund due
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <Button
                      variant="primary"
                      size="lg"
                      className="gap-2 min-w-40 justify-center"
                      onClick={() => onOpenCharge(balance)}
                    >
                      <CreditCard className="h-4 w-4" aria-hidden />
                      Charge
                    </Button>

                    {Boolean(lastCharge?.id) && (
                      <Button
                        variant="secondary"
                        size="lg"
                        className="gap-2 min-w-40 justify-center"
                        onClick={() => onOpenRefund(balance, String(lastCharge?.id || ''))}
                      >
                        <Undo2 className="h-4 w-4" aria-hidden />
                        Refund
                      </Button>
                    )}
                  </div>
                </div>

                {recIssues.length > 0 && (
                  <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50/70 px-8 py-6">
                    <div className="flex items-start justify-between gap-6 flex-wrap">
                      <div>
                        <div className="text-xs font-black text-amber-800 uppercase tracking-widest">Reconciliation signals</div>
                        <div className="mt-2 text-sm font-extrabold text-slate-900">
                          {recIssues.length} item{recIssues.length === 1 ? '' : 's'} need attention
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-600">
                          Imported bank/card entries that are unmatched or mismatched for this policy.
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="lg"
                        onClick={() => {
                          try {
                            const pid = String(selectedPortfolio?.id || '');
                            window.location.href = `/billing?policyId=${encodeURIComponent(pid)}`;
                          } catch {
                            // ignore
                          }
                        }}
                      >
                        Open reconciliation
                      </Button>
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                      {recIssues.slice(0, 6).map((l) => {
                        const dt = l?.paymentDate ? new Date(String(l.paymentDate)) : null;
                        const amt = Number(l?.paymentAmount || 0) || 0;
                        const st = String(l?.status || '').toUpperCase();
                        return (
                          <div key={String(l?.id)} className="rounded-2xl bg-white/70 border border-amber-200/60 px-5 py-4">
                            <div className="flex items-center justify-between gap-4">
                              <div className="text-xs font-black text-slate-900">{getReconciliationStatusLabel(st)}</div>
                              <div className="text-xs font-black tabular-nums text-slate-900">{curSym}{Math.abs(amt).toFixed(2)}</div>
                            </div>
                            <div className="mt-1 text-xs font-semibold text-slate-600 truncate">
                              {String(l?.paymentReference || l?.payer || '—')}
                            </div>
                            <div className="mt-1 text-xs font-semibold text-slate-500">
                              {dt && !Number.isNaN(dt.getTime()) ? dt.toLocaleString() : '—'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {hasCreditToRefund && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">Credit available</div>
                      <div className="text-sm font-extrabold text-emerald-900 mt-1">
                        {curSym}{Math.abs(creditAmount).toFixed(2)} ready for manual refund
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="md"
                      className="gap-2"
                      onClick={() => onOpenRefund(-Math.abs(creditAmount), String(lastCharge?.id || ''))}
                      disabled={!Boolean(lastCharge?.id)}
                    >
                      Refund credit
                    </Button>
                  </div>
                )}

                <div className="ui-table-wrap">
                  <div className="px-10 py-6 bg-slate-50/60 border-b border-slate-200/60 flex items-center justify-between gap-4 flex-wrap">
                    <div className="text-xs font-black text-slate-600 uppercase tracking-widest">Transactions</div>
                    <div className="text-xs font-bold text-slate-400">{billingLoading ? 'Loading…' : `${txns.length} items`}</div>
                  </div>
                  <div className="overflow-auto">
                    <table className="ui-table min-w-full">
                      <thead className="ui-thead">
                        <tr>
                          <th className="px-6 py-6 w-col84">#</th>
                          <th className="px-10 py-6 w-col220 whitespace-nowrap">Date</th>
                          <th className="px-10 py-6">Type</th>
                          <th className="px-10 py-6">Provider</th>
                          <th className="px-10 py-6">Status</th>
                          <th className="px-10 py-6">Details</th>
                          <th className="px-10 py-6 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="ui-tbody text-sm">
                        {!billingLoading && txns.length === 0 && (
                          <tr className="ui-row bg-white/0">
                            <td className="px-10 py-10 text-slate-500 font-semibold" colSpan={7}>
                              No transactions yet.
                            </td>
                          </tr>
                        )}
                        {txns.map((t) => {
                          const amt = Number(t?.amount || 0) || 0;
                          const isNeg = amt < 0;
                          const dt = t?.date ? new Date(String(t.date)) : null;
                          const st = String(t?.status || '').toUpperCase();
                          const isOk = ['PAID', 'CAPTURED', 'AUTHORIZED'].includes(st);
                          const isFail = ['FAILED', 'CANCELLED'].includes(st);
                          const typeLabel = getPaymentTransactionTypeLabel(String(t?.type || ''));
                          const isRefundTxn = typeLabel.toLowerCase() === 'refund' || isNeg;
                          const statusCls = isOk
                            ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                            : isFail
                              ? 'bg-red-50 text-red-900 border border-red-200'
                              : 'bg-amber-50 text-amber-900 border border-amber-200';
                          const amountCls =
                            isRefundTxn
                              ? 'text-red-700'
                              : isOk
                                ? 'text-emerald-800'
                                : isFail
                                  ? 'text-red-800'
                                  : 'text-slate-900';
                          const ref = String(t?.reference || '').trim();
                          const formatEuroSmart = (d: Date) => {
                            const parts = new Intl.DateTimeFormat('en-GB', {
                              year: 'numeric',
                              month: 'short',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            }).formatToParts(d);
                            const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
                            const month = get('month');
                            const day = get('day');
                            const year = get('year');
                            const hour = get('hour');
                            const minute = get('minute');
                            return `${month} ${day}, ${year}, ${hour}:${minute}`;
                          };
                          const dtText = dt && !Number.isNaN(dt.getTime()) ? formatEuroSmart(dt) : '—';
                          return (
                            <tr key={String(t?.id || t?.reference || Math.random())} className="ui-row bg-white/0">
                              <td className="px-6 py-6 w-col84">
                                <div className="relative inline-flex group">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="inline-flex items-center justify-center h-10 w-10 rounded-2xl border border-slate-200/60 bg-white/60 hover:bg-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                                    onClick={async () => {
                                      if (!ref) return;
                                      try {
                                        await navigator.clipboard.writeText(ref);
                                        onToast('Copied');
                                      } catch {
                                        onToast('Copy failed');
                                      }
                                    }}
                                    disabled={!ref}
                                    aria-label="Copy reference"
                                  >
                                    <Copy className="h-4 w-4 text-slate-700" aria-hidden />
                                  </Button>
                                  {ref && (
                                    <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-2 -translate-y-full opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20">
                                      <div className="rounded-xl bg-slate-900 text-white text-[11px] font-semibold px-3 py-2 shadow-lg whitespace-nowrap">
                                        {ref}
                                      </div>
                                      <div className="mx-auto w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-slate-900" />
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-10 py-6 w-col220 whitespace-nowrap text-slate-700 font-semibold">{dtText}</td>
                              <td className="px-10 py-6 text-slate-700 font-semibold">{typeLabel}</td>
                              <td className="px-10 py-6 text-slate-700 font-semibold">{getPaymentProviderLabel(String(t?.provider || ''))}</td>
                              <td className="px-10 py-6">
                                <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-2xl text-xs font-black uppercase tracking-widest ${statusCls}`}>
                                  {getPaymentTransactionStatusLabel(st)}
                                </div>
                              </td>
                              <td className="px-10 py-6 text-slate-500 font-medium text-xs">
                                {String(t?.details || '') || '—'}
                              </td>
                              <td className={`px-10 py-6 text-right font-black tabular-nums ${amountCls}`}>
                                {curSym}{Math.abs(amt).toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            );
          })()}
      </div>
    </div>
  );
}

