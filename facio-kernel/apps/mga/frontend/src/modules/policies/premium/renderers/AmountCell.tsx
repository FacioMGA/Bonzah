import React from 'react';

type AmountCellProps = {
  n: unknown;
  currency: string;
};

export function AmountCell({ n, currency }: AmountCellProps) {
  const v = Number(n || 0);
  const isNeg = v < 0;
  const normalizedCurrency = String(currency || '').toUpperCase();
  const symbol = normalizedCurrency === 'EUR' ? '€' : `${normalizedCurrency} `;
  return (
    <div className={`text-right font-black tabular-nums whitespace-nowrap ${isNeg ? 'text-emerald-700' : 'text-slate-900'}`}>
      {isNeg ? '-' : ''}{symbol}{Math.abs(v).toFixed(2)}
    </div>
  );
}
