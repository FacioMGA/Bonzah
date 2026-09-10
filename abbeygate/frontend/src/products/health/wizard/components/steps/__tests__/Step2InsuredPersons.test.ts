import { describe, expect, it } from 'vitest';
import { resizeInsuredPersons } from '../Step2InsuredPersons';

/**
 * ABY-287/288 — data-loss regression on the HEALTH `insured-persons`
 * step. The previous wizard step replaced the insured-persons array
 * with empty shells whenever cover-type changed, wiping any
 * already-entered insured details. `resizeInsuredPersons` is the
 * pure helper that grows / shrinks the array while preserving every
 * row the customer has already filled in. These tests pin the
 * preserve-on-resize contract so it cannot regress without the
 * regression showing up in CI.
 */
describe('resizeInsuredPersons (ABY-287)', () => {
  const filled = (suffix: string) => ({
    firstName: `First-${suffix}`,
    lastName: `Last-${suffix}`,
    dob: '1990-01-01',
    gender: 'male',
    idType: 'passport',
    idNumber: `P${suffix}`,
    occupation: 'employed',
    email: `user-${suffix}@example.com`,
    phone: '+35799111224',
  });

  it('preserves existing rows when growing the array (couple → family)', () => {
    const current = [filled('A'), filled('B')];
    const next = resizeInsuredPersons(current, 4);
    expect(next).toHaveLength(4);
    expect(next[0]).toMatchObject({ firstName: 'First-A', idNumber: 'PA' });
    expect(next[1]).toMatchObject({ firstName: 'First-B', idNumber: 'PB' });
    // Newly required rows are blank shells, NOT undefined.
    expect(next[2]).toEqual({
      firstName: '', lastName: '', dob: '', gender: '', idType: 'passport', idNumber: '', occupation: '', email: '', phone: '',
    });
    expect(next[3]).toEqual({
      firstName: '', lastName: '', dob: '', gender: '', idType: 'passport', idNumber: '', occupation: '', email: '', phone: '',
    });
  });

  it('preserves existing rows when shrinking the array (family → couple)', () => {
    const current = [filled('A'), filled('B'), filled('C'), filled('D')];
    const next = resizeInsuredPersons(current, 2);
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ firstName: 'First-A' });
    expect(next[1]).toMatchObject({ firstName: 'First-B' });
  });

  it('preserves existing rows when target equals current length', () => {
    const current = [filled('A'), filled('B'), filled('C')];
    const next = resizeInsuredPersons(current, 3);
    expect(next).toEqual(current.map((row) => ({ ...row })));
  });

  it('treats non-object slots as empty shells (defensive against malformed session data)', () => {
    const current = [filled('A'), null, undefined, 42, ['array']];
    const next = resizeInsuredPersons(current, 5);
    expect(next).toHaveLength(5);
    expect(next[0]).toMatchObject({ firstName: 'First-A' });
    for (const malformed of next.slice(1)) {
      expect(malformed).toEqual({
        firstName: '', lastName: '', dob: '', gender: '', idType: 'passport', idNumber: '', occupation: '', email: '', phone: '',
      });
    }
  });

  it('returns an empty array when target is 0 or negative', () => {
    expect(resizeInsuredPersons([filled('A')], 0)).toEqual([]);
    expect(resizeInsuredPersons([filled('A')], -3)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const current = [filled('A')];
    const before = JSON.stringify(current);
    void resizeInsuredPersons(current, 3);
    expect(JSON.stringify(current)).toBe(before);
  });
});
