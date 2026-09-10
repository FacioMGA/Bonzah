import { productCatalog } from '@/src/products/catalog';

/**
 * Product options for operational reports. Sourced from the frontend
 * product catalog (a projection of the canonical product manifests),
 * not a UI-only constant list. Default is empty string = all products.
 */
export const REPORT_PRODUCT_OPTIONS = productCatalog.map((entry) => ({
  value: String(entry.manifest.productType),
  label: String(entry.manifest.displayName || entry.manifest.productType),
}));

export function isReportDateRangeInvalid(start?: string, end?: string): boolean {
  const from = String(start || '').trim();
  const to = String(end || '').trim();
  if (!from || !to) return false;
  return from > to;
}
