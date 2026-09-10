/** Adapted from Symphony calculationSourceCurrencyGuardrails.ts.
 * Deliberate safety changes: no historical FX defaults and no missing-rate amount passthrough. */
type Question = { id?: string; field?: string; slug?: string; settings?: { currency?: string } };
export function normalizeCurrencyCode(value: unknown, fallback: string): string { return typeof value === 'string' && /^[A-Za-z]{3}$/.test(value.trim()) ? value.trim().toUpperCase() : fallback; }
export function findProposalQuestionBySourceObject(groups: Array<{ questions?: Question[] }> | undefined, object: string): Question | null {
  for (const group of groups ?? []) for (const question of group.questions ?? []) if (question.id === object || question.slug === object || question.field === object) return question;
  return null;
}
export function questionSourceCurrency(question: Question | null, currency: string | undefined): string {
  const value = normalizeCurrencyCode(question?.settings?.currency, normalizeCurrencyCode(currency, ''));
  if (!value) throw new Error('Commercial source currency must be explicitly configured.');
  return value;
}
export function convertCurrencyAmount(amount: number, from: string, to: string, rates: Record<string, number> = {}): number | null {
  if (!Number.isFinite(amount)) return null;
  if (from === to) return amount;
  const direct = rates[`${from}->${to}`], inverse = rates[`${to}->${from}`];
  const rate = Number.isFinite(direct) && direct > 0 ? direct : Number.isFinite(inverse) && inverse > 0 ? 1 / inverse : null;
  return rate === null ? null : Number.isFinite(amount * rate) ? amount * rate : null;
}
