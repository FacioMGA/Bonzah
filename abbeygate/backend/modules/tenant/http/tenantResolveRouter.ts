import { Router } from 'express';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';

export function createTenantResolveRouter() {
  const router = Router();

  router.get('/resolve', (_req, res) => {
    const tenant = getTenantConfig();
    res.json({
      tenantSlug: tenant.tenantSlug,
      countryCode: tenant.countryCode,
      legalPack: tenant.legalPack,
      publicBaseUrl: tenant.publicBaseUrl,
      defaultBrokerName: tenant.defaultBrokerName ?? null,
    });
  });

  return router;
}
