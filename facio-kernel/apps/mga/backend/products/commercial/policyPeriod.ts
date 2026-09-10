const date = (value: unknown, field: string): Date => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} requires an ISO calendar date.`);
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${field} is not a real calendar date.`);
  return parsed;
};
/** Explicit selected whole-term period; the binder still limits dates and authority at bind. */
export function resolveCommercialPolicyPeriod(quoteData: unknown) {
  const data = quoteData && typeof quoteData === 'object' ? quoteData as Record<string, unknown> : {};
  const policy = data.policy && typeof data.policy === 'object' ? data.policy as Record<string, unknown> : {};
  const inceptionDate = date(policy.startDate, 'policy.startDate'), expiryDate = date(policy.endDate, 'policy.endDate');
  if (expiryDate <= inceptionDate) throw new Error('Commercial expiry must follow inception.');
  if (expiryDate.getTime() - inceptionDate.getTime() > 366 * 86_400_000) throw new Error('The commercial source engine supports terms of at most one year; no multi-year rating rule is registered.');
  return { inceptionDate, expiryDate };
}
