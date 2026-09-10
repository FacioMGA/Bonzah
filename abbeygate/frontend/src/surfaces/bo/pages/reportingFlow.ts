export type LloydsStream = 'risk' | 'premium' | 'claims';

export type ReportExecutionConfig = {
  lane: 'LLOYDS_MONTHLY_EXPORT' | 'UNWIRED';
  stream?: LloydsStream;
  format?: 'csv' | 'xlsx';
  productType?: string;
};

/**
 * User-operated monthly reporting lane:
 * maps BO report cards to Lloyd's CRS v5.2 execution config.
 */
export function resolveReportExecutionConfig(reportName: string): ReportExecutionConfig {
  if (reportName.includes('Travel')) {
    return { lane: 'LLOYDS_MONTHLY_EXPORT', stream: 'premium', format: 'xlsx', productType: 'TRAVEL' };
  }
  if (reportName.includes('Premium')) {
    return { lane: 'LLOYDS_MONTHLY_EXPORT', stream: 'premium', format: 'xlsx' };
  }
  if (reportName.includes('Claims')) {
    return { lane: 'LLOYDS_MONTHLY_EXPORT', stream: 'claims', format: 'xlsx' };
  }
  if (reportName.includes('Risk')) {
    return { lane: 'LLOYDS_MONTHLY_EXPORT', stream: 'risk', format: 'csv' };
  }
  return { lane: 'UNWIRED' };
}

