/**
 * MagicB Endorsement Registry.
 *
 * The registry is product-agnostic and delegates to the authoritative catalog
 * on each `IProductAdapter`. There is no cross-product fallback and no shared
 * motor-only global: every call must either supply a productType or resolve
 * one from a policy.
 *
 * Motor's hand-curated catalog (TEMPLATES / ENDORSEMENT_GROUPS in
 * `endorsementTemplates.ts`) is exposed by `MotorProductAdapter`, so callers
 * who still need the motor list by name can use
 * `MagicBRegistry.forProduct('MOTOR').getAll()`.
 */
import type { EndorsementTemplate } from './types.js';
import type { EndorsementGroup } from '../../policy/domain/productContracts.js';
import { ProductRegistry } from '../../policy/domain/ProductRegistry.js';

export interface EndorsementCatalog {
  readonly productType: string;
  get(code: string): EndorsementTemplate | undefined;
  getAll(): EndorsementTemplate[];
  getGroups(): EndorsementGroup[];
}

function resolveAdapter(productType: string) {
  const normalized = String(productType || '').trim().toUpperCase();
  if (!normalized) {
    throw new Error('MagicBRegistry.forProduct requires a productType');
  }
  const adapter = ProductRegistry.getInstance().getAdapter(normalized);
  if (!adapter) {
    throw new Error(`No product adapter registered for '${normalized}'; cannot resolve endorsement catalog.`);
  }
  return adapter;
}

export class MagicBRegistry {
  /** Primary API: product-scoped catalog resolver. */
  static forProduct(productType: string): EndorsementCatalog {
    const adapter = resolveAdapter(productType);
    return {
      productType: adapter.productType,
      get: (code) => adapter.getEndorsementTemplate(code),
      getAll: () => adapter.getEndorsementCatalog(),
      getGroups: () => adapter.getEndorsementGroups(),
    };
  }

  /**
   * Convenience for callers that are inherently motor-scoped (e.g. motor
   * document template contracts). Equivalent to `forProduct('MOTOR')`.
   */
  static motorOnly(): EndorsementCatalog {
    return this.forProduct('MOTOR');
  }
}

export { ENDORSEMENT_GROUPS } from './endorsementTemplates.js';
