import { Router } from 'express';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';

export function createTenantResolveRouter() {
  const router = Router();

  router.get('/resolve', (_req, res) => {
    const tenant = getTenantConfig();
    res.json({
      id: tenant.id,
      tenantSlug: tenant.tenantSlug,
      displayName: tenant.runtimeSettings?.branding.displayName || tenant.defaultBrokerName || tenant.tenantSlug,
      countryCode: tenant.countryCode,
      country: tenant.country,
      currency: tenant.currency,
      legalPack: tenant.legalPack,
      publicBaseUrl: tenant.publicBaseUrl,
      fromEmail: tenant.fromEmail,
      brandLogo: tenant.brandLogo,
      adminFee: tenant.adminFee,
      ipt: tenant.ipt,
      defaultBrokerName: tenant.defaultBrokerName ?? null,
      runtimeSettings: tenant.runtimeSettings ?? null,
    });
  });

  return router;
}
