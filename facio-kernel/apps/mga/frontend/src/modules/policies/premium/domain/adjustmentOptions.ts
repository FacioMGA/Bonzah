type PricingStep = { id?: string; name?: string };

export type EndorsementOption = { id: string; label: string };

export function buildCoverageScopeOptions(coverRequired: unknown) {
  const options: Array<{ value: string; label: string }> = [{ value: 'TPL', label: 'TPL' }];
  if (String(coverRequired || '') !== 'Third Party Liability') {
    options.push({ value: 'OWN_DAMAGE', label: 'Own Damage' });
  }
  return options;
}

export function buildEndorsementOptions(feeSteps: PricingStep[]): EndorsementOption[] {
  const out: EndorsementOption[] = [];
  const seen = new Set<string>();
  feeSteps.forEach((step) => {
    const rawId = String(step.id || '');
    if (!rawId.startsWith('endorsement.premium.')) return;
    const code = rawId.replace('endorsement.premium.', '').trim();
    if (!code || seen.has(code)) return;
    seen.add(code);
    const label = String(step.name || '').trim() || code;
    out.push({ id: code, label: `${label} (${code})` });
  });
  return out;
}
