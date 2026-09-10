export type BinderLike = {
  id?: string;
  agreementNumber?: string;
  umr?: string;
  binderNumber?: string;
  coverholderName?: string;
  leadCapacityProviderName?: string;
  authorizedClass?: string;
  productLabel?: string;
  regionLabel?: string;
  startDate?: string;
};

export function binderUwYear(binder: BinderLike): string {
  const agreement = String(binder.agreementNumber || '').trim();
  const fullYearMatch = agreement.match(/(20\d{2})$/);
  if (fullYearMatch) return fullYearMatch[1];
  const shortYearMatch = agreement.match(/^(\d{2})[A-Z]/i);
  if (shortYearMatch) return `20${shortYearMatch[1]}`;
  const startDate = String(binder.startDate || '').trim();
  if (startDate) {
    const parsed = new Date(startDate);
    if (!Number.isNaN(parsed.getTime())) return String(parsed.getUTCFullYear());
  }
  return 'Unknown';
}

export function binderUmrFragment(binder: BinderLike): string {
  const agreement = String(binder.agreementNumber || '').trim();
  const agreementWithoutYear = agreement.replace(/-20\d{2}$/i, '').trim();
  if (agreementWithoutYear) return agreementWithoutYear;
  if (agreement) return agreement;
  const umr = String(binder.umr || '').replace(/\s+/g, '');
  if (!umr) return String(binder.agreementNumber || binder.binderNumber || binder.id || 'Unknown');
  const withoutLeadingMarket = umr.replace(/^B\d+/i, '');
  const withoutYearSuffix = withoutLeadingMarket.replace(/20\d{2}$/i, '');
  const fragment = withoutYearSuffix || withoutLeadingMarket || umr;
  return fragment.slice(0, 10);
}

export function formatBinderLabel(binder: BinderLike): string {
  const leader = String(binder.leadCapacityProviderName || binder.coverholderName || 'Unknown leader').trim();
  const productClass = String(binder.productLabel || binder.authorizedClass || binder.regionLabel || binderUmrFragment(binder) || 'Binder').trim();
  const year = binderUwYear(binder);
  return `${leader} – ${productClass} – ${year}`;
}
