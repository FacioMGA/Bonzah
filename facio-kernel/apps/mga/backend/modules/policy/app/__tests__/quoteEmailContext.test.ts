import { describe, expect, it, vi } from 'vitest';

const getAdapter = vi.fn();

vi.mock('../../domain/ProductRegistry.js', () => ({
  ProductRegistry: { getInstance: () => ({ getAdapter }) },
}));

const { buildQuoteEmailContext } = await import('../quoteEmailContext.js');

describe('buildQuoteEmailContext', () => {
  it('uses the product-owned travel cover and excess projection', () => {
    getAdapter.mockReturnValueOnce({
      buildQuoteEmailPresentation: () => ({
        coverLabel: 'Gold — Annual Multi-Trip',
        excessLabel: '€100 per insured person per section (€250 Personal Liability)',
      }),
    });

    const context = buildQuoteEmailContext({
      policyNumber: 'TR/CY1000296',
      productType: 'TRAVEL',
      quoteResponse: { primaryOption: { annualPremium: 150 } },
      vehicleInfo: {},
      quoteData: { quote: { selectedPlan: 'gold' }, trip: { planType: 'annual_multi_trip' } },
      stateCurrent: null,
    });

    expect(context.policy.vehicleDescription).toBe('Gold — Annual Multi-Trip');
    expect(context.quote.excess).toBe('€100 per insured person per section (€250 Personal Liability)');
  });

  it('uses product-aware labels for manual Business quote emails', () => {
    getAdapter.mockReturnValueOnce(null);
    const context = buildQuoteEmailContext({
      policyNumber: 'ABQ/CY1000296',
      productType: 'BUSINESS',
      quoteResponse: {},
      vehicleInfo: {},
      quoteData: {
        proposer: { firstName: 'Business', lastName: 'Test' },
      },
      stateCurrent: null,
    });

    expect(context.quote.productLabel).toBe('business insurance proposal');
    expect(context.policy.vehicleDescription).toBe('Business Test');
  });
});
