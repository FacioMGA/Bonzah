/* @vitest-environment happy-dom */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HomeRatingModelEditor } from './HomeRatingModelEditor';

const block = { buildings: 1, contents: 2, jewellery: null, otherAllRisks: null };
const workbookBlock = { buildingsBase: 1, buildingsOver: 2, buildingsAd: null, contentsBase: 3, contentsOver: 4, contentsAd: null, jewellery: null, otherAllRisks: null, solar: 5 };
const tables = { vintage: '2026', source: 'approved workbook', rateCards: { CY: { Permanent: { small: block, largeNoAd: block, smallWithAd: block }, Holiday: { small: block, largeNoAd: block, smallWithAd: block } } }, workbook: { CY: { Permanent: workbookBlock, Holiday: workbookBlock } }, minPremium: 131, underwritingProfitLoading: { rate: 0.02, appliesTo: 'net_premium' }, wildfireLoading: { amber: 0.1, yellow: 0.2, green: 0 }, countryBaseLoading: { CY: 0 }, pricingRules: { propertyAgeDiscounts: { new: 0.1 }, noClaimsDiscounts: { none: 0 }, increasedExcessDiscounts: { '500': 0.1 }, previousClaimsLoadings: { none: 0 }, combustibleConstructionLoading: 0.1, staticCaravanLoading: 0.2, greekPostcodeLoading: { postcodes: ['123'], rate: 0.3 }, alarmDiscount: 0.1, proposerOver45Discount: 0.1, discretionaryDiscountCap: 0.2, europAssistance: { countryCodes: ['CY'], fee: 5 } } };

describe('HomeRatingModelEditor', () => {
  it('updates a country rate card cell in the persisted payload', () => {
    const onChange = vi.fn(); render(<HomeRatingModelEditor tables={tables} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('CY Permanent small buildings'), { target: { value: '1.5' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rateCards: expect.objectContaining({ CY: expect.anything() }) }));
  });
  it('updates the Home minimum premium in the persisted payload', () => {
    const onChange = vi.fn(); render(<HomeRatingModelEditor tables={tables} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Home minimum premium'), { target: { value: '150' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ minPremium: 150 }));
  });
  it('updates the governed postcode loading rather than a separate local value', () => {
    const onChange = vi.fn(); render(<HomeRatingModelEditor tables={tables} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Home Greek postcode loading rate'), { target: { value: '0.4' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      pricingRules: expect.objectContaining({ greekPostcodeLoading: expect.objectContaining({ rate: 0.4 }) }),
    }));
  });
});
