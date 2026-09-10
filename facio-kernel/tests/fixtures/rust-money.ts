import type { FinancialAllocationInput } from '../../src/contracts/money.js';

/** Deterministic synthetic inputs, never customer golden acceptance. */
export function moneyCases(count: number, participantCount?: number): FinancialAllocationInput[] {
  let state = 0x17a055a1;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const currencies = ['GBP', 'USD', 'EUR', 'JPY', 'KWD'] as const;
  return Array.from({ length: count }, (_, index) => {
    const n = participantCount ?? [1, 2, 4, 8, 32, 100][index % 6]!;
    const cuts = new Set<number>([0, 10000]);
    while (cuts.size < n + 1) cuts.add((next() % 9999) + 1);
    const sorted = [...cuts].sort((a, b) => a - b);
    const participants = Array.from({ length: n }, (_, i) => ({
      id: `participant-${String(i).padStart(3, '0')}`,
      role: (i === 0 ? 'lead' : 'follow') as 'lead' | 'follow',
      shareBps: sorted[i + 1]! - sorted[i]!,
    }));
    if (index % 2) participants.reverse();
    const amount =
      index % 9 === 0
        ? 0n
        : index % 9 === 1
          ? 1n
          : index % 9 === 2
            ? 999999999999999999n
            : index % 9 === 3
              ? 9007199254740993n
              : ((BigInt(next()) << 32n) + BigInt(next())) % 1000000000000000000n;
    const premium = amount * (index % 2 === 0 ? 1n : -1n);
    return {
      currency: currencies[index % 5]!,
      premiumMinor: String(premium),
      participants,
      commission: {
        rateBps:
          index % 8 === 0 ? 0 : index % 8 === 1 ? 10000 : index % 8 === 2 ? 5000 : next() % 10001,
        base: 'gross_premium',
        recipientId: 'commission-recipient',
        settlementPartyId: 'settlement-party',
        cashCustody: 'external',
      },
    };
  });
}
