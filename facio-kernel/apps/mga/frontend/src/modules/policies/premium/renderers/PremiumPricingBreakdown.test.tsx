/* @vitest-environment happy-dom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PremiumPricingBreakdown } from './PremiumPricingBreakdown';
import { asRecord } from '@/src/shared/lib/record';

function renderComponent(overrides?: Partial<React.ComponentProps<typeof PremiumPricingBreakdown>>) {
  const patchQuoteData = vi.fn().mockResolvedValue(undefined);
  const onRecalculate = vi.fn().mockResolvedValue(undefined);
  render(
    <PremiumPricingBreakdown
      primary={{ calculationTrace: { steps: [] } }}
      breakdown={{ tplFinal: 200, compFinal: 300 }}
      qd={{ coverRequired: 'Comprehensive' }}
      cost={{ subtotalNetPremium: 500, tax: 9, totalPremium: 509 }}
      currency="EUR"
      fmt={(n) => n.toFixed(2)}
      premiumLocked={false}
      patchQuoteData={patchQuoteData}
      feeSteps={[]}
      coverageDirty={false}
      needsUwReason={false}
      setShowPricingSteps={() => {}}
      getLimitText={() => '—'}
      onRecalculate={onRecalculate}
      isReRating={false}
      {...overrides}
    />
  );
  return { patchQuoteData, onRecalculate };
}

describe('PremiumPricingBreakdown — canonical breakdown.lines (ABY-264)', () => {
  it('never formats saved Home rates or discount percentages as currency and retains monetary amounts', () => {
    const setShowPricingSteps = vi.fn();
    const trace = { steps: [{ id: 'home.discounts', name: 'Discounts', rate: 0.3, amount: -109.17 }] };
    const breakdown = {
      buildingsRate: 0.002, contentsRate: 0.003, jewelleryRate: 0.025,
      otherAllRisksRate: 0.015, discounts: 0.3, loadings: 0.1,
      buildingsPremium: 210, contentsPremium: 140, netPremium: 263.39,
      adminFee: 18, europAssistanceFee: 12, grossPremium: 293.39,
      unknownScalar: 0.7,
    };
    renderComponent({ primary: { calculationTrace: trace }, breakdown,
      cost: { subtotalNetPremium: 263.39 }, setShowPricingSteps });
    for (const label of ['Buildings Rate', 'Contents Rate', 'Jewellery Rate', 'Other All Risks Rate', 'Discounts', 'Loadings', 'Unknown Scalar'])
      expect(screen.queryByText(label)).toBeNull();
    expect(screen.queryByText('€0.30')).toBeNull();
    expect(screen.queryByText('€0.03')).toBeNull();
    expect(screen.getByText('Home Emergency Assistance Fee')).toBeInTheDocument();
    expect(screen.getByText('€12.00')).toBeInTheDocument();
    expect(screen.getByText('EUR 293.39')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('View rating steps & inputs used'));
    expect(setShowPricingSteps).toHaveBeenCalledWith(true);
    expect(trace.steps[0]).toEqual({ id: 'home.discounts', name: 'Discounts', rate: 0.3, amount: -109.17 });
  });

  it('keeps Motor age and premium multipliers out of monetary rows', () => {
    renderComponent({ breakdown: { tplFinal: 200, compFinal: 300,
      youngestDriverAge: 27, tplClaimsFactor: 1.3, compExcessFactor: 0.8 } });
    expect(screen.getByText('Third-party liability premium')).toBeInTheDocument();
    expect(screen.getByText('Comprehensive premium')).toBeInTheDocument();
    expect(screen.queryByText('€27.00')).toBeNull();
    expect(screen.queryByText('€1.30')).toBeNull();
    expect(screen.queryByText('€0.80')).toBeNull();
  });

  it('renders the canonical breakdown.lines verbatim (base → addons → admin fee), driven by the rate engine', () => {
    // ABY-264 — when the rate engine emits `breakdown.lines` (today:
    // travel; motor/home follow), the BO Premium tab MUST render those
    // exact lines, so the operator sees the same base → addons →
    // admin fee → total breakdown the customer sees on the wizard
    // sidebar, the payment step and the PDF schedule. The previous
    // flat-key projection silently dropped per-addon detail because
    // `addonBreakdown` is an object — that gap is what the client
    // reported as "the BO's lack of breakdown of the extras".
    renderComponent({
      primary: { calculationTrace: { steps: [] } },
      breakdown: {
        basePremium: 80,
        addonsTotal: 30,
        adminFee: 18,
        grossPremium: 128,
        lines: [
          { code: 'base', label: 'Base premium', amount: 80, kind: 'base' },
          { code: 'addon.businessCover', label: 'Business Cover', amount: 20, kind: 'addon' },
          { code: 'addon.golfCover', label: 'Golf Cover', amount: 10, kind: 'addon' },
          { code: 'fee.admin', label: 'Admin fee', amount: 18, kind: 'fee' },
          { code: 'total', label: 'Total', amount: 128, kind: 'total' },
        ],
      },
    });
    expect(screen.getByText('Base premium')).toBeTruthy();
    expect(screen.getByText('Business Cover')).toBeTruthy();
    expect(screen.getByText('Golf Cover')).toBeTruthy();
    expect(screen.getByText('Admin fee')).toBeTruthy();
  });
});

describe('PremiumPricingBreakdown adjustments drawer', () => {
  it('is collapsed by default and expands from CTA', () => {
    renderComponent();
    expect(screen.queryByText('Pricing adjustment')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Add adjustment' }));
    expect(screen.getByText('Pricing adjustment')).toBeTruthy();
    expect(screen.getByText('Applies to: Policy')).toBeTruthy();
  });

  it('requires schedule note text before adding note line', () => {
    const { patchQuoteData, onRecalculate } = renderComponent();
    fireEvent.click(screen.getByRole('button', { name: '+ Add adjustment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Schedule note' }));

    const addButton = screen.getByRole('button', { name: 'Add to table' }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Schedule note text'), { target: { value: 'No cover on race track.' } });
    expect(addButton.disabled).toBe(false);
    fireEvent.click(addButton);

    expect(patchQuoteData).toHaveBeenCalledTimes(1);
    const payload = patchQuoteData.mock.calls[0]?.[0] as Record<string, unknown>;
    const lines = (payload.uwAdjustments as Array<Record<string, unknown>>) || [];
    expect(String(lines[0]?.lineType || '')).toBe('schedule_note');
    expect(onRecalculate).not.toHaveBeenCalled();
  });

  it('requires reason for non-zero pricing adjustments and rerates with saved quoteData', async () => {
    const { patchQuoteData, onRecalculate } = renderComponent();
    fireEvent.click(screen.getByRole('button', { name: '+ Add adjustment' }));

    fireEvent.change(screen.getByPlaceholderText('Amount'), { target: { value: '10' } });
    const addButton = screen.getByRole('button', { name: 'Add to table' }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Reason (required if non-zero)'), { target: { value: 'Load for prior claim history' } });
    expect(addButton.disabled).toBe(false);
    fireEvent.click(addButton);

    await waitFor(() => expect(patchQuoteData).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onRecalculate).toHaveBeenCalledTimes(1));

    const savedPayload = asRecord(patchQuoteData.mock.calls[0]?.[0]);
    const ratedPayload = asRecord(onRecalculate.mock.calls[0]?.[0]);
    const savedAdjustments = Array.isArray(savedPayload.uwAdjustments) ? savedPayload.uwAdjustments : [];
    const ratedAdjustments = Array.isArray(ratedPayload.uwAdjustments) ? ratedPayload.uwAdjustments : [];

    expect(savedAdjustments).toHaveLength(1);
    expect(ratedAdjustments).toHaveLength(1);
    expect(String(asRecord(savedAdjustments[0]).reasonText || '')).toBe('Load for prior claim history');
    expect(ratedPayload).toEqual(savedPayload);
  });
});
