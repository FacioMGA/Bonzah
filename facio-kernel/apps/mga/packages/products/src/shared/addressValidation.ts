/**
 * Pure address validation — country-aware regex rules.
 *
 * Phase 8 (2026-04-28) consolidation: this module moved from
 * `frontend/src/modules/policies/validation/addressValidation.ts`
 * into `@facio/products` so motor schemas (also absorbed into the
 * package) can compose it without crossing the FE-only boundary.
 *
 * Pure JS, no FE deps. Backend, FE, and shared validation paths
 * all consume from here.
 */
export type AddressValidationInput = {
  country?: string;
  province?: string;
  postCode?: string;
};

function normalizeCountry(country: string): string {
  return String(country || '').trim().toLowerCase();
}

export function normalizePostCodeForCountry(postCode: string, country?: string): string {
  const raw = String(postCode || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const c = normalizeCountry(String(country || ''));
  if (c === 'united kingdom') {
    return raw.toUpperCase();
  }
  if (c === 'portugal') {
    return raw.replace(/\s+/g, '');
  }
  return raw.toUpperCase();
}

export function validateProvinceForCountry(province?: string, country?: string): string | null {
  const value = String(province || '').trim();
  if (!value) {
    return normalizeCountry(String(country || '')) === 'united states of america'
      ? 'State is required'
      : null;
  }
  return null;
}

export function validatePostCodeForCountry(postCode?: string, country?: string): string | null {
  const value = String(postCode || '').trim();
  if (!value) return 'Post Code is required';

  const c = normalizeCountry(String(country || ''));
  if ((c === 'united states of america' || c === 'united states') && !/^\d{5}(?:-\d{4})?$/.test(value)) {
    return 'US ZIP code must be 5 digits (or ZIP+4)';
  }
  if (c === 'portugal' && !/^\d{4}-?\d{3}$/.test(value)) {
    return 'Portugal post code must be in 1234-567 format';
  }
  if (
    c === 'united kingdom' &&
    !/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(value.replace(/\s+/g, ' '))
  ) {
    return 'Enter a valid UK post code';
  }
  if (value.length < 3) return 'Post Code must be at least 3 characters';
  return null;
}

export function getAddressValidationErrors(input: AddressValidationInput): Record<'province' | 'postCode', string> | {} {
  const provinceErr = validateProvinceForCountry(input.province, input.country);
  const postCodeErr = validatePostCodeForCountry(input.postCode, input.country);
  const out: Record<'province' | 'postCode', string> | {} = {};
  if (provinceErr) (out as Record<'province', string>).province = provinceErr;
  if (postCodeErr) (out as Record<'postCode', string>).postCode = postCodeErr;
  return out;
}
