import { describe, expect, it } from 'vitest';
import { resolveReportExecutionConfig } from '../reportingFlow';

describe('reportingFlow', () => {
  it('maps Premium Bordereau to Lloyds monthly premium export', () => {
    expect(resolveReportExecutionConfig('Premium Bordereau')).toEqual({
      lane: 'LLOYDS_MONTHLY_EXPORT',
      stream: 'premium',
      format: 'xlsx',
    });
  });

  it('maps Claims Bordereau to Lloyds monthly claims export', () => {
    expect(resolveReportExecutionConfig('Claims Bordereau')).toEqual({
      lane: 'LLOYDS_MONTHLY_EXPORT',
      stream: 'claims',
      format: 'xlsx',
    });
  });

  it('maps Risk Bordereau to Lloyds monthly risk export', () => {
    expect(resolveReportExecutionConfig('Risk Bordereau')).toEqual({
      lane: 'LLOYDS_MONTHLY_EXPORT',
      stream: 'risk',
      format: 'csv',
    });
  });

  it('marks unknown reports as unwired', () => {
    expect(resolveReportExecutionConfig('TPA Performance Report')).toEqual({
      lane: 'UNWIRED',
    });
  });
});

