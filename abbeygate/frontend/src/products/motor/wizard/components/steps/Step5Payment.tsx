import { useMemo } from 'react';
import { PaymentStep } from '@/src/shared/lib/wizard';
import type { QuoteResponse } from '../../types';

/**
 * Motor's payment step is a **thin adapter** over the canonical
 * `PaymentStep` (`shared/lib/wizard/steps/PaymentStep.tsx`). It maps the
 * motor `QuoteResponse` into the generic `summary` shape (amount + currency
 * + breakdown lines + selected option label) and delegates the entire
 * checkout / status / readiness lifecycle to the canonical step.
 *
 * Per `docs/architecture/contracts/canonical-ownership.md`:
 *  - Wizard payment-step UI has exactly one canonical implementation.
 *  - Product-specific PaymentStep variants are forbidden.
 *  - The motor breakdown (Base premium, MIF, online discount, windscreen,
 *    addOnRows from calculationTrace) is *display-only* and lives here.
 */

interface Step5Props {
  quote: QuoteResponse;
  policyId?: string;
  selectedOptionName?: string;
  onBack: () => void;
  onSubmit: (result: {
    status: 'paid' | 'failed';
    issued?: boolean;
    blockers?: Array<{ code: string; message: string }>;
    reference?: string;
  }) => void | Promise<void>;
}

type BreakdownLine = { label: string; amount: number; included?: boolean };

function deriveMotorBreakdown(quote: QuoteResponse): BreakdownLine[] {
  const primary = quote.primaryOption;
  const cost = primary.costDetails;
  const grossPremium = cost?.grossPremium ?? 0;
  const ncdAmount = cost?.ncdAmount ?? 0;
  const basePremium = cost ? grossPremium - ncdAmount : primary.annualPremium;
  const mifSurcharge = cost?.mifSurcharge ?? 0;
  const onlineDiscount = cost?.onlineDiscount ?? 0;

  // ABY-265 — windscreen presence is now signalled by the canonical
  // `coverage.windscreen` step (emitted whenever CV 24 is applied,
  // regardless of amount). When the step exists with `amount === 0`,
  // the line renders as "Included" (the cover is part of the core
  // Comprehensive premium per Peter's directive). When the step
  // carries a positive amount (legacy snapshots or any future
  // per-program override), it still appears as a priced add-on.
  const windscreenStep = (primary.calculationTrace?.steps || []).find(
    (step) => String(step.id || '') === 'coverage.windscreen',
  );
  const windscreenAmount = windscreenStep ? Number(windscreenStep.amount || 0) : 0;
  const windscreenApplied = Boolean(windscreenStep);

  const addOnRows: BreakdownLine[] = (primary.calculationTrace?.steps || [])
    .filter((step) => String(step.id || '').startsWith('endorsement.premium.'))
    .map((step) => ({
      id: String(step.id || ''),
      label: String(step.name || '').trim() || 'Add-on',
      amount: Number(step.amount || 0),
    }))
    .filter((row) =>
      Number.isFinite(row.amount)
      && row.amount > 0
      // CV 24 is already accounted for elsewhere in the breakdown; windscreen
      // gets its own dedicated row below.
      && row.id.trim().toUpperCase() !== 'ENDORSEMENT.PREMIUM.CV 24'
      && row.label.trim().toUpperCase() !== 'WINDSCREEN',
    )
    .map(({ label, amount }) => ({ label, amount }));

  const lines: BreakdownLine[] = [{ label: 'Base Premium', amount: basePremium }];
  for (const row of addOnRows) lines.push(row);
  if (windscreenApplied) {
    lines.push({
      label: 'Windscreen Cover',
      amount: windscreenAmount,
      included: windscreenAmount === 0,
    });
  }
  lines.push({ label: 'MIF surcharge', amount: mifSurcharge });
  if (onlineDiscount > 0) lines.push({ label: 'Online Discount', amount: -onlineDiscount });
  return lines;
}

export function Step5Payment({ quote, policyId, selectedOptionName, onBack, onSubmit }: Step5Props) {
  const summary = useMemo(() => {
    const totalPayable = quote.primaryOption.costDetails?.totalPremium ?? quote.primaryOption.annualPremium;
    return {
      amount: Number(totalPayable || 0),
      currency: String(quote.currency || 'EUR'),
      breakdownLines: deriveMotorBreakdown(quote),
      selectedOptionName: selectedOptionName || undefined,
    };
  }, [quote, selectedOptionName]);

  return (
    <PaymentStep
      productCode="motor"
      publicSessionToken={String(policyId || '')}
      summary={summary}
      onBack={onBack}
      onSubmit={onSubmit}
    />
  );
}
