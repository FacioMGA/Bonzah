import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { ProductConfigurationError, resolveJurisdictionProductConfig } from '../domain/productConfiguration.js';

export type ProductAvailability = { available: true } | { available: false; message: string };

/**
 * Application projection of canonical jurisdiction-product authority for
 * catalogue and operational entry points. It owns availability only; online
 * channel permissions are resolved from the mapped programme definition.
 */
export function resolveProductAvailability(productCode: string): ProductAvailability {
  const normalizedProductCode = String(productCode || '').trim().toUpperCase();
  try {
    resolveJurisdictionProductConfig({ productCode: normalizedProductCode, tenant: getTenantConfig() });
    return { available: true };
  } catch (error) {
    if (!(error instanceof ProductConfigurationError)) throw error;
    return { available: false, message: error.message };
  }
}
