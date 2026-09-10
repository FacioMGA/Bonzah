import { describe, expect, it } from 'vitest';
import { isValidPhone, normalizePhone } from '../validators';

describe('claims desk validators', () => {
  it('accepts valid international phone numbers beyond ten characters', () => {
    expect(isValidPhone('+35799111222')).toBe(true);
    expect(isValidPhone('+442071838750')).toBe(true);
    expect(isValidPhone('+49891234567890')).toBe(true);
  });

  it('rejects invalid short phone numbers and normalizes formatting', () => {
    expect(normalizePhone('+357 99 111 222')).toBe('+35799111222');
    expect(isValidPhone('+35712')).toBe(false);
  });
});
