import { buildProductCatalog } from '../../../products/catalog.js';

export type PublicQuoteSessionProduct = {
  productType: string;
  publicSessionSlug: string;
};

export function listPublicQuoteSessionProducts(): PublicQuoteSessionProduct[] {
  return buildProductCatalog().map((adapter) => {
    const runtime = adapter.getRuntimeDefinition();
    return {
      productType: adapter.productType,
      publicSessionSlug: runtime?.intake.publicSessionSlug || String(adapter.productType || '').toLowerCase(),
    };
  });
}
