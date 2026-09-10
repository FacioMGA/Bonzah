import { describe, expect, it } from 'vitest';
import { isReportDateRangeInvalid, REPORT_PRODUCT_OPTIONS } from '../reportFilterHelpers';

describe('reportFilterHelpers', () => {
  it('treats an empty product value as all-products (default)', () => {
    expect(REPORT_PRODUCT_OPTIONS.some((option) => option.value === 'MOTOR')).toBe(true);
    expect(REPORT_PRODUCT_OPTIONS.some((option) => option.value === 'HOME')).toBe(true);
    expect(REPORT_PRODUCT_OPTIONS.every((option) => option.value.length > 0)).toBe(true);
  });

  it('flags a backwards date range', () => {
    expect(isReportDateRangeInvalid('2026-08-12', '2026-08-01')).toBe(true);
    expect(isReportDateRangeInvalid('2026-08-01', '2026-08-12')).toBe(false);
    expect(isReportDateRangeInvalid('', '2026-08-12')).toBe(false);
  });
});
