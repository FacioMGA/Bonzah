import { describe, expect, it } from 'vitest';
import {
  validateWizardPolicyHolderStep,
  validateWizardDrivingHistoryStep,
  validateWizardVehicleCoverStep,
} from '../index.js';

// Phase 6k: every personal-detail field lives under `proposer.*` — flat
// keys are no longer accepted by the wizard schemas. These helpers build
// the nested payloads in one place so the assertions stay readable.
function makeProposer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-01-01',
    email: 'jane@example.com',
    phone: '+35799999999',
    nationality: 'Cyprus',
    privacyPolicyAccepted: true,
    address: {
      line1: '123 Long Street',
      city: 'Limassol',
      province: 'Limassol',
      postcode: '3020',
      country: 'Cyprus',
    },
    ...overrides,
  };
}

describe('quote wizard validation contract', () => {
  it('keeps step 1 required field messaging stable (canonical proposer.* paths)', () => {
    const errors = validateWizardPolicyHolderStep({
      proposer: makeProposer({ firstName: '' }),
    });

    expect(errors['proposer.firstName']).toBe('Please enter your first name (min 2 characters)');
  });

  it('Phase 6k: rejects flat root-level policyholder fields', () => {
    // Flat keys at the root of the wizard payload must NEVER be honored.
    const errors = validateWizardPolicyHolderStep({
      firstName: 'Jane',
      lastName: 'Doe',
      addressLine: '123 Long Street',
      city: 'Limassol',
      province: 'Limassol',
      postCode: '3020',
      country: 'Cyprus',
      telephone: '+35799123456',
      dateOfBirth: '1990-01-01',
      email: 'jane@example.com',
      nationality: 'Cyprus',
      privacyPolicyAccepted: true,
    });

    // The schema reports a proposer-level error.
    expect(errors.proposer).toBeDefined();
    // No flat-shape error keys are emitted.
    expect(errors.firstName).toBeUndefined();
    expect(errors.lastName).toBeUndefined();
    expect(errors.email).toBeUndefined();
    expect(errors.telephone).toBeUndefined();
    expect(errors.addressLine).toBeUndefined();
  });

  it('Phase 6k: nested canonical proposer block passes', () => {
    const errors = validateWizardPolicyHolderStep({
      proposer: makeProposer(),
    });
    expect(errors).toEqual({});
  });

  it('does not apply an upper proposer-age cap for private motor policyholder validation', () => {
    const errors = validateWizardPolicyHolderStep({
      proposer: makeProposer({ dateOfBirth: '1938-01-01' }),
    });
    expect(errors['proposer.dateOfBirth']).toBeUndefined();
  });

  it('does not require province when the policy-holder UI has no province field', () => {
    const proposer = makeProposer({
      address: {
        line1: '123 Long Street',
        city: 'Limassol',
        postcode: '3020',
        country: 'Cyprus',
      },
    });

    const errors = validateWizardPolicyHolderStep({ proposer });

    expect(errors['proposer.address.province']).toBeUndefined();
    expect(errors).toEqual({});
  });

  it('requires the foreign-licence confirmation for a non-UK/EU licence', () => {
    const base = {
      proposer: { occupation: 'Engineer', whereDidYouHear: 'Google' },
      licenseYears: 5,
      licenseType: 'Full',
      hasClaims: false,
      hasConvictions: false,
      driverRestriction: 'POLICYHOLDER_ONLY',
    };

    // Non-UK/EU (Russia) without the tick fails on the confirmation path.
    const missing = validateWizardDrivingHistoryStep({ ...base, licenseIssuedIn: 'Russia' });
    expect(missing.licenseForeignDeclarationAccepted).toContain('without supervision');

    // Same licence with the tick passes the confirmation rule.
    const accepted = validateWizardDrivingHistoryStep({
      ...base,
      licenseIssuedIn: 'Russia',
      licenseForeignDeclarationAccepted: true,
    });
    expect(accepted.licenseForeignDeclarationAccepted).toBeUndefined();

    // UK / EU / "Other EU" never require the confirmation.
    for (const country of ['United Kingdom', 'Cyprus', 'Portugal', 'Other EU']) {
      const errs = validateWizardDrivingHistoryStep({ ...base, licenseIssuedIn: country });
      expect(errs.licenseForeignDeclarationAccepted).toBeUndefined();
    }
  });

  it('keeps step 2 license-issued-in requirement intact', () => {
    const errors = validateWizardDrivingHistoryStep({
      proposer: {
        occupation: 'Engineer',
        whereDidYouHear: 'Google',
        dateOfBirth: '1990-01-01',
      },
      licenseYears: 5,
      licenseType: 'Full',
      licenseIssuedIn: '',
      hasClaims: false,
      hasConvictions: false,
      hasAdditionalDrivers: false,
    });

    expect(errors.licenseIssuedIn).toBe('Please select where your license was issued');
  });

  it('rejects string-typed numbers (Phase 8 strictness)', () => {
    const errors = validateWizardDrivingHistoryStep({
      proposer: {
        occupation: 'Engineer',
        whereDidYouHear: 'Google',
        dateOfBirth: '1990-01-01',
      },
      licenseYears: '5',
      licenseType: 'Full',
      licenseIssuedIn: 'Cyprus',
      hasClaims: false,
      hasConvictions: false,
      hasAdditionalDrivers: false,
    });

    expect(errors.licenseYears).toBeDefined();
  });

  it('requires conviction class to match the major-conviction answer', () => {
    const base = {
      proposer: {
        occupation: 'Engineer',
        whereDidYouHear: 'Google',
        dateOfBirth: '1990-01-01',
      },
      licenseYears: 5,
      licenseType: 'Full',
      licenseIssuedIn: 'Cyprus',
      hasClaims: false,
      hasConvictions: true,
      convictionsDetails: 'Declared conviction details',
      hasAdditionalDrivers: false,
    };

    expect(validateWizardDrivingHistoryStep({
      ...base,
      hasMajorConvictionLast5Years: true,
      convictionClass: 'minor_technical',
    }).convictionClass).toContain('Major conviction');

    expect(validateWizardDrivingHistoryStep({
      ...base,
      hasMajorConvictionLast5Years: false,
      convictionClass: 'major',
      majorConvictionWithinYears: 3,
    }).convictionClass).toContain('cannot be selected');
  });

  it('requires structured conviction entries when convictions are declared', () => {
    const errors = validateWizardDrivingHistoryStep({
      proposer: {
        occupation: 'Engineer',
        whereDidYouHear: 'Google',
        dateOfBirth: '1990-01-01',
      },
      licenseYears: 5,
      licenseType: 'Full',
      licenseIssuedIn: 'Cyprus',
      hasClaims: false,
      hasConvictions: true,
      motorConvictions: [
        { date: '', convictionClass: '', description: '' },
      ],
      convictionsDetails: '',
      hasMajorConvictionLast5Years: false,
      convictionClass: '',
      hasAdditionalDrivers: false,
    });

    expect(errors['motorConvictions.0.date']).toContain('conviction date');
    expect(errors['motorConvictions.0.convictionClass']).toContain('conviction type');
    expect(errors['motorConvictions.0.description']).toContain('describe');
  });

  it('accepts structured conviction entries that feed the summary conviction fields', () => {
    const errors = validateWizardDrivingHistoryStep({
      proposer: {
        occupation: 'Engineer',
        whereDidYouHear: 'Google',
        dateOfBirth: '1990-01-01',
      },
      licenseYears: 5,
      licenseType: 'Full',
      licenseIssuedIn: 'Cyprus',
      hasClaims: false,
      hasConvictions: true,
      motorConvictions: [
        {
          date: '2025-01-01',
          convictionClass: 'serious_technical',
          description: 'Speeding endorsement resolved with fine.',
        },
      ],
      convictionsDetails: '#1 — date: 2025-01-01 — type: Serious technical offence — details: Speeding endorsement resolved with fine.',
      hasMajorConvictionLast5Years: false,
      convictionClass: 'serious_technical',
      hasAdditionalDrivers: false,
    });

    expect(errors).toEqual({});
  });

  it('keeps step 3 declaration requirement unchanged', () => {
    const errors = validateWizardVehicleCoverStep({
      proposer: { bestTimeToCall: 'Anytime' },
      vehicleLocation: 'Cyprus',
      countryOfRegistration: 'Cyprus',
      registrationNumber: '',
      vin: 'WAUZZZ8V0LA123456',
      coverRequired: 'Comprehensive',
      renewalDate: '2030-01-01',
      vehicleType: 'Car',
      make: 'Toyota',
      model: 'Corolla',
      cabrio: 'No',
      parking: 'Drive',
      fuelType: 'Petrol',
      kmsPerYear: '10,000',
      year: 2020,
      numberOfSeats: 5,
      modified: false,
      engineSize: 1800,
      vehicleValue: 15000,
      ncb: '1 Year',
      vehicleUse: 'social',
      infoTrueAndAccurate: false,
      fairProcessingAccepted: true,
    });

    expect(errors.infoTrueAndAccurate).toBe(
      'You must confirm that the information provided is true and accurate'
    );
  });

  it('uses libphonenumber-js for phone validation (no React deps)', () => {
    // Valid CY mobile
    const ok = validateWizardPolicyHolderStep({
      proposer: makeProposer({ phone: '+35799123456' }),
    });
    expect(ok['proposer.phone']).toBeUndefined();

    // Obviously invalid phone
    const bad = validateWizardPolicyHolderStep({
      proposer: makeProposer({ phone: 'abc' }),
    });
    expect(bad['proposer.phone']).toBe('Please enter a valid phone number');
  });
});
