import type { ProductManifest } from '@facio/products';

/**
 * Frontend Product Registry.
 *
 * Holds every registered `ProductManifest`, keyed by `productType`.
 * Shared BO surfaces (policy list, policy header, UW tab, MBE, program editor)
 * resolve the manifest for the current policy via `ProductRegistry.get(productType)`
 * and render from it — no motor/home/travel literals in shared code.
 *
 * Registration happens at app boot via each product's `register.ts`
 * (e.g. `@/src/products/motor/register`), imported from `@/src/products/index.ts`.
 */

class ProductRegistryImpl {
  private readonly manifests = new Map<string, ProductManifest>();

  register(manifest: ProductManifest): void {
    const key = String(manifest.productType || '').toUpperCase();
    if (!key) {
      throw new Error('ProductRegistry.register: manifest.productType is required');
    }
    this.manifests.set(key, manifest);
  }

  get(productType: string | null | undefined): ProductManifest | null {
    const key = String(productType || '').toUpperCase();
    if (!key) return null;
    return this.manifests.get(key) ?? null;
  }

  list(): ProductManifest[] {
    return Array.from(this.manifests.values());
  }

  has(productType: string | null | undefined): boolean {
    const key = String(productType || '').toUpperCase();
    return key ? this.manifests.has(key) : false;
  }
}

export const ProductRegistry = new ProductRegistryImpl();
