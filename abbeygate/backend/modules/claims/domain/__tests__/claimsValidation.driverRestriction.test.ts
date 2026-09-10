/**
 * Claims FNOL validation under different driver coverage restrictions
 * (ABY-232 / ADR-0025).
 *
 * The base contract restriction stays:
 *   - `kind: 'named'`        → driver.id must be in `namedDrivers`
 *   - `kind: 'unauthorized'` → driver.name + DOB (18–85)
 *
 * On top of that, when the policy is on an open-driver basis
 * (`ANY_DRIVER_25_PLUS` / `ANY_DRIVER_40_PLUS`) every driver — named,
 * unauthorised, or explicitly "any-authorised-driver" — must meet
 * the certificate's age band (≥ restriction min age, ≤ 70).
 */
import { describe, expect, it } from 'vitest';
import { registerAllProducts } from '../../../../products/registerProducts.js';
import { resolveClaimsContractFromProgram } from '../claimsContract.js';
import { validateGuidedFnolForm } from '../claimsValidation.js';

registerAllProducts();

const contract = resolveClaimsContractFromProgram({ productType: 'MOTOR', programMetadata: {} });

function makeForm(overrides: Record<string, unknown> = {}) {
  return {
    incident: {
      type: 'collision',
      description: 'Collision while driving slowly through traffic intersection.',
      date: '2026-02-01',
      location: 'Main street',
      city: 'Nicosia',
      country: 'Cyprus',
    },
    driver: { id: 'driver-1', kind: 'named' },
    thirdParty: {
      involved: 'yes',
      kinds: ['another_car'],
      anotherCars: [{ fullName: 'Jane Roe', insurerName: 'Insurer A' }],
    },
    police: { involved: 'yes', reportNumber: 'PR-55' },
    triage: { carDrivable: 'yes', injuriesReported: 'no' },
    ...overrides,
  };
}

describe('validateGuidedFnolForm — driverRestriction', () => {
  it('NAMED_DRIVERS: accepts a driver picked from the named list', () => {
    const result = validateGuidedFnolForm({
      form: makeForm(),
      contract,
      policyId: 'p1',
      namedDrivers: [{ id: 'driver-1', name: 'John Doe' }],
      driverRestriction: 'NAMED_DRIVERS',
    });
    expect(result.valid).toBe(true);
  });

  it('NAMED_DRIVERS: rejects a driver not in the named list', () => {
    const result = validateGuidedFnolForm({
      form: makeForm({ driver: { id: 'unknown-id', kind: 'named' } }),
      contract,
      policyId: 'p1',
      namedDrivers: [{ id: 'driver-1', name: 'John Doe' }],
      driverRestriction: 'NAMED_DRIVERS',
    });
    expect(result.valid).toBe(false);
    expect(result.errors['driver.id']).toContain('not allowed');
  });

  it('ANY_DRIVER_25_PLUS: accepts an authorised driver aged ≥ 25', () => {
    const fortyYearsAgo = new Date();
    fortyYearsAgo.setFullYear(fortyYearsAgo.getFullYear() - 40);
    const result = validateGuidedFnolForm({
      form: makeForm({
        driver: {
          id: 'open-1',
          kind: 'any-authorised-driver',
          name: 'Open Driver',
          dateOfBirth: fortyYearsAgo.toISOString().slice(0, 10),
        },
      }),
      contract,
      policyId: 'p1',
      namedDrivers: [{ id: 'policyholder-driver', name: 'Proposer' }],
      driverRestriction: 'ANY_DRIVER_25_PLUS',
    });
    expect(result.valid).toBe(true);
  });

  it('ANY_DRIVER_25_PLUS: rejects a driver under 25', () => {
    const twentyTwoYearsAgo = new Date();
    twentyTwoYearsAgo.setFullYear(twentyTwoYearsAgo.getFullYear() - 22);
    const result = validateGuidedFnolForm({
      form: makeForm({
        driver: {
          id: 'open-young',
          kind: 'any-authorised-driver',
          name: 'Young Driver',
          dateOfBirth: twentyTwoYearsAgo.toISOString().slice(0, 10),
        },
      }),
      contract,
      policyId: 'p1',
      namedDrivers: [{ id: 'policyholder-driver', name: 'Proposer' }],
      driverRestriction: 'ANY_DRIVER_25_PLUS',
    });
    expect(result.valid).toBe(false);
    expect(result.errors['driver.dateOfBirth']).toMatch(/aged 25 or over/);
  });

  it('ANY_DRIVER_40_PLUS: rejects a driver under 40 even if aged 30', () => {
    const thirtyYearsAgo = new Date();
    thirtyYearsAgo.setFullYear(thirtyYearsAgo.getFullYear() - 30);
    const result = validateGuidedFnolForm({
      form: makeForm({
        driver: {
          id: 'open-30',
          kind: 'any-authorised-driver',
          name: 'Thirty Driver',
          dateOfBirth: thirtyYearsAgo.toISOString().slice(0, 10),
        },
      }),
      contract,
      policyId: 'p1',
      namedDrivers: [{ id: 'policyholder-driver', name: 'Proposer' }],
      driverRestriction: 'ANY_DRIVER_40_PLUS',
    });
    expect(result.valid).toBe(false);
    expect(result.errors['driver.dateOfBirth']).toMatch(/aged 40 or over/);
  });

  it('Open mode: rejects an "unauthorized" driver below the age threshold', () => {
    // ABY-232: even if the form labels the driver as "unauthorized",
    // the open-mode age threshold from the policy restriction still
    // applies so callers cannot bypass it by mislabelling the kind.
    const twentyTwoYearsAgo = new Date();
    twentyTwoYearsAgo.setFullYear(twentyTwoYearsAgo.getFullYear() - 22);
    const result = validateGuidedFnolForm({
      form: makeForm({
        driver: {
          id: 'unauth-young',
          kind: 'unauthorized',
          name: 'Young Driver',
          dateOfBirth: twentyTwoYearsAgo.toISOString().slice(0, 10),
          permissionConfirmed: true,
        },
      }),
      contract,
      policyId: 'p1',
      namedDrivers: [{ id: 'policyholder-driver', name: 'Proposer' }],
      driverRestriction: 'ANY_DRIVER_25_PLUS',
    });
    expect(result.valid).toBe(false);
    expect(result.errors['driver.dateOfBirth']).toMatch(/aged 25 or over/);
  });

  it('Open mode: rejects a driver over 70', () => {
    const seventyFiveYearsAgo = new Date();
    seventyFiveYearsAgo.setFullYear(seventyFiveYearsAgo.getFullYear() - 75);
    const result = validateGuidedFnolForm({
      form: makeForm({
        driver: {
          id: 'open-elder',
          kind: 'any-authorised-driver',
          name: 'Elder Driver',
          dateOfBirth: seventyFiveYearsAgo.toISOString().slice(0, 10),
        },
      }),
      contract,
      policyId: 'p1',
      namedDrivers: [{ id: 'policyholder-driver', name: 'Proposer' }],
      driverRestriction: 'ANY_DRIVER_25_PLUS',
    });
    expect(result.valid).toBe(false);
    expect(result.errors['driver.dateOfBirth']).toMatch(/up to 70/);
  });

  it('Legacy policy (no driverRestriction): named-list rules apply, age threshold does not', () => {
    const result = validateGuidedFnolForm({
      form: makeForm(),
      contract,
      policyId: 'p1',
      namedDrivers: [{ id: 'driver-1', name: 'John Doe' }],
      // No `driverRestriction` — pre-ABY-232 policies.
    });
    expect(result.valid).toBe(true);
  });
});
