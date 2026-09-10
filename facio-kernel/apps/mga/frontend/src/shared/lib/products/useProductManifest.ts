import { useMemo } from 'react';
import { ProductRegistry } from './registry';
import type { ProductManifest } from '@facio/products';

/**
 * Shared hook for resolving the current policy's ProductManifest.
 *
 * Returns `null` when the policy hasn't had its Binder + Program chosen yet
 * (productType is empty). Shared BO surfaces render a "pick a binder and program"
 * empty-state in that case instead of guessing a product.
 */
export function useProductManifest(productType: string | null | undefined): ProductManifest | null {
  return useMemo(() => ProductRegistry.get(productType), [productType]);
}
