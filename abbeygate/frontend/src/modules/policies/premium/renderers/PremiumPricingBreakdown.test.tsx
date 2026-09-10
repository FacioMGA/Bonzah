/* @vitest-environment happy-dom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PremiumPricingBreakdown } from './PremiumPricingBreakdown';

function renderComponent(overrides?: Partial<React.ComponentProps<typeof PremiumPricingBreakdown>>) {
  const patchQuoteData = vi.fn();
  const onRecalculate = vi.fn();
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

  it('requires reason for non-zero pricing adjustments', async () => {
    vi.useFakeTimers();
    const { patchQuoteData, onRecalculate } = renderComponent();
    fireEvent.click(screen.getByRole('button', { name: '+ Add adjustment' }));

    fireEvent.change(screen.getByPlaceholderText('Amount'), { target: { value: '10' } });
    const addButton = screen.getByRole('button', { name: 'Add to table' }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Reason (required if non-zero)'), { target: { value: 'Load for prior claim history' } });
    expect(addButton.disabled).toBe(false);
    fireEvent.click(addButton);

    expect(patchQuoteData).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(60);
    });
    expect(onRecalculate).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
