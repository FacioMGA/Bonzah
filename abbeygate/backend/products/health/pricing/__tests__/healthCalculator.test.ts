import { describe, it, expect, beforeAll } from 'vitest';
import { calculateHealthPremium, HealthQuoteValidationError } from '../healthCalculator.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';

// Reuse the canonical CY tenant fixture from the shared helper so the
// type shape is real and no shrug-casts are needed.
const CY_TENANT = getTenantFixtures().find((t) => t.tenantSlug === 'abbeygate-cy')!;

function withCyTenant<T>(fn: () => T): Promise<T> {
  return runWithOperatingTenant(CY_TENANT, async () => fn());
}

function dobForAge(age: number, reference = new Date()): string {
  const ref = new Date(reference);
  // Pick a DOB that has already had its birthday this year — go back to
  // (today - 1 day) shifted by `age` years. This guarantees the age at
  // `reference` is exactly `age`, regardless of when in the year the
  // test runs.
  const year = ref.getFullYear() - age;
  const month = String(ref.getMonth() + 1).padStart(2, '0');
  const day = String(Math.max(1, ref.getDate() - 1)).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const TODAY = new Date().toISOString().slice(0, 10);

describe('calculateHealthPremium — age-banded gross premium per insured', () => {
  beforeAll(() => {
    // Loader caches on first read; nothing else to set up.
  });

  it.each([
    [30, 175, '10%'],
    [62, 175, '10%'],
    [63, 210, 200],
    [65, 210, 200],
    [66, 245, 900],
    [70, 245, 900],
    [72, 270, 1400],
    [78, 315, 1900],
    [80, 430, 2800],
    [88, 430, 2800],
  ])('age %i resolves to €%i gross with excess %s', async (age, gross, excess) => {
    const result = await withCyTenant(() =>
      calculateHealthPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        insureds: {
          coverType: 'single',
          personCount: 1,
          persons: [{ firstName: 'Test', lastName: 'Person', dob: dobForAge(age), gender: 'female', idNumber: 'X', occupation: 'employed' }],
        },
        period: { inceptionDate: TODAY },
        ghs: { isBeneficiary: false },
      }),
    );
    expect(result.declined).toBe(false);
    expect(result.refer).toBe(false);
    expect(result.breakdown.grossPremium).toBe(gross);
    const insured = result.breakdown.insureds[0];
    expect(insured.excess).toEqual(excess);
  });

  it('couple cover sums two insureds\' band premiums', async () => {
    const result = await withCyTenant(() =>
      calculateHealthPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        insureds: {
          coverType: 'couple',
          personCount: 2,
          persons: [
            { firstName: 'Lead', lastName: 'Insured', dob: dobForAge(34), gender: 'female', idNumber: 'A', occupation: 'employed' },
            { firstName: 'Partner', lastName: 'Insured', dob: dobForAge(65), gender: 'male', idNumber: 'B', occupation: 'employed' },
          ],
        },
        period: { inceptionDate: TODAY },
        ghs: { isBeneficiary: false },
      }),
    );
    // 175 (0-62) + 210 (63-65) = 385
    expect(result.breakdown.grossPremium).toBe(385);
    expect(result.breakdown.insureds).toHaveLength(2);
    expect(result.breakdown.insureds[0].ageBand).toBe('0-62');
    expect(result.breakdown.insureds[1].ageBand).toBe('63-65');
  });

  it('family with 3 insureds aggregates correctly', async () => {
    const result = await withCyTenant(() =>
      calculateHealthPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        insureds: {
          coverType: 'family',
          personCount: 3,
          persons: [
            { firstName: 'A', lastName: 'Family', dob: dobForAge(40), idNumber: 'A' },
            { firstName: 'B', lastName: 'Family', dob: dobForAge(38), idNumber: 'B' },
            { firstName: 'C', lastName: 'Family', dob: dobForAge(8), idNumber: 'C' },
          ],
        },
        period: { inceptionDate: TODAY },
        ghs: { isBeneficiary: true },
      }),
    );
    // 175 * 3 = 525
    expect(result.breakdown.grossPremium).toBe(525);
    expect(result.breakdown.ghsExtensionApplied).toBe(true);
  });

  it('emits canonical breakdown.lines with base + total rows', async () => {
    const result = await withCyTenant(() =>
      calculateHealthPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        insureds: {
          coverType: 'single',
          personCount: 1,
          persons: [{ firstName: 'Ada', lastName: 'Lovelace', dob: dobForAge(35), idNumber: 'A1' }],
        },
        period: { inceptionDate: TODAY },
        ghs: { isBeneficiary: false },
      }),
    );
    const codes = result.breakdown.lines.map((line) => line.code);
    expect(codes).toContain('base.insured.0');
    expect(codes).toContain('total');
    const total = result.breakdown.lines.find((line) => line.code === 'total');
    expect(total?.amount).toBe(175);
  });

  it('GHS extension does not add to premium total', async () => {
    const withGhs = await withCyTenant(() =>
      calculateHealthPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        insureds: {
          coverType: 'single',
          personCount: 1,
          persons: [{ firstName: 'A', lastName: 'B', dob: dobForAge(35), idNumber: 'X' }],
        },
        period: { inceptionDate: TODAY },
        ghs: { isBeneficiary: true },
      }),
    );
    const withoutGhs = await withCyTenant(() =>
      calculateHealthPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        insureds: {
          coverType: 'single',
          personCount: 1,
          persons: [{ firstName: 'A', lastName: 'B', dob: dobForAge(35), idNumber: 'X' }],
        },
        period: { inceptionDate: TODAY },
        ghs: { isBeneficiary: false },
      }),
    );
    expect(withGhs.breakdown.grossPremium).toBe(withoutGhs.breakdown.grossPremium);
    expect(withGhs.breakdown.ghsExtensionApplied).toBe(true);
    expect(withoutGhs.breakdown.ghsExtensionApplied).toBe(false);
  });

  it('throws when no insureds are supplied', async () => {
    await withCyTenant(() => {
      expect(() => calculateHealthPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        insureds: { coverType: 'single', personCount: 1, persons: [] },
        period: { inceptionDate: TODAY },
        ghs: { isBeneficiary: false },
      })).toThrow(HealthQuoteValidationError);
    });
  });

  it('throws for invalid DOB', async () => {
    await withCyTenant(() => {
      expect(() => calculateHealthPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        insureds: { coverType: 'single', personCount: 1, persons: [{ firstName: 'Bad', lastName: 'DOB', dob: 'not-a-date', idNumber: 'X' }] },
        period: { inceptionDate: TODAY },
        ghs: { isBeneficiary: false },
      })).toThrow(HealthQuoteValidationError);
    });
  });

  it('30% commission resolves correct net premium', async () => {
    const result = await withCyTenant(() =>
      calculateHealthPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        insureds: { coverType: 'single', personCount: 1, persons: [{ firstName: 'A', lastName: 'B', dob: dobForAge(35), idNumber: 'X' }] },
        period: { inceptionDate: TODAY },
        ghs: { isBeneficiary: false },
      }),
    );
    // 175 gross × 0.70 net = 122.50
    expect(result.breakdown.netPremium).toBe(122.5);
    expect(result.breakdown.commissionAmount).toBe(52.5);
  });
});
