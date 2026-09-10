/**
 * Shared formatters for the quote presentation primitives.
 *
 * Lives next to the visual shell (not in `frontend/src/shared/lib/format.ts`)
 * because it's a 2-decimal currency format specific to the premium UI; the
 * generic `formatMoneyUI` rounds to whole units which is wrong here.
 */

const SYMBOLS: Record<string, string> = {
  EUR: '€',
  GBP: '£',
  USD: '$',
};

export function formatPremium(amount: number | undefined, currency: string): string {
  const value = Number(amount || 0);
  const symbol = SYMBOLS[currency.toUpperCase()] || '';
  return `${symbol}${value.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
