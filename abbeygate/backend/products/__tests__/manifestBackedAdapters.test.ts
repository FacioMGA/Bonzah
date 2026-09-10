import { describe, expect, it } from 'vitest';
import { registerAllProducts } from '../registerProducts.js';
import { HomeProductAdapter } from '../home/HomeProductAdapter.js';
import { TravelProductAdapter } from '../travel/TravelProductAdapter.js';

registerAllProducts();

describe('manifest-backed product adapters', () => {
  const adapters = [
    { name: 'HOME', adapter: new HomeProductAdapter(), validQuoteResponse: { primaryOption: { annualPremium: 120 } } },
    { name: 'TRAVEL', adapter: new TravelProductAdapter(), validQuoteResponse: { primaryOption: { annualPremium: 95 } } },
  ];

  for (const { name, adapter, validQuoteResponse } of adapters) {
    it(`${name} resolves contract-driven issued documents and quote readiness`, async () => {
      expect(adapter.getRequiredIssuedDocTypes().length).toBeGreaterThan(0);
      expect(adapter.getQuoteReadyFieldKeys().length).toBeGreaterThan(0);

      const validation = await adapter.validateForIssuance({});
      expect(validation.valid).toBe(false);
      expect(validation.missingForIssuedPack.length).toBeGreaterThan(0);
    });

    it(`${name} uses shared manifest-backed defaults for non-financial contract behavior`, () => {
      expect(adapter.computeNonRefundableFloor({ snapshot: {}, registryFallbackPrice: 0 })).toBe(0);
      expect(adapter.isUwComplete({}, [])).toBe(true);
      expect(adapter.hasValidQuoteResponse(validQuoteResponse)).toBe(true);
      expect(adapter.buildDocViewModel({
        policyRecord: { id: 'policy-1' },
        snapshotRecord: { quoteData: { hello: 'world' } },
        binder: null,
        activeEndorsements: null,
        programMeta: {},
        brand: null,
        normalizedMbeCfg: null,
        mbeSections: null,
      })).toEqual({
        policy: { id: 'policy-1' },
        quoteData: { hello: 'world' },
      });
    });
  }
});
