/* @vitest-environment happy-dom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MotorRatingModelEditor } from './MotorRatingModelEditor';

const tables = {
  baseMatrix: {
    vehicleValueBands: [3000],
    engineSizeBands: ['0-999'],
    basePolicyExcessEngineSizeBands: ['0-999'],
    basePolicyExcessByEngineBand: [250],
    values: [[670]],
  },
  factors: {
    proposerAge: [{ label: 'Under 21', min: 0, max: 20, factor: 5 }],
    vehicleAge: [{ label: 'Vehicle age up to 5', min: 0, max: 5, factor: 1 }],
    licencePeriod: [{ label: 'Less than one year', min: 0, max: 0.9, factor: 1.25 }],
    addedDriversUnder25: [{ label: 'No loading', min: 0, max: 20, factor: 1 }],
  },
  classicRates: {
    premiumByMileageBand: {
      '0-1500': { '1': 200, '2': 220, '3': 240, '4': 260, '5': 280, '5+': 300 },
      '1501-3000': { '1': 210, '2': 230, '3': 250, '4': 270, '5': 290, '5+': 310 },
      '3001-5000': { '1': 220, '2': 240, '3': 260, '4': 280, '5': 300, '5+': 320 },
    },
    policyExcessByAgeBand: {
      '10-20': { '1': 500, '2': 500, '3': 500, '4': 500, '5': 500, '5+': 500 },
      '20+': { '1': 250, '2': 250, '3': 250, '4': 250, '5': 250, '5+': 250 },
    },
    vehicleGroups: [{ make: 'Test', model: 'Test', fromYear: 1970, toYear: 1971, engineCc: 1000, group: '1' }],
  },
  classic: { excessPctOfValue: 0.015 },
};

const ratingPipeline = [
  { operator: 'resolve-excess', label: 'Resolve excess' },
  { operator: 'liability-premium', label: 'Liability premium' },
  { operator: 'own-damage-premium', label: 'Own-damage premium' },
  { operator: 'driver-loadings', label: 'Driver loadings' },
  { operator: 'term-factor', label: 'Term factor' },
  { operator: 'risk-subtotal', label: 'Risk subtotal' },
  { operator: 'discounts', label: 'Discounts' },
  { operator: 'underwriter-adjustments', label: 'Underwriter adjustments' },
  { operator: 'endorsement-effects', label: 'Endorsement effects' },
  { operator: 'jurisdiction-charges', label: 'Jurisdiction charges' },
  { operator: 'total-premium', label: 'Total premium' },
];

function renderEditor(onChange = vi.fn(), onStagesChange = vi.fn()) {
  render(<MotorRatingModelEditor
    tables={tables}
    onChange={onChange}
    stages={[]}
    onStagesChange={onStagesChange}
    ratingPipeline={ratingPipeline}
  />);
  return { onChange, onStagesChange };
}

describe('MotorRatingModelEditor', () => {
  it('updates a base premium cell in the persisted rating-model payload', () => {
    const { onChange } = renderEditor();

    fireEvent.change(screen.getByLabelText('0-999, €3,000'), { target: { value: '710' } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      baseMatrix: expect.objectContaining({ values: [[710]] }),
    }));
  });

  it('updates the compulsory base excess in the same draft payload', () => {
    const { onChange } = renderEditor();

    fireEvent.change(screen.getByLabelText('0-999 minimum excess'), { target: { value: '750' } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      baseMatrix: expect.objectContaining({ basePolicyExcessByEngineBand: [750] }),
    }));
  });

  it('writes only the validated, product-owned pipeline operator IDs to the draft', () => {
    const { onStagesChange } = renderEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Apply validated Motor pipeline' }));

    expect(onStagesChange).toHaveBeenCalledWith(ratingPipeline.map(({ operator }) => ({ id: operator, operator })));
  });

  it('updates a classic premium table cell in the published model payload', () => {
    const { onChange } = renderEditor();

    fireEvent.change(screen.getByLabelText('Classic base premium 0-1500 km group 1'), { target: { value: '225' } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      classicRates: expect.objectContaining({
        premiumByMileageBand: expect.objectContaining({
          '0-1500': expect.objectContaining({ '1': 225 }),
        }),
      }),
    }));
  });
});
