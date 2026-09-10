import { describe, expect, it } from 'vitest';
import { TravelProductAdapter } from '../TravelProductAdapter.js';

describe('TravelProductAdapter quote-email presentation', () => {
  it('derives the Travel cover and contractual excess from the selected plan and trip type', () => {
    const presentation = new TravelProductAdapter().buildQuoteEmailPresentation({
      quote: { selectedPlan: 'platinum' },
      trip: { planType: 'single_trip' },
    });

    expect(presentation).toEqual({
      coverLabel: 'Platinum — Single Trip',
      excessLabel: '€100 per insured person per section (€250 Personal Liability)',
    });
  });

  it('fails closed when the Travel disclosure inputs are absent', () => {
    expect(() => new TravelProductAdapter().buildQuoteEmailPresentation({ quote: {}, trip: {} }))
      .toThrow('Travel quote email requires a selected plan and trip type');
  });

  it('describes annual multi-trip cover with its approved disclosure available', () => {
    expect(new TravelProductAdapter().buildQuoteEmailPresentation({
      quote: { selectedPlan: 'gold' },
      trip: { planType: 'annual_multi_trip' },
    })).toEqual({
      coverLabel: 'Gold — Annual Multi-Trip',
      excessLabel: '€100 per insured person per section (€250 Personal Liability)',
    });
  });
});
