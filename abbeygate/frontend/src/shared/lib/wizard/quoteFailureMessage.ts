/**
 * Customer-safe translation of `/rate` endpoint failures.
 *
 * Tipping-off (POCA 2002 s.333A; MLR 2017 reg 86): when the backend
 * returns `SANCTION_SCREENING_BLOCKED` we are forbidden from disclosing
 * the underlying reason to the subject. The backend already supplies a
 * generic referral message — this helper prefers the API's text for
 * recognised compliance codes and falls back to the wizard's existing
 * generic alert text for everything else. Used by every product wizard
 * controller so the customer copy is consistent.
 */

const SANCTIONS_FALLBACK =
  'We are unable to provide an online quote for this application. Our team will review it and contact you within 1-2 business days.';
const SANCTIONS_UNAVAILABLE_FALLBACK =
  'Quote temporarily unavailable. Please try again shortly.';

export function resolveQuoteFailureMessage(args: {
  errorCode?: string | null;
  error?: string | null;
  genericFallback: string;
}): string {
  const code = String(args.errorCode || '').trim().toUpperCase();
  if (code === 'SANCTION_SCREENING_BLOCKED') {
    return args.error || SANCTIONS_FALLBACK;
  }
  if (code === 'SANCTION_SCREENING_UNAVAILABLE') {
    return args.error || SANCTIONS_UNAVAILABLE_FALLBACK;
  }
  return args.genericFallback;
}
