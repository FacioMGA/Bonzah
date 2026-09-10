export type BdxCellType = 'string' | 'number' | 'date';
export type BordereauxStream = 'risk' | 'premium' | 'claims';

const STREAM_DATE_HEADERS: Record<BordereauxStream, Set<string>> = {
  risk: new Set([
    'CR0001 Reporting Period Start Date',
    'CR0002 Reporting Period End Date',
    'CR0030 Risk Inception Date',
    'CR0031 Risk Expiry Date',
  ]),
  premium: new Set([
    'CR0001 Reporting Period Start Date',
    'CR0002 Reporting Period End Date',
    'CR0030 Risk Inception Date',
    'CR0031 Risk Expiry Date',
    'CR0057 Effective Date of Transaction',
    'CR0058 Expiry Date of Transaction',
  ]),
  claims: new Set([
    'CR0001 Reporting Period Start',
    'CR0002 Reporting Period End',
    'CR0030 Risk Inception Date',
    'CR0031 Risk Expiry Date',
    'CR0119 Date of Loss From',
    'CR0120 Date of Loss To',
    'CR0137 Date Closed',
    'CR0311 Date Claim Denied',
    'CR0306 Date Re-opened',
    'CR0316 Date Claim Withdrawn',
  ]),
};

const STREAM_NUMBER_HEADERS: Record<BordereauxStream, Set<string>> = {
  risk: new Set([
    'Vehicle Year',
    'CR0052 Sum Insured Amount',
    'CR0054 Deductible/Excess Amount',
    'CR0059 Gross Premium Paid This Time',
  ]),
  premium: new Set([
    'CR0010 Year of Account',
    'CR0021 Total Gross Written Premium',
    'CR0059 Gross Premium Paid This Time',
    'CR0061 Commission Percentage',
    'CR0062 Commission Amount',
    'CR0064 Total Taxes and Levies',
    'CR0925 Total Fee Amount',
    'CR0065 Net Premium to London (Original Currency)',
    'CR0288 Number of Instalments',
    'CR0067 Rate of Exchange',
    'CR0068 Net Premium to London (Settlement Currency)',
    'CR0079 Tax 1 Taxable Amount',
    'CR0080 Tax 1 Rate',
    'CR0081 Tax 1 Fixed Rate',
    'CR0083 Tax 1 Amount',
    'Tax 1 Amount',
    'Tax 1 Rate',
    'Tax 2 Amount',
    'Tax 2 Rate',
    'Tax 3 Amount',
    'Tax 3 Rate',
    'Tax 4 Amount',
    'Tax 4 Rate',
    'Tax 5 Amount',
    'Tax 5 Rate',
  ]),
  claims: new Set([
    'CR0126 Paid This Month Indemnity',
    'CR0127 Paid This Month Fees',
    'CR0128 Previously Paid Indemnity',
    'CR0129 Previously Paid Fees',
    'CR0130 Reserve Indemnity',
    'CR0131 Reserve Fees',
    'CR0134 Total Incurred Indemnity',
    'CR0135 Total Incurred Fees',
    'CR0155 Total Incurred',
    'CR0375 Recoveries Received To Date',
    'CR0376 Recoveries Outstanding',
  ]),
};

export function bdxCellTypeForHeader(stream: BordereauxStream, header: string): BdxCellType {
  if (STREAM_DATE_HEADERS[stream].has(header)) return 'date';
  if (STREAM_NUMBER_HEADERS[stream].has(header)) return 'number';
  return 'string';
}
