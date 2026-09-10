/**
 * Motor profile — package-level contract tests.
 *
 * Phase 8 (2026-04-28) closure: the previous IoC seam
 * (`attachMotorWizardStepValidators` / `_resetMotorWizardStepValidatorsForTests`)
 * was deleted along with motor's FE-only Zod copy. These tests now
 * pin the canonical profile's metadata + the direct wiring of the
 * step refinements to the in-package schemas.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ValidationRegistry, validateForContext } from '@facio/validation/frontend';
import { motorManifest } from '../manifest.js';
import { motorValidationProfile } from '../profile.js';

beforeEach(() => {
  ValidationRegistry._resetForTests();
  ValidationRegistry.register(motorValidationProfile);
});

describe('motor profile — metadata contract', () => {
  it('exports productCode MOTOR and the expected step ids', () => {
    expect(motorValidationProfile.productCode).toBe('MOTOR');
    const stepIds = motorValidationProfile.steps.map((s) => s.id);
    expect(stepIds).toEqual(['policy-holder', 'vehicle-cover', 'driving-history']);
  });

  it('declares the bind-required fields BO Underwriting consumes (canonical proposer.* paths)', () => {
    const { fields } = motorValidationProfile;
    expect(fields['proposer.firstName']?.requiredAtByActor?.customer).toContain('bind');
    expect(fields['proposer.email']?.requiredAtByActor?.underwriter).toContain('bind');
    expect(fields['proposer.privacyPolicyAccepted']?.requiredAtStages).toContain('bind');
    // `additionalDrivers` is conditionally required (only when
    // `hasAdditionalDrivers === true`), so it carries no field-level
    // `requiredAtStages`. The conditional check lives in the bind /
    // issuance stage refinements (`validateMotorBindStage`).
    expect(fields.additionalDrivers?.dataClassification).toBe('canonical');
    expect(fields.additionalDrivers?.requiredAtStages).toBeUndefined();
  });

  it('requires NIF at issuance only, after a Motor customer has received a quote', () => {
    const { fields } = motorValidationProfile;

    expect(fields['proposer.nif']?.requiredAtStages).toEqual(['issuance']);
    expect(fields['proposer.nif']).toMatchObject({ rule: 'nif', label: 'NIF / tax ID' });
  });

  it('preserves all requested Portuguese lead sources in the canonical manifest', () => {
    const source = motorManifest.questionnaire.sections
      .flatMap((section) => section.fields)
      .find((field) => field.path === 'proposer.whereDidYouHear');
    const values = source?.options?.map((option) => option.value) || [];

    expect(values).toEqual(expect.arrayContaining([
      'Google', 'Existing Client', 'Recommendation', 'Link from another site',
      'Introducer', '4Business Magazine', 'Euro Weekly News', 'Algarve Classified',
      'Algarve Daily News', 'Bing', 'British Chamber of Commerce', 'Facebook',
      'Instagram', 'Kiss FM', 'LinkedIn', 'Mailshot', 'Radio', 'Twitter', 'Other',
    ]));
    expect(source?.options?.find((option) => option.value === 'Twitter')?.label).toBe('Twitter/X');
  });

  it('makes required declarations visible to BO and customer flows', () => {
    const { fields } = motorValidationProfile;
    expect(fields['proposer.privacyPolicyAccepted']?.audience).toBe('all');
    expect(fields.infoTrueAndAccurate?.audience).toBe('all');
    expect(fields.fairProcessingAccepted?.audience).toBe('all');
    expect(fields['proposer.marketingConsent']?.audience).toBe('customer');
  });

  it('renders issue-blocking declarations in the BO questionnaire', () => {
    const declarationFields = motorManifest.questionnaire.sections.find((section) => section.id === 'declarations')?.fields || [];
    expect(declarationFields.map((field) => field.path)).toEqual(expect.arrayContaining([
      'proposer.privacyPolicyAccepted',
      'infoTrueAndAccurate',
      'fairProcessingAccepted',
    ]));
  });

  it('renders conditionally required additional-driver details in the BO questionnaire', () => {
    const drivingFields = motorManifest.questionnaire.sections.find((section) => section.id === 'driving-history')?.fields || [];
    const additionalDriversField = drivingFields.find((field) => field.path === 'additionalDrivers');

    expect(additionalDriversField).toMatchObject({
      type: 'list',
      visibleWhenKey: 'hasAdditionalDrivers',
      visibleWhenValue: true,
      requiredWhenKey: 'hasAdditionalDrivers',
      requiredWhenValue: true,
    });
  });

  it('declares an option authority for every BO questionnaire select field', () => {
    const externalOptionProviders = new Set([
      // Canonical shared contracts resolved by BO at the rendering boundary.
      'proposer.nationality',
      'proposer.address.country',
      // Dynamic vehicle catalogue options loaded from the vehicle service.
      'make',
      'model',
    ]);
    const selectFields = motorManifest.questionnaire.sections
      .flatMap((section) => section.fields)
      .filter((field) => field.type === 'select' || field.type === 'multiselect');

    expect(selectFields.map((field) => field.path).sort()).toEqual([
      'convictionClass',
      'countryOfRegistration',
      'coverRequired',
      'driverRestriction',
      'fuelType',
      'kmsPerYear',
      'licenseIssuedIn',
      'licenseType',
      'licenseYears',
      'majorConvictionWithinYears',
      'make',
      'model',
      'ncb',
      'parking',
      'proposer.address.country',
      'proposer.bestTimeToCall',
      'proposer.nationality',
      'proposer.whereDidYouHear',
      'vehicleType',
      'vehicleUse',
      'youngestDriverAge',
    ]);
    for (const field of selectFields) {
      if (externalOptionProviders.has(field.path)) continue;
      expect(field.options?.length, `${field.path} must declare manifest options or an explicit external provider`).toBeGreaterThan(0);
    }
    expect(selectFields.find((field) => field.path === 'licenseYears')?.options?.[0]).toEqual({
      value: '0',
      label: 'Less than 1 year',
    });
    expect(selectFields.find((field) => field.path === 'youngestDriverAge')?.options?.[0]).toEqual({
      value: '15',
      label: '15',
    });
    expect(selectFields.find((field) => field.path === 'vehicleType')?.options?.map((option) => option.value)).toContain('Car');
  });

  it('does not collect garage total value from motor quotes', () => {
    const field = motorManifest.questionnaire.sections
      .flatMap((section) => section.fields)
      .find((candidate) => candidate.path === 'garageTotalValue');

    expect(field).toBeUndefined();
  });
});

// Phase 6k: every personal-detail field lives under `proposer.*`. These
// helpers build the nested payload in one place so the assertions stay
// readable.
function makeProposer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-01-01',
    email: 'jane@example.com',
    phone: '+35799123456',
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

describe('motor profile — wizard-step validation', () => {
  it('returns no errors for a valid policy-holder payload (canonical shape)', () => {
    const errors = validateForContext({
      productCode: 'MOTOR',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'customer',
      data: { proposer: makeProposer() },
    });
    expect(errors).toEqual({});
  });

  it('accepts over-85 proposers because the supplied private motor scheme has no upper proposer-age referral', () => {
    const errors = validateForContext({
      productCode: 'MOTOR',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'customer',
      data: { proposer: makeProposer({ dateOfBirth: '1938-01-01' }) },
    });
    expect(errors['proposer.dateOfBirth']).toBeUndefined();
  });

  it('reports the canonical "first name required" message when absent', () => {
    const errors = validateForContext({
      productCode: 'MOTOR',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'customer',
      data: { proposer: makeProposer({ firstName: '' }) },
    });
    expect(errors['proposer.firstName']).toBe('Please enter your first name (min 2 characters)');
  });

  it('Phase 6k: rejects flat root-level policyholder fields', () => {
    const errors = validateForContext({
      productCode: 'MOTOR',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'customer',
      data: {
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
      },
    });
    // Schema rejects with a proposer-level error; flat keys are never
    // emitted as error keys.
    expect(errors.proposer).toBeDefined();
    expect(errors.firstName).toBeUndefined();
    expect(errors.lastName).toBeUndefined();
    expect(errors.email).toBeUndefined();
    expect(errors.telephone).toBeUndefined();
  });

  it('isolates each wizard step to its own schema', () => {
    const dh = validateForContext({
      productCode: 'MOTOR',
      stage: { kind: 'wizardStep', id: 'driving-history' },
      actor: 'customer',
      data: {
        proposer: {
          occupation: 'Engineer',
          whereDidYouHear: 'Google',
          dateOfBirth: '1990-01-01',
        },
        licenseYears: '5',
        licenseType: 'Full',
        licenseIssuedIn: '',
        hasClaims: false,
        hasConvictions: false,
        hasAdditionalDrivers: false,
      },
    });
    expect(dh.licenseIssuedIn).toBe('Please select where your license was issued');
  });

  it('returns {} for unknown wizard steps', () => {
    const errors = validateForContext({
      productCode: 'MOTOR',
      stage: { kind: 'wizardStep', id: 'your-quote' },
      actor: 'customer',
      data: {},
    });
    expect(errors).toEqual({});
  });
});
