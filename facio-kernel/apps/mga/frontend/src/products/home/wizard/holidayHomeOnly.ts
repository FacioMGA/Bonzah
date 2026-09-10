import { getOperatingCountryName } from '@/src/shared/lib/tenant/operatingCountry';

/**
 * Abbeygate Home rule (WhatsApp, Jun 2026): a proposer domiciled OUTSIDE
 * the operating country can only insure a HOLIDAY home — a property in the
 * tenant's country is, by definition, not their permanent residence. The
 * wizard therefore locks the permanent/holiday choice to "holiday" in that
 * case (this helper), the rater already prices Holiday, and the home UW
 * automation refers a non-resident holiday home only when domicile is
 * outside the UK/EU (`HOLIDAY_HOME_NON_RESIDENT_DOMICILE`); EU/UK
 * domiciles may rate and contract online.
 *
 * Operating country is the host-derived NAME (e.g. "Portugal"), matching
 * the canonical country names the domicile select uses. When the host is
 * unknown (localhost / preview / unit tests) `getOperatingCountryName`
 * returns `null` and we do NOT constrain — the explicit "no restriction
 * known" signal, per `no-defensive-fallbacks`. Same applies before the
 * proposer has chosen a domicile.
 */
export function holidayHomeOnlyForDomicile(domicileCountry: unknown): boolean {
  const operating = String(getOperatingCountryName() || '').trim().toLowerCase();
  const domicile = String(domicileCountry || '').trim().toLowerCase();
  if (!operating || !domicile) return false;
  return domicile !== operating;
}
