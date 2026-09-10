/* @vitest-environment happy-dom */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TravelRatingModelEditor } from './TravelRatingModelEditor';

const tables = {
  rateCard: {
    version: 'travel-2026',
    rates: { 'silver|Single trip|Europe|Individual|3|18-35': 25, 'silver|Single trip|Europe|Individual|3|80+': 'REFER' },
    addons: { golfCover: { singleTrip: { kind: 'loadPercent', value: 0.1 }, multiTrip: { kind: 'perTraveller', value: 10 } } },
    singleTripCoverMultipliers: { Individual: 1, Couple: 1.9, Family: 2.15 },
    underwritingProfitLoading: { rate: 0.02, appliesTo: 'net_premium' },
    priorClaimLoading: { upTo500Rate: 0.15, appliesTo: 'base_premium' },
  },
  adminFees: { version: 'fees-2026', appliesTo: 'net_premium', bands: [{ uptoNet: 70, fee: 7 }, { uptoNet: null, fee: 25 }] },
};

describe('TravelRatingModelEditor', () => {
  it('updates a persisted Travel rate cell', () => {
    const onChange = vi.fn(); render(<TravelRatingModelEditor tables={tables} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Travel rate silver|Single trip|Europe|Individual|3|18-35'), { target: { value: '30' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rateCard: expect.objectContaining({ rates: expect.objectContaining({ 'silver|Single trip|Europe|Individual|3|18-35': 30 }) }) }));
  });

  it('updates an admin fee band in the persisted model', () => {
    const onChange = vi.fn(); render(<TravelRatingModelEditor tables={tables} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Travel admin fee band 1 fee'), { target: { value: '9' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ adminFees: expect.objectContaining({ bands: expect.arrayContaining([expect.objectContaining({ fee: 9 })]) }) }));
  });

  it('updates the schema-owned prior-claim loading without changing its key', () => {
    const onChange = vi.fn(); render(<TravelRatingModelEditor tables={tables} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Travel prior claim loading up to €500 rate'), { target: { value: '0.2' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rateCard: expect.objectContaining({ priorClaimLoading: expect.objectContaining({ upTo500Rate: 0.2 }) }) }));
  });
});
