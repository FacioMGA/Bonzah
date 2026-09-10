import { describe, expect, it } from 'vitest';
import { getClaimStatusLabel, humanizeClaimCode } from './claimDisplayLabels';

describe('claimDisplayLabels', () => {
  it('maps claim status enums to user-friendly labels', () => {
    expect(getClaimStatusLabel('CLOSED_THIS_MONTH')).toBe('Closed this month');
    expect(getClaimStatusLabel('REOPENED')).toBe('Re-opened');
  });

  it('humanizes snake_case claim codes', () => {
    expect(humanizeClaimCode('windscreen_damage')).toBe('Windscreen damage');
  });
});
