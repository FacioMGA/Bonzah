import type { BdxRawRow, BdxRowDto } from '../types.js';

export type MotorBdxMapper = (row: BdxRawRow, sourceRowNumber: number) => BdxRowDto;

/**
 * Motor BDX import mapping — single source of truth for the
 * raw-column → DTO surface for the Cyprus/Portugal motor BDX dialect.
 *
 * `spine/v2` Wave 5 consolidation:
 *   - Every column accepted by `mapRawRowToDto` is declared here. Each
 *     field lists the canonical column name first; subsequent entries
 *     are real spreadsheet variations the prospect ships (e.g. the
 *     literal double-space in `'Gross  Premium'`).
 *   - The endorsement-code translation table (`AB N → CV N`) and the
 *     policy-ref-specific corrections (`applyApprovedBdxCorrections`)
 *     were both deleted. Source spreadsheets must arrive with canonical
 *     `CV N` codes and clean dates; bad rows fail import loud and are
 *     fixed at the source, not laundered by the importer.
 *   - The classic-vehicle resolver for `AB 171` is gone with the rest;
 *     classic motor endorsements come in as `ABG001` directly.
 */
export const motorLloydsV52MappingSpec = {
  productLine: 'motor',
  productType: 'MOTOR',
  policyFields: {
    policyRef: ['Policy Number', 'Policy'],
    entry: ['Entry Type', 'Entry'],
    sourceId: ['NIE/Passport', 'Id', 'Tax Identification Number'],
    endorsement: ['Endorsement'],
    note: ['Note'],
  },
  insuredFields: {
    name: ['Insured'],
    dateOfBirth: ['Date Of Birth'],
    occupation: ['Occupation'],
    postcode: ['Postcode'],
  },
  coverFields: {
    cover: ['Cover'],
    drivers: ['Drivers'],
    use: ['Use'],
    excess: ['Excess'],
  },
  premiumFields: {
    gross: ['Gross  Premium', 'Gross Premium', 'Net Premium'],
    commission: ['Commission', 'Comm.', 'Comm'],
    mifPayable: ['Mif', 'MIF Payable', 'Tax Value'],
    stampPayable: ['Stamp', 'Stamp Payable', 'Stamp Duty'],
    fees: ['Green Card Fee'],
    net: ['Payable to ARB', 'Pay able to ARB', 'Due to ARB', 'NWP'],
    total: ['Premium Payable', 'Premium'],
  },
  dateFields: {
    inception: ['Inception Date', 'Inception'],
    expiry: ['Expiry Date', 'Expiry'],
    booked: ['Booked Date', 'Booked'],
    change: ['Date Of Change'],
  },
  riskFields: {
    make: ['Make'],
    model: ['Model'],
    engineSize: ['Engine Size'],
    vehicleValue: ['Vehicle Value'],
    vehicleYear: ['Year'],
    registration: ['Registration'],
    details: ['Details', 'Detail'],
    ncbYears: ['NCB Discount years'],
    claimProtection: ['Claim protection option'],
  },
} as const;
