/**
 * `extractNamedDriversFromPolicy` and `resolveDriverRestrictionFromPolicy`
 * behaviour under each coverage restriction (ABY-232 / ADR-0025).
 */
import { describe, expect, it } from 'vitest';
import {
  extractNamedDriversFromPolicy,
  resolveDriverRestrictionFromPolicy,
} from '../claimsHelpers.js';

describe('resolveDriverRestrictionFromPolicy', () => {
  it('reads `quoteData.driverRestriction`', () => {
    expect(resolveDriverRestrictionFromPolicy({ quoteData: { driverRestriction: 'NAMED_DRIVERS' } })).toBe('NAMED_DRIVERS');
    expect(resolveDriverRestrictionFromPolicy({ quoteData: { driverRestriction: 'ANY_DRIVER_25_PLUS' } })).toBe('ANY_DRIVER_25_PLUS');
  });

  it('falls back to `driverInfo.driverRestriction`', () => {
    expect(resolveDriverRestrictionFromPolicy({ driverInfo: { driverRestriction: 'POLICYHOLDER_ONLY' } })).toBe('POLICYHOLDER_ONLY');
  });

  it('returns null for legacy policies with no restriction set', () => {
    expect(resolveDriverRestrictionFromPolicy({ quoteData: { hasAdditionalDrivers: true } })).toBeNull();
    expect(resolveDriverRestrictionFromPolicy(null)).toBeNull();
  });

  it('returns null for unknown / malformed values', () => {
    expect(resolveDriverRestrictionFromPolicy({ quoteData: { driverRestriction: 'NOT_A_VALUE' } })).toBeNull();
  });
});

describe('extractNamedDriversFromPolicy', () => {
  it('NAMED_DRIVERS: returns the policyholder and every additional driver', () => {
    const drivers = extractNamedDriversFromPolicy({
      quoteData: {
        proposer: { firstName: 'Alice', lastName: 'Smith' },
        driverRestriction: 'NAMED_DRIVERS',
        additionalDrivers: [
          { id: 'driver-bob', firstName: 'Bob', lastName: 'Jones' },
          { id: 'driver-carla', firstName: 'Carla', lastName: 'Reyes' },
        ],
      },
    });
    expect(drivers).toEqual([
      { id: 'policyholder-driver', name: 'Alice Smith' },
      { id: 'driver-bob', name: 'Bob Jones' },
      { id: 'driver-carla', name: 'Carla Reyes' },
    ]);
  });

  it('POLICYHOLDER_ONLY: returns only the policyholder, ignoring stale additionalDrivers', () => {
    const drivers = extractNamedDriversFromPolicy({
      quoteData: {
        proposer: { firstName: 'Alice', lastName: 'Smith' },
        driverRestriction: 'POLICYHOLDER_ONLY',
        additionalDrivers: [{ firstName: 'Stale', lastName: 'Row' }],
      },
    });
    expect(drivers).toEqual([{ id: 'policyholder-driver', name: 'Alice Smith' }]);
  });

  it('ANY_DRIVER_25_PLUS: returns only the policyholder — open mode does not pick from a named list', () => {
    const drivers = extractNamedDriversFromPolicy({
      quoteData: {
        proposer: { firstName: 'Alice', lastName: 'Smith' },
        driverRestriction: 'ANY_DRIVER_25_PLUS',
        additionalDrivers: [{ firstName: 'Stale', lastName: 'Row' }],
      },
    });
    expect(drivers).toEqual([{ id: 'policyholder-driver', name: 'Alice Smith' }]);
  });

  it('ANY_DRIVER_40_PLUS: returns only the policyholder', () => {
    const drivers = extractNamedDriversFromPolicy({
      quoteData: {
        proposer: { firstName: 'Alice', lastName: 'Smith' },
        driverRestriction: 'ANY_DRIVER_40_PLUS',
      },
    });
    expect(drivers).toEqual([{ id: 'policyholder-driver', name: 'Alice Smith' }]);
  });

  it('Legacy policy: falls back to historical extraction across every shape', () => {
    const drivers = extractNamedDriversFromPolicy({
      quoteData: {
        proposer: { firstName: 'Alice', lastName: 'Smith' },
        namedDrivers: [{ id: 'd1', name: 'Bob Legacy' }],
      },
      driverInfo: {
        additionalDrivers: [{ firstName: 'Carla', lastName: 'Modern' }],
      },
    });
    // Both shapes are merged, policyholder included once.
    expect(drivers.map((d) => d.name)).toEqual(
      expect.arrayContaining(['Alice Smith', 'Bob Legacy', 'Carla Modern']),
    );
  });
});
