import { describe, expect, it } from 'vitest';
import { resolveProductEngines } from '../../modules/policy/domain/productEngines.js';
import { businessProductRuntimeConfig } from '../business/runtime.js';
import { openMarketProductRuntimeConfig } from '../open-market/runtime.js';

async function quotePremium(runtime: typeof businessProductRuntimeConfig, quoteData: Record<string, unknown>): Promise<number> {
  const engines = resolveProductEngines(runtime.engines, {});
  const quote = await engines.rating.buildQuoteResponse({
    productType: runtime.productType,
    quoteData,
  });
  const primary = quote.quoteResponse.primaryOption as Record<string, unknown> | null;
  return Number(primary?.annualPremium || primary?.totalPremium || 0);
}

describe('manual referral runtimes', () => {
  it('rates Business from saved manual premium when present', async () => {
    const premium = await quotePremium(businessProductRuntimeConfig, {
      manualPremium: 225,
      proposal: {
        coverageRows: [
          { coverage: 'Property', premium: 125.5 },
          { coverage: 'Public liability', premium: 74.5 },
        ],
      },
    });

    expect(premium).toBe(225);
  });

  it('falls back to Business proposal coverage rows when manual premium is missing', async () => {
    const premium = await quotePremium(businessProductRuntimeConfig, {
      proposal: {
        coverageRows: [
          { coverage: 'Property', premium: 125.5 },
          { coverage: 'Public liability', premium: 74.5 },
        ],
      },
    });

    expect(premium).toBe(200);
  });

  it('falls back to manualPremium when no proposal rows exist', async () => {
    const premium = await quotePremium(openMarketProductRuntimeConfig, {
      manualPremium: 321,
      proposal: { coverageRows: [] },
    });

    expect(premium).toBe(321);
  });
});
