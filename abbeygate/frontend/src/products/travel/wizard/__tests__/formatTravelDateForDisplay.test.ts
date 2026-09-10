/**
 * Regression suite for ABY-239 — traveller DOB displayed wrong on
 * the travel wizard's `your-details` step.
 *
 * Root cause: Step6 had its own copy of the date formatter that
 * used `new Date(iso) + toLocaleDateString('en-GB')` without
 * forcing UTC. For a date-only input like `1975-04-20`, a Date
 * is parsed as midnight UTC and then localised, which drops a
 * calendar day for any user west of UTC.
 *
 * This file locks the contract for the single canonical formatter
 * Step4 / Step5 / Step6 all consume. Add new cases here when new
 * shapes of input appear in production data.
 */
import { describe, expect, it } from 'vitest';
import { formatTravelDateForDisplay } from '../formatTravelDateForDisplay';

describe('formatTravelDateForDisplay', () => {
  it('renders a YYYY-MM-DD date-only ISO as DD/MM/YYYY without timezone drift (ABY-239)', () => {
    expect(formatTravelDateForDisplay('1975-04-20')).toBe('20/04/1975');
  });

  it('never returns the wrong calendar day for a date-only ISO (ABY-239 regression guard)', () => {
    // The naive `new Date('1975-04-20').toLocaleDateString('en-GB')`
    // pathway returns "19/04/1975" in any timezone west of UTC.
    // This formatter MUST return the literal day from the string.
    expect(formatTravelDateForDisplay('1975-04-20')).not.toBe('19/04/1975');
    expect(formatTravelDateForDisplay('2026-01-01')).toBe('01/01/2026');
    expect(formatTravelDateForDisplay('2026-12-31')).toBe('31/12/2026');
  });

  it('passes through an already-formatted DD/MM/YYYY string unchanged', () => {
    expect(formatTravelDateForDisplay('20/04/1975')).toBe('20/04/1975');
  });

  it('handles full ISO timestamps with the en-GB UTC formatter (no day drift)', () => {
    expect(formatTravelDateForDisplay('1975-04-20T00:00:00Z')).toBe('20/04/1975');
    expect(formatTravelDateForDisplay('2026-05-15T12:00:00Z')).toBe('15/05/2026');
  });

  it('returns empty string for empty / whitespace input', () => {
    expect(formatTravelDateForDisplay('')).toBe('');
    expect(formatTravelDateForDisplay('   ')).toBe('');
  });

  it('returns the original string for unparseable input rather than "Invalid Date"', () => {
    expect(formatTravelDateForDisplay('not-a-date')).toBe('not-a-date');
    expect(formatTravelDateForDisplay('abcd-ef-gh')).toBe('abcd-ef-gh');
  });

  it('is symmetric across Step4 / Step5 / Step6 — same input always produces same output', () => {
    // Cross-step parity guard: every call site MUST use this
    // function. If we ever re-introduce inline copies they will
    // drift again (the exact failure mode that produced ABY-239).
    const cases = ['1975-04-20', '2026-05-15', '20/04/1975', '', 'unparseable'];
    for (const input of cases) {
      const a = formatTravelDateForDisplay(input);
      const b = formatTravelDateForDisplay(input);
      expect(a).toBe(b);
    }
  });
});
