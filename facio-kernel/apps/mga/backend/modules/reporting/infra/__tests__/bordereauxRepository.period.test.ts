import { describe, expect, it } from 'vitest';
import { buildReportingPeriodBounds } from '../bordereauxRepository.js';

describe('buildReportingPeriodBounds', () => {
  it('returns full UTC month bounds for March 2026', () => {
    const { startDate, endDate } = buildReportingPeriodBounds(2026, 3);
    expect(startDate.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(endDate.toISOString()).toBe('2026-03-31T23:59:59.999Z');
  });
});

