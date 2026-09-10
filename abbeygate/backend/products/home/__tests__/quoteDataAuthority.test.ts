import { describe, expect, it } from 'vitest';
import { toHomePricingQuoteData } from '../quoteDataAuthority.js';

describe('toHomePricingQuoteData', () => {
  it('strips accidental damage cover when the property is a holiday home', () => {
    const result = toHomePricingQuoteData({
      usage: { permanentHome: false },
      coverage: {
        buildings: 320_000,
        contents: 20_000,
        accidentalDamageBuildings: true,
        accidentalDamageContents: true,
        allRiskJewellery: 9_000,
        allRiskOther: 500,
      },
    }, 'CY');

    expect(result.propertyUse).toBe('Holiday');
    expect(result.accidentalDamageBuildings).toBe(false);
    expect(result.accidentalDamageContents).toBe(false);
    expect(result.allRiskJewellery).toBe(0);
    expect(result.allRiskOther).toBe(0);
  });

  it('keeps accidental damage cover for permanent homes', () => {
    const result = toHomePricingQuoteData({
      usage: { permanentHome: true },
      coverage: {
        buildings: 255_000,
        contents: 22_000,
        accidentalDamageBuildings: true,
        accidentalDamageContents: false,
        allRiskJewellery: 2_500,
        allRiskOther: 250,
      },
    }, 'CY');

    expect(result.propertyUse).toBe('Permanent');
    expect(result.accidentalDamageBuildings).toBe(true);
    expect(result.accidentalDamageContents).toBe(false);
    expect(result.allRiskJewellery).toBe(2_500);
    expect(result.allRiskOther).toBe(250);
  });

  it('applies the CY/GR solar-panel minimum and leaves other territories unchanged', () => {
    const quoteData = { coverage: { buildings: 255_000, contents: 22_000, solarPanelCover: 1_000 } };

    expect(toHomePricingQuoteData(quoteData, 'CY').solarPanels).toBe(2_000);
    expect(toHomePricingQuoteData(quoteData, 'GR').solarPanels).toBe(2_000);
    expect(toHomePricingQuoteData(quoteData, 'PT').solarPanels).toBe(1_000);
  });
});
