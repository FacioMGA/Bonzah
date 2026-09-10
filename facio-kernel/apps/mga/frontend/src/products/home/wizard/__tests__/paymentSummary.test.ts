import { describe, expect, it } from 'vitest';
import { homePaymentSummary } from '../paymentSummary';

describe('Home payment summary retained amounts', () => {
  it('includes assistance once and retains the server payable total without recalculating it', () => {
    const quote = { primaryOption: { annualPremium: 293.39, breakdown: {
      netPremium: 263.39, iptAmount: 0, adminFee: 18, europAssistanceFee: 12,
    } } };
    const summary = homePaymentSummary(quote);
    expect(summary).toEqual({ amount: 293.39, currency: 'EUR', breakdownLines: [
      { label: 'Net premium', amount: 263.39 },
      { label: 'IPT', amount: 0 },
      { label: 'Admin fee', amount: 18 },
      { label: 'Home Emergency Assistance Fee', amount: 12 },
    ] });
    expect(homePaymentSummary({ primaryOption: { ...quote.primaryOption, annualPremium: 290 } }).amount).toBe(290);
  });

  it.each([undefined, 0])('does not invent a fee when the retained charge is %s', (fee) => {
    const summary = homePaymentSummary({ primaryOption: { annualPremium: 281.39, breakdown: {
      netPremium: 263.39, adminFee: 18, europAssistanceFee: fee,
    } } });
    expect(summary.breakdownLines.some((line) => line.label.includes('Assistance'))).toBe(false);
    expect(summary.amount).toBe(281.39);
  });
});
