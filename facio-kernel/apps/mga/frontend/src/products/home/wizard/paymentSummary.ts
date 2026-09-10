import { asRecord } from '@/src/shared/lib/record';

/** Display the retained quote amounts; the payment gate and rating engine own eligibility and price. */
export function homePaymentSummary(quoteResponse: unknown) {
  const primary = asRecord(asRecord(quoteResponse).primaryOption);
  const breakdown = asRecord(primary.breakdown);
  const assistanceFee = Number(breakdown.europAssistanceFee || 0);
  return {
    amount: Number(primary.annualPremium || 0),
    currency: 'EUR',
    breakdownLines: [
      { label: 'Net premium', amount: Number(breakdown.netPremium || 0) },
      { label: 'IPT', amount: Number(breakdown.iptAmount || 0) },
      { label: 'Admin fee', amount: Number(breakdown.adminFee || 0) },
      ...(assistanceFee !== 0
        ? [{ label: 'Home Emergency Assistance Fee', amount: assistanceFee }]
        : []),
    ],
  };
}
