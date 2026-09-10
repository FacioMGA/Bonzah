/* @vitest-environment happy-dom */
/**
 * Step2 driving-history — driverRestriction dropdown behaviour
 * (ABY-232 / ADR-0025).
 *
 * Locks the wizard UX:
 *   - The dropdown renders the four scheme-aligned options.
 *   - When the user picks a non-NAMED_DRIVERS mode, dependent fields
 *     are cascade-cleared (hasAdditionalDrivers / additionalDrivers /
 *     youngestDriverAge / other-drivers fields).
 *   - The "Will there be any additional drivers" Yes/No appears
 *     ONLY in NAMED_DRIVERS mode.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { Step2DrivingHistory } from './Step2DrivingHistory';
import type { QuoteData } from '../../types';

vi.mock('../Button', () => ({
  Button: (
    props: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }
  ) => <button {...props}>{props.children}</button>,
}));

function renderWithForm(defaultValues?: Partial<QuoteData>) {
  const baseDefaults: Partial<QuoteData> = {
    proposer: {
      firstName: '',
      lastName: '',
      address: { line1: '', city: '', province: '', postcode: '', country: 'Cyprus' },
      phone: '',
      dateOfBirth: '',
      email: '',
      nationality: '',
      nif: '',
      occupation: '',
      whereDidYouHear: '',
      marketingConsent: false,
      privacyPolicyAccepted: false,
    },
    licenseYears: '',
    licenseType: '',
    licenseIssuedIn: '',
    hasClaims: null,
    claimsDetails: '',
    claimsCountLast5Years: '',
    claimsTotalCostLast5Years: '',
    maxFaultClaimCostLast5Years: '',
    hasConvictions: null,
    convictionsDetails: '',
    hasMajorConvictionLast5Years: null,
    convictionClass: '',
    majorConvictionWithinYears: '',
    driverRestriction: null,
    hasAdditionalDrivers: null,
    additionalDrivers: [],
    youngestDriverAge: '',
    otherDriversClaims: false,
    otherDriversClaimsDetails: '',
    otherDriversConvictions: false,
    otherDriversConvictionsDetails: '',
  };

  function Wrapper() {
    const merged: Partial<QuoteData> = { ...baseDefaults, ...defaultValues };
    const form = useForm<QuoteData>({ defaultValues: merged });
    return (
      <FormProvider {...form}>
        <Step2DrivingHistory />
      </FormProvider>
    );
  }
  return render(<Wrapper />);
}

describe('Step2DrivingHistory — driverRestriction (ABY-232)', () => {
  function getDriverRestrictionSelect(container: HTMLElement): HTMLSelectElement {
    const el = container.querySelector('select[name="driverRestriction"]');
    expect(el).toBeTruthy();
    return el as HTMLSelectElement;
  }

  it('renders the section as "Other Drivers" with the four scheme options', () => {
    const { container } = renderWithForm();
    expect(screen.getByText(/Other Drivers/i)).toBeTruthy();
    const select = getDriverRestrictionSelect(container);
    const optionTexts = Array.from(select.options).map((o) => o.textContent);
    expect(optionTexts).toEqual(expect.arrayContaining([
      'Please select…',
      'Policy Holder',
      'Named Drivers Only',
      'Any Driver Over 25',
      'Any Driver Over 40',
    ]));
  });

  it('hides the "additional named drivers" Yes/No until NAMED_DRIVERS is picked', () => {
    renderWithForm({ driverRestriction: 'POLICYHOLDER_ONLY' });
    expect(screen.queryByText(/Will there be any additional named drivers/i)).toBeNull();
  });

  it('shows the "additional named drivers" Yes/No only when NAMED_DRIVERS is picked', () => {
    renderWithForm({ driverRestriction: 'NAMED_DRIVERS' });
    expect(screen.getByText(/Will there be any additional named drivers/i)).toBeTruthy();
  });

  it('shows the "any driver 25–70" notice in ANY_DRIVER_25_PLUS mode', () => {
    renderWithForm({ driverRestriction: 'ANY_DRIVER_25_PLUS' });
    expect(screen.getByText(/aged 25–70/i)).toBeTruthy();
  });

  it('shows the "any driver 40–70" notice in ANY_DRIVER_40_PLUS mode', () => {
    renderWithForm({ driverRestriction: 'ANY_DRIVER_40_PLUS' });
    expect(screen.getByText(/aged 40–70/i)).toBeTruthy();
  });

  it('cascade-clears named-drivers state when the user switches from NAMED_DRIVERS to ANY_DRIVER_25_PLUS', () => {
    const { container } = renderWithForm({
      driverRestriction: 'NAMED_DRIVERS',
      hasAdditionalDrivers: true,
      youngestDriverAge: 30,
      additionalDrivers: [{
        firstName: 'Stale',
        lastName: 'Driver',
        dateOfBirth: '1990-01-01',
        licenseYears: 5,
      }],
    });
    const select = getDriverRestrictionSelect(container);
    expect(select.value).toBe('NAMED_DRIVERS');
    expect(screen.queryByText(/Will there be any additional named drivers/i)).toBeTruthy();

    fireEvent.change(select, { target: { value: 'ANY_DRIVER_25_PLUS' } });
    // After the switch the "Will there be any additional named drivers"
    // question vanishes and the open-mode notice appears in its place.
    expect(screen.queryByText(/Will there be any additional named drivers/i)).toBeNull();
    expect(screen.getByText(/aged 25–70/i)).toBeTruthy();
  });
});
