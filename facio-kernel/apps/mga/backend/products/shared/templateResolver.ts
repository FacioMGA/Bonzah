import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getTenantConfig } from '../../platform/tenant/tenantConfig.js';

/**
 * Resolve a product document template path with country-specific fallback.
 *
 * Lookup order:
 *   1. backend/products/{product}/documents/templates/{country}/{file}
 *   2. backend/products/{product}/documents/templates/{file}
 *
 * `productRoot` is the absolute directory path of the product (e.g.
 * `/path/to/backend/products/home`). Each product passes it in to avoid
 * hard-coding paths here.
 */
export function resolveTemplatePath(productRoot: string, relativeFile: string): string {
  const tenant = getTenantConfig();
  const country = tenant.countryCode.toLowerCase();
  const perCountry = join(productRoot, 'documents', 'templates', country, relativeFile);
  if (existsSync(perCountry)) return perCountry;
  const fallback = join(productRoot, 'documents', 'templates', relativeFile);
  return fallback;
}
