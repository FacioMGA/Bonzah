/**
 * Motor profile / manifest contract for `driverRestriction`
 * (ABY-232 / ADR-0025).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ValidationRegistry, validateForContext } from '@facio/validation/frontend';
import { motorManifest } from '../manifest.js';
import { motorValidationProfile } from '../profile.js';
import { MOTOR_STEP_SCOPED_FIELDS } from '../generated/motorValidationContract.generated.js';

beforeEach(() => {
  ValidationRegistry._resetForTests();
  ValidationRegistry.register(motorValidationProfile);
});

describe('driverRestriction — canonical field contract', () => {
  it('declares `driverRestriction` as a canonical field required from quote onward', () => {
    const field = motorValidationProfile.fields.driverRestriction;
    expect(field).toBeDefined();
    expect(field?.dataClassification).toBe('canonical');
    expect(field?.requiredAtStages).toEqual(expect.arrayContaining(['quote', 'bind', 'issuance']));
  });

  it('keeps `hasAdditionalDrivers` canonical but with no blanket required-at-stages annotation', () => {
    const field = motorValidationProfile.fields.hasAdditionalDrivers;
    expect(field?.dataClassification).toBe('canonical');
    expect(field?.requiredAtStages).toBeUndefined();
  });

  it('lists driverRestriction under the driving-history step', () => {
    expect(MOTOR_STEP_SCOPED_FIELDS['driving-history']).toContain('driverRestriction');
  });

  it('lists structured conviction severity fields under the driving-history step', () => {
    expect(MOTOR_STEP_SCOPED_FIELDS['driving-history']).toEqual(expect.arrayContaining([
      'motorConvictions',
      'majorConvictionsCountLast5Years',
      'seriousTechnicalOffenceCount',
    ]));
  });

  it('lists driverRestriction under the issue-details step', () => {
    expect(MOTOR_STEP_SCOPED_FIELDS['issue-details']).toContain('driverRestriction');
  });

  it('lists structured conviction severity fields under the issue-details step', () => {
    expect(MOTOR_STEP_SCOPED_FIELDS['issue-details']).toEqual(expect.arrayContaining([
      'motorConvictions',
      'majorConvictionsCountLast5Years',
      'seriousTechnicalOffenceCount',
    ]));
  });

  it('renders driverRestriction as a select in the BO questionnaire with the four scheme options', () => {
    const drivingFields = motorManifest.questionnaire.sections.find((s) => s.id === 'driving-history')?.fields || [];
    const restriction = drivingFields.find((f) => f.path === 'driverRestriction');
    expect(restriction).toBeDefined();
    expect(restriction?.type).toBe('select');
    expect(restriction?.required).toBe(true);
    const values = (restriction?.options ?? []).map((o) => (typeof o === 'string' ? o : o.value));
    expect(values).toEqual([
      'POLICYHOLDER_ONLY',
      'NAMED_DRIVERS',
      'ANY_DRIVER_25_PLUS',
      'ANY_DRIVER_40_PLUS',
    ]);
  });

  it('only renders hasAdditionalDrivers when driverRestriction === NAMED_DRIVERS', () => {
    const drivingFields = motorManifest.questionnaire.sections.find((s) => s.id === 'driving-history')?.fields || [];
    const hasAdditional = drivingFields.find((f) => f.path === 'hasAdditionalDrivers');
    expect(hasAdditional?.visibleWhenKey).toBe('driverRestriction');
    expect(hasAdditional?.visibleWhenValue).toBe('NAMED_DRIVERS');
  });
});

describe('driverRestriction — stage validation', () => {
  it('rejects a bind-stage payload missing driverRestriction with a structured error', () => {
    const errors = validateForContext({
      productCode: 'MOTOR',
      stage: { kind: 'stage', id: 'bind' },
      actor: 'customer',
      data: {
        proposer: { firstName: 'A', lastName: 'B', email: 'a@b.com', phone: '+35799000000', dateOfBirth: '1985-01-01' },
        licenseYears: 10,
        licenseType: 'Full',
        licenseIssuedIn: 'Cyprus',
        coverRequired: 'Comprehensive',
        vehicleType: 'Car',
        make: 'Toyota', model: 'Yaris', year: 2019,
        engineSize: 1400, vehicleValue: 15000, ncb: '5+ Years', vehicleUse: 'Private',
        hasAdditionalDrivers: false,
        // driverRestriction intentionally missing
      },
    });
    expect(Object.keys(errors)).toContain('driverRestriction');
  });

  it('accepts a bind-stage payload with driverRestriction = POLICYHOLDER_ONLY (no additional-drivers cascade)', () => {
    const errors = validateForContext({
      productCode: 'MOTOR',
      stage: { kind: 'stage', id: 'bind' },
      actor: 'customer',
      data: {
        proposer: {
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.com',
          phone: '+35799000000',
          dateOfBirth: '1985-01-01',
          nationality: 'Cyprus',
          occupation: 'Engineer',
          whereDidYouHear: 'Google',
          privacyPolicyAccepted: true,
          bestTimeToCall: 'Anytime',
          address: { line1: 'Street', city: 'Nicosia', postcode: '1000', country: 'Cyprus' },
        },
        licenseYears: 10,
        licenseType: 'Full',
        licenseIssuedIn: 'Cyprus',
        coverRequired: 'Comprehensive',
        vehicleType: 'Car',
        make: 'Toyota', model: 'Yaris', year: 2019,
        engineSize: 1400, vehicleValue: 15000, ncb: '5+ Years', vehicleUse: 'Private',
        driverRestriction: 'POLICYHOLDER_ONLY',
        hasAdditionalDrivers: false,
        additionalDrivers: [],
        infoTrueAndAccurate: true,
        fairProcessingAccepted: true,
      },
    });
    expect(errors.driverRestriction).toBeUndefined();
    expect(errors.additionalDrivers).toBeUndefined();
  });

  it('does not flag stale additionalDrivers under ANY_DRIVER_25_PLUS (open mode ignores list)', () => {
    // The bind-stage refinement gates additionalDrivers on
    // driverRestriction === 'NAMED_DRIVERS'. Stale rows under
    // ANY_DRIVER_25_PLUS must not surface as a validation error
    // (BO / wizard cascade-clear them, but a partial payload may
    // still carry leftovers).
    const errors = validateForContext({
      productCode: 'MOTOR',
      stage: { kind: 'stage', id: 'bind' },
      actor: 'customer',
      data: {
        proposer: {
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.com',
          phone: '+35799000000',
          dateOfBirth: '1985-01-01',
          nationality: 'Cyprus',
          occupation: 'Engineer',
          whereDidYouHear: 'Google',
          privacyPolicyAccepted: true,
          bestTimeToCall: 'Anytime',
          address: { line1: 'Street', city: 'Nicosia', postcode: '1000', country: 'Cyprus' },
        },
        licenseYears: 10,
        licenseType: 'Full',
        licenseIssuedIn: 'Cyprus',
        coverRequired: 'Comprehensive',
        vehicleType: 'Car',
        make: 'Toyota', model: 'Yaris', year: 2019,
        engineSize: 1400, vehicleValue: 15000, ncb: '5+ Years', vehicleUse: 'Private',
        driverRestriction: 'ANY_DRIVER_25_PLUS',
        hasAdditionalDrivers: false,
        additionalDrivers: [],
        infoTrueAndAccurate: true,
        fairProcessingAccepted: true,
      },
    });
    expect(errors.driverRestriction).toBeUndefined();
    expect(errors.additionalDrivers).toBeUndefined();
  });
});
