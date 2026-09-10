import { getTenantConfig, getTenantRuntimeSettings } from '../../../platform/tenant/tenantConfig.js';
import { fetchPublicImageDataUri } from '../../../platform/http/safeImage.js';

/** Document identity is projected from the selected MGA, never a customer template. */
export async function tenantDocumentBrand() {
  const tenant = getTenantConfig();
  const settings = getTenantRuntimeSettings(tenant);
  let logo = '';
  if (tenant.brandLogo.blue) {
    // A remote asset outage must not prevent policy documents. The legal/trading
    // name remains visible; the renderer itself has no network access.
    try { logo = await fetchPublicImageDataUri(tenant.brandLogo.blue); } catch { /* name fallback */ }
  }
  return {
    ...settings.branding, logo,
    address: settings.branding.addressLines.join(', '),
    contactEmail: settings.contact.email, contactPhone: settings.contact.phone,
  };
}
