import { asRecord } from '@/src/shared/lib/record';

// Legacy HomeBreakdown / Motor PremiumBreakdown mix currency amounts with
// rates, percentages and ages. Only their declared monetary fields belong in
// an amount column; other values remain available in the retained rating trace.
const monetaryFields = new Map<string, string>([
  ['buildingsPremium', 'Buildings premium'],
  ['contentsPremium', 'Contents premium'],
  ['jewelleryPremium', 'Jewellery premium'],
  ['otherAllRisksPremium', 'Other all-risks premium'],
  ['basePremium', 'Base premium'],
  ['afterLoadings', 'Premium after loadings'],
  ['afterDiscounts', 'Premium after discounts'],
  ['uwProfitLoading', 'Underwriting profit loading amount'],
  ['europAssistanceFee', 'Home Emergency Assistance Fee'],
  ['netPremium', 'Net premium'],
  ['iptAmount', 'IPT amount'],
  ['adminFee', 'Admin fee'],
  ['grossPremium', 'Gross premium'],
  ['tplBase', 'Third-party liability base premium'],
  ['tplFinal', 'Third-party liability premium'],
  ['compBase', 'Comprehensive base premium'],
  ['compFinal', 'Comprehensive premium'],
  ['windscreen', 'Windscreen premium'],
  ['finalPremium', 'Final risk premium'],
]);

/** Presentation only: no inferred units, calculated amounts or source mutation. */
export function retainedMonetaryBreakdownLines(value: unknown) {
  return Object.entries(asRecord(value)).flatMap(([key, amount]) => {
    const label = monetaryFields.get(key);
    return label && typeof amount === 'number' && Number.isFinite(amount) && amount !== 0
      ? [{ key, label, amount }]
      : [];
  });
}
