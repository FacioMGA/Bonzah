/* @vitest-environment happy-dom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HealthRatingModelEditor } from './HealthRatingModelEditor';

const tables = {
  asset: 'Health rate card', version: '2026.1', reviewed: '2026-09-01',
  ageBands: [{ band: '0-62', premiumGross: 300, commissionPercent: 0.3, excess: '10%' }],
  baseCover: { inpatientPerIllness: 100_000, inpatientPerPeriod: 150_000, dailyRoomRegular: 100, dailyRoomEmergency: 200, childbirthLumpSum: 1_000, repatriationLimit: 30_000, outpatientPerIllness: 500, outpatientPerPeriod: 1_000, outpatientExcess: 50, coinsurancePercent: 10 },
  ghsExtension: { doctorVisit: 50, doctorVisitsPerPeriod: 10, medications: 100, deathByAccidentLimit: 5_000, repatriationAfterDeathLimit: 20_000 },
};

describe('HealthRatingModelEditor', () => {
  it('updates an age-banded premium in the persisted rating-model payload', () => {
    const onChange = vi.fn();
    render(<HealthRatingModelEditor tables={tables} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Health 0-62 gross premium'), { target: { value: '350' } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      ageBands: [expect.objectContaining({ band: '0-62', premiumGross: 350 })],
    }));
  });

  it('updates a base-cover limit in the persisted rating-model payload', () => {
    const onChange = vi.fn();
    render(<HealthRatingModelEditor tables={tables} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Base cover limits Inpatient per illness'), { target: { value: '120000' } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      baseCover: expect.objectContaining({ inpatientPerIllness: 120000 }),
    }));
  });
});
