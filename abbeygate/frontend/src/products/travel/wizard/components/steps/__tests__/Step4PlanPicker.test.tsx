/* @vitest-environment happy-dom */
import { fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useForm, useFormContext } from 'react-hook-form';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Step4PlanPicker, formatTravelDateForDisplay } from '../Step4PlanPicker';

const quoteResponse = {
  status: 'QUOTED',
  planOptions: {
    silver: { premium: 100, breakdown: {} },
    gold: { premium: 150, breakdown: {} },
    platinum: { premium: 200, breakdown: {} },
  },
};

function Harness(props: {
  children: ReactNode;
  onValue?: (value: unknown) => void;
  defaultSelectedPlan?: string;
}) {
  const form = useForm({
    defaultValues: {
      travellers: { coverType: 'single' },
      trip: {
        planType: 'single_trip',
        destinations: ['europe'],
        startDate: '2026-05-15',
        endDate: '2026-05-22',
      },
      quote: { selectedPlan: props.defaultSelectedPlan || '' },
    },
  });
  return <FormProvider {...form}>{props.children}</FormProvider>;
}

function ValueProbe(props: { onValue: (value: unknown) => void }) {
  const { getValues } = useFormContext();
  return (
    <button type="button" onClick={() => props.onValue(getValues('quote.selectedPlan'))}>
      probe selected plan
    </button>
  );
}

describe('Step4PlanPicker', () => {
  it('formats ISO date-only values without timezone shifting the day', () => {
    expect(formatTravelDateForDisplay('2026-05-15')).toBe('15/05/2026');
  });

  it('does not pretend Silver is selected before the customer selects a plan', () => {
    render(
      <Harness>
        <Step4PlanPicker loading={false} quoteResponse={quoteResponse} onRate={vi.fn()} />
      </Harness>,
    );

    expect(screen.queryByText('Selected')).not.toBeInTheDocument();
    expect(screen.getByText('15/05/2026 to 22/05/2026')).toBeInTheDocument();
  });

  it('persists selected plan before advancing', () => {
    const onValue = vi.fn();
    const onSelectPlan = vi.fn();
    render(
      <Harness>
        <Step4PlanPicker loading={false} quoteResponse={quoteResponse} onRate={vi.fn()} onSelectPlan={onSelectPlan} />
        <ValueProbe onValue={onValue} />
      </Harness>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Select' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'probe selected plan' }));

    expect(onSelectPlan).toHaveBeenCalledWith('silver');
    expect(onValue).toHaveBeenCalledWith('silver');
  });

  it('shows referral as a terminal review panel without selectable plan chrome', () => {
    render(
      <Harness>
        <Step4PlanPicker
          loading={false}
          quoteResponse={{
            status: 'REFERRAL',
            uwDecision: {
              reasons: [{ message: 'No rate cell available for silver/Single trip/Worldwide excl/Individual/31d/36-50' }],
            },
          }}
          onRate={vi.fn()}
        />
      </Harness>,
    );

    expect(screen.getByText('This trip needs specialist review')).toBeInTheDocument();
    expect(screen.getByText(/No rate cell available/)).toBeInTheDocument();
    expect(screen.queryByText('Your quote results')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument();
  });
});
