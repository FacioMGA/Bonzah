/* @vitest-environment happy-dom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { annualTravelPolicyEndDateFromStart } from '@facio/products';
import { Step3TripDetails } from '../Step3TripDetails';

function Harness({
  children,
  defaultValues,
}: {
  children: ReactNode;
  defaultValues?: Record<string, unknown>;
}) {
  const form = useForm({
    defaultValues: defaultValues ?? {
      trip: { planType: '', destinations: [], startDate: '', endDate: '' },
    },
    mode: 'onBlur',
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe('Travel Step3TripDetails', () => {
  // ABY-254 — Single-trip destinations are a country multi-select (the
  // full canonical country list). Annual multi-trip keeps the three
  // territory buckets. Both shapes persist `trip.destinations: string[]`
  // and the rater's `mapDestinationsToArea` already accepts either
  // shape, so no backend coupling is needed.

  it('collects contact details before showing travel plans', () => {
    render(
      <Harness
        defaultValues={{
          proposer: { firstName: '', lastName: '', email: '', phone: '' },
          trip: { planType: 'single_trip', destinations: [], startDate: '', endDate: '' },
        }}
      >
        <Step3TripDetails />
      </Harness>,
    );

    expect(screen.getByText('Your contact details')).toBeInTheDocument();
    expect(screen.getByText('First name')).toBeInTheDocument();
    expect(screen.getByText('Last name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
  });

  it('shows country multi-select for single trip (ABY-254)', () => {
    render(
      <Harness
        defaultValues={{
          trip: { planType: 'single_trip', destinations: [], startDate: '', endDate: '' },
        }}
      >
        <Step3TripDetails />
      </Harness>,
    );

    // Default: no countries selected — placeholder copy is visible.
    expect(screen.getByText('Add the countries you will visit…')).toBeInTheDocument();
    // The territory single-select copy must NOT be on the page for single trip.
    expect(screen.queryByText('Select territory…')).toBeNull();
  });

  it('shows the three territory choices for annual multi-trip (ABY-254)', () => {
    render(
      <Harness
        defaultValues={{
          trip: { planType: 'annual_multi_trip', destinations: [], startDate: '', endDate: '' },
        }}
      >
        <Step3TripDetails />
      </Harness>,
    );

    fireEvent.click(screen.getByText('Select territory…'));

    expect(screen.getByText('Europe')).toBeInTheDocument();
    expect(screen.getByText('Worldwide excluding the USA and Canada')).toBeInTheDocument();
    expect(screen.getByText('Worldwide including the USA and Canada')).toBeInTheDocument();
    expect(screen.getByText(/Please select the territory/)).toBeInTheDocument();
    // The multi-select placeholder MUST NOT show in annual mode.
    expect(screen.queryByText('Add the countries you will visit…')).toBeNull();
  });

  it('pins the trip start picker so cover cannot start before today', () => {
    render(
      <Harness
        defaultValues={{
          trip: { planType: 'single_trip', destinations: [], startDate: '', endDate: '' },
        }}
      >
        <Step3TripDetails />
      </Harness>,
    );
    const picker = screen.getByRole('button', { name: /open trip start date picker/i });
    fireEvent.click(picker);
    const yesterday = new Date();
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);
    expect(screen.getByRole('button', { name: yesterday.toLocaleDateString('en-GB', { dateStyle: 'full' }) })).toBeDisabled();
  });

  it('auto-fills annual policy end date from the start date', async () => {
    const { container } = render(
      <Harness>
        <Step3TripDetails />
      </Harness>,
    );
    const dateInputs = container.querySelectorAll<HTMLInputElement>('input[data-date-input="true"]');
    // The production field refuses dates before today. Keep this regression
    // proof future-safe instead of hard-coding a date that will naturally
    // become invalid as time passes.
    const start = new Date();
    start.setDate(start.getDate() + 14);
    const startIso = [
      start.getFullYear(),
      String(start.getMonth() + 1).padStart(2, '0'),
      String(start.getDate()).padStart(2, '0'),
    ].join('-');
    const expectedEndIso = annualTravelPolicyEndDateFromStart(startIso);
    const expectedEndDisplay = `${expectedEndIso.slice(8, 10)}/${expectedEndIso.slice(5, 7)}/${expectedEndIso.slice(0, 4)}`;

    fireEvent.change(dateInputs[0]!, { target: { value: `${startIso.slice(8, 10)}/${startIso.slice(5, 7)}/${startIso.slice(0, 4)}` } });
    fireEvent.click(screen.getByLabelText('Annual Multi-Trip'));

    await waitFor(() => {
      expect(dateInputs[1]?.value).toBe(expectedEndDisplay);
    });
    expect(screen.getByText(/runs for 12 months/)).toBeInTheDocument();
  });

  it('clears the auto-filled annual end date when switching back to single trip (ABY-273)', async () => {
    // ABY-273 regression — switching from Annual Multi-Trip → Single
    // Trip must clear the start+1y end date the annual policy
    // auto-populated. Without this fix the single-trip date picker
    // shows a year-out value that the customer has to wipe manually
    // and that the /rate call would otherwise pick up as a year-long
    // single trip (instant REFER on the 62-day cap).
    const { container } = render(
      <Harness
        defaultValues={{
          trip: { planType: 'annual_multi_trip', destinations: ['europe'], startDate: '2026-06-01', endDate: '2027-05-31' },
        }}
      >
        <Step3TripDetails />
      </Harness>,
    );
    const dateInputs = container.querySelectorAll<HTMLInputElement>('input[data-date-input="true"]');
    // Pre-condition: annual mode pre-populated the end date.
    expect(dateInputs[1]?.value).toBe('31/05/2027');

    fireEvent.click(screen.getByLabelText('Single Trip'));

    await waitFor(() => {
      expect(dateInputs[1]?.value).toBe('');
    });
  });

  it('does not wipe a single-trip end date when the start date changes (ABY-404)', async () => {
    const { container } = render(
      <Harness
        defaultValues={{
          trip: { planType: 'single_trip', destinations: ['Italy'], startDate: '2026-09-16', endDate: '2026-10-05' },
        }}
      >
        <Step3TripDetails />
      </Harness>,
    );
    const dateInputs = container.querySelectorAll<HTMLInputElement>('input[data-date-input="true"]');
    expect(dateInputs[1]?.value).toBe('05/10/2026');

    fireEvent.change(dateInputs[0]!, { target: { value: '17/09/2026' } });

    await waitFor(() => {
      expect(dateInputs[0]?.value).toBe('17/09/2026');
    });
    expect(dateInputs[1]?.value).toBe('05/10/2026');
  });
});
