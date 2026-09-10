import { describe, expect, it } from 'vitest';
import { rentalInstant, rentalPrefill } from './rentalPrefill';
import { writeAnswer, readAnswer } from './facioApi';
describe('website rental data continuity', () => {
  it('preserves pickup wall time with actual Colorado and New York offsets', () => {
    expect(rentalInstant('2026-09-18', '10:00', 'CO')).toBe('2026-09-18T10:00:00-06:00');
    expect(rentalInstant('2026-12-18', '10:00', 'CO')).toBe('2026-12-18T10:00:00-07:00');
    expect(rentalInstant('2026-09-18', '10:00', 'NY')).toBe('2026-09-18T10:00:00-04:00');
  });
  it('carries real form values without injecting a driver or insurance rate', () => {
    const result = rentalPrefill({
      pickupState: 'CO',
      residenceState: 'CA',
      location: 'Selected airport',
      start: '2026-09-18',
      end: '2026-09-22',
      startTime: '10:00',
      endTime: '11:00',
    });
    expect(result['pickup.location']).toBe('Selected airport');
    expect(result['proposer.address.state']).toBe('CA');
    expect(result['policy.endAt']).toBe('2026-09-22T11:00:00-06:00');
    expect(result['driver.age']).toBeUndefined();
  });
  it('retains literal authored dotted keys and prevents prototype paths', () => {
    const answers = writeAnswer({}, ['rental', 'question.one'], 'answer');
    expect(readAnswer(answers, ['rental', 'question.one'])).toBe('answer');
    expect(() => writeAnswer({}, ['__proto__', 'polluted'], true)).toThrow();
  });
});
