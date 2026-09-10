import React from 'react';
import { AmountCell } from './AmountCell';
import { asRecord } from '@/src/shared/lib/record';

type PricingStep = { id?: string; name?: string; notes?: string; amount?: number };

type PremiumTotalsRowsProps = {
  cost?: Record<string, unknown>;
  feeSteps: PricingStep[];
  addOnTotal: number;
  getLimitText: (code: string) => string;
  fmt: (n: number) => string;
  currency: string;
  totalPremium?: unknown;
};

export function PremiumTotalsRows({
  cost,
  feeSteps,
  addOnTotal,
  getLimitText,
  fmt,
  currency,
  totalPremium,
}: PremiumTotalsRowsProps) {
  return (
    <>
      <tr className="bg-slate-50/60">
        <td className="px-10 py-6 font-black text-slate-900">Subtotal (Net Premium)</td>
        <td className="px-10 py-6 text-slate-600 font-semibold">After base discounts + adjustment (excludes add-ons)</td>
        <td className="px-10 py-6 text-slate-500 font-semibold">—</td>
        <td className="px-10 py-6"><AmountCell n={Number(cost?.subtotalNetPremium || 0)} currency={currency} /></td>
      </tr>

      {Number(asRecord(cost).tax || 0) > 0 && (
        <tr className="ui-row bg-white/0">
          <td className="px-10 py-6 font-black text-slate-900">Tax</td>
          <td className="px-10 py-6 text-slate-600 font-semibold">As calculated</td>
          <td className="px-10 py-6 text-slate-500 font-semibold">—</td>
          <td className="px-10 py-6"><AmountCell n={Number(asRecord(cost).tax || 0)} currency={currency} /></td>
        </tr>
      )}
      {Number(asRecord(cost).mifSurcharge || 0) > 0 && (
        <tr className="ui-row bg-white/0">
          <td className="px-10 py-6 font-black text-slate-900">MIF surcharge</td>
          <td className="px-10 py-6 text-slate-600 font-semibold">Insurance levy / MIF</td>
          <td className="px-10 py-6 text-slate-500 font-semibold">—</td>
          <td className="px-10 py-6"><AmountCell n={Number(asRecord(cost).mifSurcharge || 0)} currency={currency} /></td>
        </tr>
      )}
      {Number(asRecord(cost).stampDuty || 0) > 0 && (
        <tr className="ui-row bg-white/0">
          <td className="px-10 py-6 font-black text-slate-900">Stamp duty</td>
          <td className="px-10 py-6 text-slate-600 font-semibold">Government charge</td>
          <td className="px-10 py-6 text-slate-500 font-semibold">—</td>
          <td className="px-10 py-6"><AmountCell n={Number(asRecord(cost).stampDuty || 0)} currency={currency} /></td>
        </tr>
      )}
      {Number(asRecord(cost).policyFee || 0) > 0 && (
        <tr className="ui-row bg-white/0">
          <td className="px-10 py-6 font-black text-slate-900">Policy fee</td>
          <td className="px-10 py-6 text-slate-600 font-semibold">Administration charge</td>
          <td className="px-10 py-6 text-slate-500 font-semibold">—</td>
          <td className="px-10 py-6"><AmountCell n={Number(asRecord(cost).policyFee || 0)} currency={currency} /></td>
        </tr>
      )}

      {feeSteps.map((s) => {
        const code = String(s.id || '').replace('endorsement.premium.', '');
        const label = String(s.name || code || 'Endorsement');
        const basis = String(s.notes || '').replace(/^Basis:\s*/i, '').trim() || 'As per product';
        const amt = Number(s.amount || 0);
        return (
          <tr key={s.id} className="ui-row bg-white/0">
            <td className="px-10 py-6 font-black text-slate-900">{label}</td>
            <td className="px-10 py-6 text-slate-600 font-semibold">{basis}</td>
            <td className="px-10 py-6 text-slate-500 font-semibold">{getLimitText(code)}</td>
            <td className="px-10 py-6"><AmountCell n={amt} currency={currency} /></td>
          </tr>
        );
      })}
      {addOnTotal > 0 && (
        <tr className="bg-slate-50/60">
          <td className="px-10 py-6 font-black text-slate-900">Add-ons total</td>
          <td className="px-10 py-6 text-slate-600 font-semibold">Applied after base premium discounts</td>
          <td className="px-10 py-6 text-slate-500 font-semibold">—</td>
          <td className="px-10 py-6"><AmountCell n={addOnTotal} currency={currency} /></td>
        </tr>
      )}

      <tr className="bg-brand-primary/10 border-t-2 border-brand-primary/25">
        <td className="px-10 py-6 font-black text-slate-900 text-[15px] uppercase">Total premium (payable)</td>
        <td className="px-10 py-6 text-slate-600 font-semibold">Net + charges</td>
        <td className="px-10 py-6 text-slate-500 font-semibold">—</td>
        <td className="px-10 py-6">
          <div className="text-right font-black tabular-nums text-brand-primary text-lg whitespace-nowrap">
            {currency} {totalPremium === undefined || totalPremium === null ? '—' : fmt(Number(totalPremium))}
          </div>
        </td>
      </tr>
    </>
  );
}
