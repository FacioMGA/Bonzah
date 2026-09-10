import { describe, expect, it } from 'vitest';
import { validateDriverDraft } from './driverValidation';

describe('validateDriverDraft', () => {
  it('does not apply an upper age cap to named driver DOB validation', () => {
    const errors = validateDriverDraft({
      firstName: 'Older',
      lastName: 'Driver',
      dateOfBirth: '1938-01-01',
      licenseYears: 10,
    });

    expect(errors.dateOfBirth).toBeUndefined();
  });
});
