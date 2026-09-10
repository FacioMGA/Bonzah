import type { IProductAdapter } from './productContracts.js';
export type { IProductAdapter } from './productContracts.js';
export * from './productContracts.js';

export class ProductRegistry {
  private adapters = new Map<string, IProductAdapter>();
  private static _instance: ProductRegistry;

  private constructor() {}

  public static getInstance(): ProductRegistry {
    if (!ProductRegistry._instance) {
      ProductRegistry._instance = new ProductRegistry();
    }
    return ProductRegistry._instance;
  }

  public register(adapter: IProductAdapter) {
    this.adapters.set(adapter.productType, adapter);
  }

  public getAdapter(productType: string): IProductAdapter | null {
    return this.adapters.get(productType) || null;
  }

  public getAllAdapters(): IProductAdapter[] {
    return Array.from(this.adapters.values());
  }
}
