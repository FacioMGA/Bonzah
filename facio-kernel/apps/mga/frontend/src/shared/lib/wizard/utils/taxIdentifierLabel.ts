/**
 * Customer-facing label + placeholder for the personal tax/identity field
 * (`proposer.nif`) in the universal policyholder step.
 *
 * The identifier itself is jurisdiction-specific, so the label must follow
 * the operating tenant's country (derived from the host — see
 * {@link getOperatingCountryFromHost}), never a single hardcoded string:
 *   - CY: expats provide a passport number (there is no Cypriot NIF), so the
 *     field is a passport number. Cypriot nationals leave it blank — it is
 *     not a required field.
 *   - GR: the Greek tax number is the AFM (ΑΦΜ).
 *   - PT / ES: the tax number is the NIF.
 *
 * Approved production requirement (Theo, 2026-07-21): CY → passport, GR → AFM.
 *
 * Unknown hosts (localhost, preview deploys, BO usage) get the neutral
 * generic label. This is UI copy for a display label — not a business
 * fallback for a contract-required identifier — so a generic default here
 * does not violate `no-defensive-fallbacks`.
 */
export interface TaxIdentifierFieldCopy {
  label: string;
  placeholder: string;
}

const GENERIC: TaxIdentifierFieldCopy = {
  label: 'NIF / Tax ID',
  placeholder: 'Enter tax identification number',
};

const BY_COUNTRY: Readonly<Record<string, TaxIdentifierFieldCopy>> = {
  CY: { label: 'Passport number', placeholder: 'Enter passport number' },
  GR: { label: 'AFM', placeholder: 'Enter your AFM' },
  PT: { label: 'NIF', placeholder: 'Enter your NIF' },
  ES: { label: 'NIF', placeholder: 'Enter your NIF' },
};

/**
 * Returns the customer-facing label + placeholder for the `proposer.nif`
 * field given the operating tenant's ISO-3166-1 alpha-2 country code
 * (or `null` for unknown hosts).
 */
export function taxIdentifierFieldCopy(countryCode: string | null): TaxIdentifierFieldCopy {
  if (!countryCode) return GENERIC;
  return BY_COUNTRY[countryCode] ?? GENERIC;
}
