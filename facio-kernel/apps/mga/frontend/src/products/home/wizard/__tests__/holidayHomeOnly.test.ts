import { describe, expect, it, vi, beforeEach } from 'vitest';
import { holidayHomeOnlyForDomicile } from '../holidayHomeOnly';
import { getOperatingCountryName } from '@/src/shared/lib/tenant/operatingCountry';

vi.mock('@/src/shared/lib/tenant/operatingCountry', () => ({
  getOperatingCountryName: vi.fn(),
}));

const mockedName = vi.mocked(getOperatingCountryName);

describe('holidayHomeOnlyForDomicile', () => {
  beforeEach(() => mockedName.mockReset());

  it('is true when domicile differs from the operating country', () => {
    mockedName.mockReturnValue('Portugal');
    expect(holidayHomeOnlyForDomicile('United Kingdom')).toBe(true);
  });

  it('is false when domicile matches the operating country (case/space-insensitive)', () => {
    mockedName.mockReturnValue('Portugal');
    expect(holidayHomeOnlyForDomicile('  portugal ')).toBe(false);
  });

  it('does not constrain when the operating country is unknown (e.g. localhost)', () => {
    mockedName.mockReturnValue(null);
    expect(holidayHomeOnlyForDomicile('United Kingdom')).toBe(false);
  });

  it('does not constrain before a domicile is chosen', () => {
    mockedName.mockReturnValue('Cyprus');
    expect(holidayHomeOnlyForDomicile('')).toBe(false);
    expect(holidayHomeOnlyForDomicile(undefined)).toBe(false);
  });
});
