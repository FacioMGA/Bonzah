import { describe, expect, it } from 'vitest';
import {
  HOME_SOLAR_PANEL_DEFAULT_AMOUNT,
  hasHomeSolarPanelDefault,
  resolveHomeSolarPanelCoverAmount,
  wasHomeSolarPanelMinimumRated,
} from '../solarPanelCover.js';

describe('Home solar-panel cover', () => {
  it.each(['CY', 'cy', 'GR', 'gr'])('requires the €2,000 product minimum in %s', (countryCode) => {
    expect(hasHomeSolarPanelDefault(countryCode)).toBe(true);
    expect(resolveHomeSolarPanelCoverAmount(countryCode, undefined)).toBe(HOME_SOLAR_PANEL_DEFAULT_AMOUNT);
    expect(resolveHomeSolarPanelCoverAmount(countryCode, 1_000)).toBe(HOME_SOLAR_PANEL_DEFAULT_AMOUNT);
  });

  it('allows the customer to increase the default amount', () => {
    expect(resolveHomeSolarPanelCoverAmount('CY', 5_000)).toBe(5_000);
  });

  it.each(['PT', 'ES', '', undefined])('does not introduce solar cover outside the CY/GR rule for %s', (countryCode) => {
    expect(hasHomeSolarPanelDefault(countryCode)).toBe(false);
    expect(resolveHomeSolarPanelCoverAmount(countryCode, undefined)).toBe(0);
  });

  it('uses the rated calculator version to distinguish historic documents', () => {
    expect(wasHomeSolarPanelMinimumRated('home-xlsx-2022@1.3.0')).toBe(false);
    expect(wasHomeSolarPanelMinimumRated('home-xlsx-2022@1.4.0')).toBe(true);
    expect(wasHomeSolarPanelMinimumRated('home-xlsx-2022@1.5.0')).toBe(true);
    expect(wasHomeSolarPanelMinimumRated(undefined)).toBe(false);
  });
});
