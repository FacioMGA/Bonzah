/**
 * Legacy back-compat derivation for `driverRestriction` (ABY-232 /
 * ADR-0025). Pre-ABY-232 quotes carry only `hasAdditionalDrivers`;
 * the motor adapter's normalize step fills `driverRestriction` from
 * the legacy boolean so downstream pricing, documents and claims
 * read one canonical value.
 */
import { describe, it, expect } from 'vitest';
import { normalizeDriverRestrictionCompatibility } from '../quoteDataGuards.js';

describe('normalizeDriverRestrictionCompatibility', () => {
  it('derives POLICYHOLDER_ONLY from legacy hasAdditionalDrivers=false', () => {
    const result = normalizeDriverRestrictionCompatibility({ hasAdditionalDrivers: false });
    expect(result.driverRestriction).toBe('POLICYHOLDER_ONLY');
  });

  it('derives NAMED_DRIVERS from legacy hasAdditionalDrivers=true', () => {
    const result = normalizeDriverRestrictionCompatibility({ hasAdditionalDrivers: true });
    expect(result.driverRestriction).toBe('NAMED_DRIVERS');
  });

  it('leaves an explicit driverRestriction value untouched', () => {
    const result = normalizeDriverRestrictionCompatibility({
      driverRestriction: 'ANY_DRIVER_25_PLUS',
      hasAdditionalDrivers: true, // stale legacy value — must not override
    });
    expect(result.driverRestriction).toBe('ANY_DRIVER_25_PLUS');
  });

  it('preserves every supported value', () => {
    const values = ['POLICYHOLDER_ONLY', 'NAMED_DRIVERS', 'ANY_DRIVER_25_PLUS', 'ANY_DRIVER_40_PLUS'] as const;
    for (const value of values) {
      const result = normalizeDriverRestrictionCompatibility({ driverRestriction: value });
      expect(result.driverRestriction).toBe(value);
    }
  });

  it('refuses to coerce unknown values — leaves them for the stage validator to reject', () => {
    const result = normalizeDriverRestrictionCompatibility({
      driverRestriction: 'UNKNOWN_VALUE',
      hasAdditionalDrivers: false,
    });
    // Unknown is preserved so the stage validator can report it.
    expect(result.driverRestriction).toBe('UNKNOWN_VALUE');
  });

  it('does not invent a value when both fields are missing', () => {
    const result = normalizeDriverRestrictionCompatibility({});
    expect(result.driverRestriction).toBeUndefined();
  });

  it('returns a new object (does not mutate the input)', () => {
    const input: Record<string, unknown> = { hasAdditionalDrivers: false };
    const result = normalizeDriverRestrictionCompatibility(input);
    expect(result).not.toBe(input);
    expect(input.driverRestriction).toBeUndefined();
  });
});
