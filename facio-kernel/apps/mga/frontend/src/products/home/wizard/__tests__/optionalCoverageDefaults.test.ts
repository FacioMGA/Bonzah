import { describe, expect, it } from 'vitest';
import { initialHomeQuoteData } from '../quoteWizard.constants';

describe('Home optional coverage defaults', () => {
  it('starts discretionary high-risk covers at the canonical no-cover amount', () => {
    expect(initialHomeQuoteData.coverage).toMatchObject({
      allRiskJewellery: 0,
      allRiskOther: 0,
    });
  });
});
