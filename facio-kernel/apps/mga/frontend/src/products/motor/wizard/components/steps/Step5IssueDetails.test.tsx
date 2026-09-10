/* @vitest-environment happy-dom */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { Step5IssueDetails } from './Step5IssueDetails';
import type { QuoteData } from '../../types';

vi.mock('../Button', () => ({
  Button: (
    props: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }
  ) => <button {...props}>{props.children}</button>,
}));

function renderWithForm(ui: React.ReactElement, defaultValues?: Partial<QuoteData>) {
  function Wrapper() {
    const form = useForm<QuoteData>({
      defaultValues: {
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
        hasAdditionalDrivers: false,
        additionalDrivers: [],
        youngestDriverAge: '',
        otherDriversClaims: false,
        otherDriversClaimsDetails: '',
        otherDriversConvictions: false,
        otherDriversConvictionsDetails: '',
        vehicleLocation: '',
        coverRequired: '',
        renewalDate: '',
        vehicleType: '',
        motorcycleRidersNamed: null,
        classicIsGenuine: null,
        classicIsSecondaryVehicle: null,
        make: '',
        model: '',
        cabrio: '',
        fuelType: '',
        kmsPerYear: '',
        year: 0,
        countryOfRegistration: '',
        registrationNumber: '',
        vin: '',
        numberOfSeats: 0,
        modified: null,
        modificationsDetails: '',
        parking: '',
        parkingOther: '',
        engineSize: 0,
        vehicleValue: 0,
        ncb: '',
        protectNCB: false,
        vehicleUse: '',
        requiredExcess: '',
        infoTrueAndAccurate: false,
        fairProcessingAccepted: false,
        ...defaultValues,
      },
    });
    return <FormProvider {...form}>{ui}</FormProvider>;
  }
  return render(<Wrapper />);
}

describe('Step5IssueDetails', () => {
  it('renders mapped issuance fields in flow input style', async () => {
    renderWithForm(
      <Step5IssueDetails
        missingFields={[
          { slug: 'vehicle.registration', label: 'Registration number' },
          { slug: 'insured.nif', label: 'Identity number / NIF' },
        ]}
        conditionalRequirements={[]}
        checking={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/registration number/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/identity number \/ nif/i)).toBeInTheDocument();
    });
  });

  it('collects NIF when the canonical issuance gate reports it as missing', async () => {
    renderWithForm(
      <Step5IssueDetails
        missingFields={[{ slug: 'proposer.nif', label: 'Identity number / NIF' }]}
        conditionalRequirements={[]}
        checking={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/identity number \/ nif/i)).toBeInTheDocument();
    });
  });

  it('renders canonical manifest-path issuance slugs without dropping them into "Additional required fields" (ABY-30)', async () => {
    renderWithForm(
      <Step5IssueDetails
        missingFields={[
          { slug: 'licenseYears', label: 'Years holding licence' },
          { slug: 'licenseType', label: 'Licence type' },
          { slug: 'licenseIssuedIn', label: 'Country licence issued in' },
          { slug: 'proposer.firstName', label: 'First name' },
        ]}
        conditionalRequirements={[]}
        checking={false}
      />
    );

    await waitFor(() => {
      // Each canonical slug should produce its own input — not a dead
      // entry in the "Additional required fields" list.
      expect(screen.getByPlaceholderText(/years holding licence/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/^licence type$/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/country licence issued in/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/^first name$/i)).toBeInTheDocument();
    });
    // The "Additional required fields" panel must NOT appear for any
    // of these — they all mapped successfully.
    expect(screen.queryByText(/additional required fields/i)).toBeNull();
  });

  it('auto-seeds first additional driver row when enabled', async () => {
    renderWithForm(
      <Step5IssueDetails
        missingFields={[{ slug: 'vehicle.registration', label: 'Registration number' }]}
        conditionalRequirements={[]}
        checking={false}
      />,
      {
        registrationNumber: 'KAA123',
        hasAdditionalDrivers: true,
        additionalDrivers: [],
      }
    );

    await waitFor(() => {
      expect(screen.getByText('Driver 2')).toBeInTheDocument();
    });
  });

  it('labels every additional-driver control (no placeholder-only inputs)', async () => {
    renderWithForm(
      <Step5IssueDetails
        missingFields={[{ slug: 'vehicle.registration', label: 'Registration number' }]}
        conditionalRequirements={[]}
        checking={false}
      />,
      {
        registrationNumber: 'KAA123',
        hasAdditionalDrivers: true,
        additionalDrivers: [],
      }
    );

    await waitFor(() => {
      expect(screen.getByText('Driver 2')).toBeInTheDocument();
    });
    // FormField renders an explicit label on every control — DOB and
    // licence years previously rendered placeholder-only.
    expect(screen.getAllByText(/^Date of birth$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Years holding licence$/i).length).toBeGreaterThan(0);
  });

  // ABY-235 — when validateMotorIssuanceStage (per ABY-104) reports BOTH
  // registrationNumber and vin as missing, Step5 must render ONE switched
  // input matching Step 3 Vehicle Cover's UX, NOT two parallel required
  // inputs. Either side filled is enough to satisfy the gate.
  it('collapses registrationNumber + vin into a single either-or switched field when both are missing', async () => {
    renderWithForm(
      <Step5IssueDetails
        missingFields={[
          { slug: 'vehicle.registration', label: 'Registration number' },
          { slug: 'vehicle.vin', label: 'VIN' },
        ]}
        conditionalRequirements={[]}
        checking={false}
      />
    );

    await waitFor(() => {
      // The switched field shows exactly one of the two inputs at a time
      // — the user picks via the Registration / VIN segmented switch.
      expect(screen.getByPlaceholderText(/e\.g\. KAA123/i)).toBeInTheDocument();
    });
    // VIN input must NOT also be rendered alongside (avoids the two-mandatory bug).
    expect(screen.queryByPlaceholderText(/Enter VIN \(11-17 characters\)/i)).toBeNull();
    // The either-or hint should be visible so the operator knows only one is required.
    expect(screen.getByText(/Either Registration number or VIN is fine/i)).toBeInTheDocument();
    // Both segmented switch options must be present.
    expect(screen.getByRole('button', { name: /Registration/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^VIN$/i })).toBeInTheDocument();
  });

  it('renders the plain registration input (no switch) when only registrationNumber is missing', async () => {
    renderWithForm(
      <Step5IssueDetails
        missingFields={[{ slug: 'vehicle.registration', label: 'Registration number' }]}
        conditionalRequirements={[]}
        checking={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/^registration number$/i)).toBeInTheDocument();
    });
    // Switch must NOT render when only one side of the either-or is missing.
    expect(screen.queryByText(/Either Registration number or VIN is fine/i)).toBeNull();
  });
});
