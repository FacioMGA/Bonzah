/**
 * Frontend tenant → ISO country-code derivation for customer-facing
 * surfaces only.
 *
 * Per `docs/architecture/contracts/tenancy.md` the canonical, binding
 * tenant-resolution path is `backend/platform/http/middleware/resolveTenant.ts`
 * which folds JWT → request body → Host → `TENANT_SLUG` env. The
 * frontend cannot use ALS or any of those server-only sources, so for
 * the narrow needs of the public wizard (e.g. constraining a Google
 * Places address-autocomplete to the operator's jurisdiction) we
 * derive the country code from the only signal the browser has: the
 * hostname.
 *
 * This helper is **read-only** and **not** a second canonical owner of
 * tenant identity — it returns an ISO-3166-1 alpha-2 country code
 * suitable for narrow UX gating and nothing else. Anything that needs
 * to gate a write or branch business logic MUST go through the
 * server-side path.
 */

// MUST stay in lockstep with the canonical server-side host map in
// `backend/platform/http/middleware/resolveTenant.ts`. CY/PT/GR go live on the
// abbeygate.com production + staging domains; ES has no online purchase
// route yet, so it remains on facio.io only.
const TENANT_HOST_TO_COUNTRY: Record<string, string> = {
  // Production public domains (abbeygate.com).
  'cy.abbeygate.com': 'CY',
  'pt.abbeygate.com': 'PT',
  'gr.abbeygate.com': 'GR',
  // Test / staging domains.
  'cy.staging.abbeygate.com': 'CY',
  'pt.staging.abbeygate.com': 'PT',
  'gr.staging.abbeygate.com': 'GR',
  // Legacy facio.io hosts — kept live through the domain transition.
  'abbeygate-cy.facio.io': 'CY',
  'abbeygate-pt.facio.io': 'PT',
  'abbeygate-gr.facio.io': 'GR',
  'abbeygate-es.facio.io': 'ES',
};

/**
 * Canonical country NAME (matching the `@facio/validation` country
 * contract — a country name, never a demonym) for each operating
 * country code. Used to derive wizard field defaults (country of
 * registration, country of domicile, address country) from the host.
 */
const OPERATING_COUNTRY_NAME: Record<string, string> = {
  CY: 'Cyprus',
  PT: 'Portugal',
  GR: 'Greece',
  ES: 'Spain',
};

/**
 * Returns the canonical country NAME of the operating tenant for the
 * current browser host (e.g. `'Portugal'` on `abbeygate-pt.facio.io`),
 * or `null` when the host doesn't match a known Abbeygate tenant.
 *
 * Like {@link getOperatingCountryFromHost} this returns `null` rather
 * than silently defaulting to Cyprus, per `no-defensive-fallbacks`.
 */
export function getOperatingCountryName(hostname?: string): string | null {
  const code = getOperatingCountryFromHost(hostname);
  if (!code) return null;
  return OPERATING_COUNTRY_NAME[code] ?? null;
}

/**
 * Returns the ISO-3166-1 alpha-2 country code of the operating tenant
 * for the current browser host, or `null` when the host doesn't match
 * a known Abbeygate tenant (localhost dev, preview deploys, etc.).
 *
 * Returning `null` is the explicit "no restriction known" signal —
 * callers must treat that as "do not constrain", per
 * `no-defensive-fallbacks`. We do NOT silently default to 'CY'.
 */
export function getOperatingCountryFromHost(hostname?: string): string | null {
  const host = (hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '')).toLowerCase().trim();
  if (!host) return null;
  return TENANT_HOST_TO_COUNTRY[host] ?? null;
}
