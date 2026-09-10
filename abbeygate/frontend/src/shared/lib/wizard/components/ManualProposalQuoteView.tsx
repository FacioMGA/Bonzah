import React from 'react';
import { CheckCircle2, FileText, ShieldCheck } from 'lucide-react';
import { Button } from '@/src/shared/ui';
import { asRecord, type UnknownRecord } from '@/src/shared/lib/record';
import { PaymentStep } from '../steps/PaymentStep';

type ManualProposalQuoteViewProps = {
  quoteData: UnknownRecord;
  quoteResponse?: UnknownRecord | null;
  productLabel: string;
  currency?: string;
  productCode?: string;
  publicSessionToken?: string;
};

function rowsFromProposal(quoteData: UnknownRecord): UnknownRecord[] {
  const rows = asRecord(quoteData.proposal).coverageRows;
  return Array.isArray(rows) ? rows.map(asRecord) : [];
}

function money(value: unknown, currency: string): string {
  const n = Number(String(value || '').replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function text(value: unknown): string {
  return String(value || '').trim();
}

function totalPremium(quoteData: UnknownRecord, quoteResponse: UnknownRecord): number {
  const manualPremium = Number(quoteData.manualPremium || 0);
  if (Number.isFinite(manualPremium) && manualPremium > 0) return manualPremium;
  const primary = asRecord(quoteResponse.primaryOption);
  const quoted = Number(primary.annualPremium || primary.totalPremium || 0);
  if (Number.isFinite(quoted) && quoted > 0) return quoted;
  return rowsFromProposal(quoteData).reduce((sum, row) => {
    const premium = Number(String(row.premium || '').replace(/,/g, ''));
    return Number.isFinite(premium) ? sum + premium : sum;
  }, 0);
}

function paymentBreakdownLines(quoteData: UnknownRecord): Array<{ label: string; amount: number }> {
  return rowsFromProposal(quoteData)
    .map((row) => ({
      label: text(row.coverage) || 'Coverage',
      amount: Number(String(row.premium || '').replace(/,/g, '')),
    }))
    .filter((line) => Number.isFinite(line.amount) && line.amount > 0);
}

function proposerName(quoteData: UnknownRecord): string {
  const proposer = asRecord(quoteData.proposer);
  return [proposer.firstName, proposer.lastName].map((part) => text(part)).filter(Boolean).join(' ') || text(proposer.name) || 'Client';
}

export function ManualProposalQuoteView(props: ManualProposalQuoteViewProps) {
  const { quoteData, productLabel, currency = 'EUR' } = props;
  const [accepted, setAccepted] = React.useState(false);
  const [showPayment, setShowPayment] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    const sp = new URLSearchParams(window.location.search);
    return sp.get('step') === 'payment' || sp.has('id') || sp.has('resourcePath') || sp.has('result');
  });
  const [terminal, setTerminal] = React.useState<{ status: 'paid' | 'failed'; issued?: boolean } | null>(null);
  const quoteResponse = asRecord(props.quoteResponse);
  const proposal = asRecord(quoteData.proposal);
  const rows = rowsFromProposal(quoteData);
  const premium = totalPremium(quoteData, quoteResponse);
  const reference = text(quoteResponse.reference) || text(quoteResponse.quoteReference) || text(quoteData.reference);
  const termsNotes = text(proposal.termsNotes);
  const subjectivities = text(proposal.subjectivities);
  const canPay = Boolean(props.productCode && props.publicSessionToken && premium > 0);

  if (terminal) {
    const paid = terminal.status === 'paid';
    return (
      <div className="brand-flow min-h-screen overflow-x-hidden bg-white text-black font-sans">
        <main className="mx-auto flex min-h-screen max-w-3xl items-center px-5 py-10">
          <div className="w-full rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h1 className="mt-5 text-3xl font-black tracking-tight text-slate-900">
              {paid ? 'Payment received' : 'Payment could not be completed'}
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm font-semibold leading-6 text-slate-500">
              {paid
                ? 'Thank you. Abbeygate is issuing your policy from the approved proposal. Your documents will follow shortly.'
                : 'Your proposal has not been paid yet. Please try again or contact Abbeygate if the problem continues.'}
            </p>
            {reference && <div className="mt-6 text-xs font-black uppercase tracking-widest text-slate-400">Reference {reference}</div>}
          </div>
        </main>
      </div>
    );
  }

  if (showPayment && canPay) {
    return (
      <div className="brand-flow min-h-screen overflow-x-hidden bg-white text-black font-sans">
        <header className="border-b border-slate-100 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
            <div className="font-black text-brand-primary">Abbeygate Insurance</div>
            <div className="text-xs font-black uppercase tracking-widest text-slate-400">Secure payment</div>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-5 py-10">
          <PaymentStep
            productCode={props.productCode || ''}
            publicSessionToken={props.publicSessionToken || ''}
            summary={{
              amount: premium,
              currency,
              breakdownLines: paymentBreakdownLines(quoteData),
              selectedOptionName: `${productLabel} proposal`,
            }}
            onBack={() => setShowPayment(false)}
            onSubmit={(result) => setTerminal({ status: result.status, issued: result.issued })}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="brand-flow min-h-screen overflow-x-hidden bg-white text-black font-sans">
      <header className="border-b border-slate-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="font-black text-brand-primary">Abbeygate Insurance</div>
          <div className="text-xs font-black uppercase tracking-widest text-slate-400">Proposal</div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="space-y-6">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-widest text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Ready to review
              </div>
              <h1 className="mt-5 text-3xl font-black tracking-tight text-slate-900">
                Your {productLabel} proposal
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
                Hi {proposerName(quoteData)}, Abbeygate has prepared your proposal. Please review the cover, limits, excesses and premium below.
              </p>
            </div>

            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-6 py-4">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">Coverage and pricing</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-widest text-slate-400">
                    <tr>
                      <th className="px-6 py-4">Coverage</th>
                      <th className="px-6 py-4">Limit</th>
                      <th className="px-6 py-4">Excess</th>
                      <th className="px-6 py-4 text-right">Premium</th>
                      <th className="px-6 py-4">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.length === 0 ? (
                      <tr>
                        <td className="px-6 py-8 text-center font-semibold text-slate-400" colSpan={5}>
                          Your proposal details are being prepared.
                        </td>
                      </tr>
                    ) : rows.map((row, index) => (
                      <tr key={index}>
                        <td className="px-6 py-5 font-black text-slate-900">{text(row.coverage) || 'Coverage'}</td>
                        <td className="px-6 py-5 font-semibold text-slate-600">{text(row.limit) || '—'}</td>
                        <td className="px-6 py-5 font-semibold text-slate-600">{text(row.excess) || '—'}</td>
                        <td className="px-6 py-5 text-right font-black tabular-nums text-slate-900">{money(row.premium, currency)}</td>
                        <td className="px-6 py-5 font-semibold text-slate-500">{text(row.notes) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {(termsNotes || subjectivities) && (
              <div className="grid gap-4 md:grid-cols-2">
                {termsNotes && (
                  <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-400">
                      <FileText className="h-4 w-4" />
                      Terms notes
                    </div>
                    <p className="whitespace-pre-line text-sm font-semibold leading-6 text-slate-600">{termsNotes}</p>
                  </div>
                )}
                {subjectivities && (
                  <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-400">
                      <ShieldCheck className="h-4 w-4" />
                      Subjectivities
                    </div>
                    <p className="whitespace-pre-line text-sm font-semibold leading-6 text-slate-600">{subjectivities}</p>
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">Total premium</div>
              <div className="mt-2 text-3xl font-black tabular-nums text-brand-primary">{money(premium, currency)}</div>
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 text-sm">
                {reference && (
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-semibold text-slate-400">Reference</span>
                    <span className="font-black text-slate-900">{reference}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4">
                  <span className="font-semibold text-slate-400">Market</span>
                  <span className="text-right font-black text-slate-900">{text(proposal.marketName) || 'Abbeygate'}</span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-blue-100 bg-blue-50 p-5 text-sm font-semibold leading-6 text-slate-700">
              Cover starts only after you approve this proposal, complete payment, and Abbeygate issues confirmation.
            </div>

            <label className="flex items-start gap-3 rounded-3xl border border-slate-200 bg-white p-5 text-sm font-semibold leading-6 text-slate-600 shadow-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              <span>I accept this proposal, including the cover, limits, excesses, premium, terms notes and subjectivities shown above.</span>
            </label>

            <Button
              className="w-full"
              disabled={!accepted || !canPay}
              onClick={() => setShowPayment(true)}
            >
              Approve and pay
            </Button>
            {!canPay && (
              <div className="text-center text-xs font-semibold text-slate-400">
                Payment is available once Abbeygate has finalized the premium.
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
