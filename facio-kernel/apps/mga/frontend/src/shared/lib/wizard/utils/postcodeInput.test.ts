import { describe, expect, it } from 'vitest';
import { postcodeInputHintForCountry } from './postcodeInput';

describe('postcodeInputHintForCountry (ABY-341)', () => {
  it('uses the numeric keypad for all-digit jurisdictions', () => {
    for (const country of ['Cyprus', 'CY', 'Spain', 'ES', 'Malta', 'MT', 'Ireland', 'IE']) {
      expect(postcodeInputHintForCountry(country)).toEqual({ inputMode: 'numeric', pattern: '[0-9]*' });
    }
  });

  it('uses a text keyboard that allows the hyphen for Portugal (NNNN-NNN)', () => {
    for (const country of ['Portugal', 'PT', 'prt']) {
      const hint = postcodeInputHintForCountry(country);
      expect(hint.inputMode).toBe('text');
      expect('1234-567').toMatch(new RegExp(`^${hint.pattern}$`));
    }
  });

  it('uses a text keyboard that allows letters and a space for the UK', () => {
    for (const country of ['United Kingdom', 'GB', 'uk', 'England']) {
      const hint = postcodeInputHintForCountry(country);
      expect(hint.inputMode).toBe('text');
      expect('SW1A 1AA').toMatch(new RegExp(`^${hint.pattern}$`));
    }
  });

  it('defaults to the numeric keypad when the country is empty or unknown', () => {
    expect(postcodeInputHintForCountry('')).toEqual({ inputMode: 'numeric', pattern: '[0-9]*' });
    expect(postcodeInputHintForCountry(null)).toEqual({ inputMode: 'numeric', pattern: '[0-9]*' });
    expect(postcodeInputHintForCountry('Atlantis')).toEqual({ inputMode: 'numeric', pattern: '[0-9]*' });
  });
});
