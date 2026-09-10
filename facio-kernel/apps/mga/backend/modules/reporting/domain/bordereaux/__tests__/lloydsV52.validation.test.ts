import { describe, expect, it } from 'vitest';
import {
  buildLloydsV52ExportMetadata,
  getDefaultHeaders,
  lloydsV52SpecVersionForProduct,
  validateLloydsV52Rows,
} from '../lloydsV52.js';

describe('lloydsV52 validation layers', () => {
  it('returns structure errors for missing mandatory risk fields', () => {
    const validation = validateLloydsV52Rows('risk', [{}]);
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(validation.errors[0]?.category).toBe('STRUCTURE');
  });

  it('selects Home-specific risk headers without motor vehicle fields', () => {
    const headers = getDefaultHeaders('risk', 'HOME');
    expect(headers).toContain('Property Address');
    expect(headers).toContain('Property Type');
    expect(headers).not.toContain('CR0033 Vehicle Registration Number');
  });

  it('selects Travel-specific risk headers without motor vehicle fields', () => {
    const headers = getDefaultHeaders('risk', 'TRAVEL');
    expect(headers).toContain('Travel Destinations');
    expect(headers).toContain('Travel Plan Type');
    expect(headers).not.toContain('CR0033 Vehicle Registration Number');
  });

  it('rejects unsupported product types instead of falling back to Motor', () => {
    expect(() => getDefaultHeaders('risk', 'MARINE')).toThrow(/does not support product type MARINE/);
  });

  it('fails risk rows when expiry is before inception', () => {
    const validation = validateLloydsV52Rows('risk', [{
      'CR0030 Risk Inception Date': '31/03/2026',
      'CR0031 Risk Expiry Date': '01/03/2026',
    }]);
    expect(validation.errors.some((error) => error.code === 'SEMANTIC_RISK_EXPIRY_BEFORE_INCEPTION')).toBe(true);
  });

  it('warns claims rows when total incurred does not reconcile', () => {
    const validation = validateLloydsV52Rows('claims', [{
      'CR0134 Total Incurred Indemnity': 100,
      'CR0135 Total Incurred Fees': 25,
      'CR0155 Total Incurred': 140,
    }]);
    expect(validation.warnings.some((warning) => warning.code === 'SEMANTIC_CLAIMS_TOTAL_INCURRED_MISMATCH')).toBe(true);
  });

  it('returns semantic warning for premium arithmetic mismatch', () => {
    const row = {
      'CR0013 Coverholder Name': 'A',
      'CR0014 Coverholder PIN': 'P',
      'CR0005 UMR': 'U',
      'CR0006 Agreement Number': 'AG',
      'CR0026 Policy or Group Reference': 'POL',
      'CR0022 Risk Transaction Type': 'New Business',
      'CR0056 Premium Transaction Type': 'Original Premium',
      'CR0057 Effective Date of Transaction': '2026-01-01',
      'CR0021 Total Gross Written Premium': 100,
      'CR0059 Gross Premium Paid This Time': 100,
      'CR0061 Commission Percentage': 10,
      'CR0062 Commission Amount': 10,
      'CR0064 Total Taxes and Levies': 2,
      'CR0925 Total Fee Amount': 9,
      'CR0065 Net Premium to London (Original Currency)': 80,
      'CR0067 Rate of Exchange': 1,
      'CR0068 Net Premium to London (Settlement Currency)': 90,
      'CR1297 Lloyds Platform': 'LBS',
      'CR0077 Tax 1 Territory': 'CYPRUS',
      'CR0078 Tax 1 Type': 'STAMP DUTY',
      'CR0079 Tax 1 Taxable Amount': 100,
      'CR0083 Tax 1 Amount': 2,
      'CR0288 Number of Instalments': 1,
      'CR0289 Instalment Basis': 'Single',
      'CR0020 Original Currency': 'EUR',
    };
    const validation = validateLloydsV52Rows('premium', [row]);
    expect(validation.warnings.some((warning) => warning.code === 'SEMANTIC_NET_PREMIUM_MISMATCH')).toBe(true);
  });

  it('generates deterministic export hash for identical input', () => {
    const headers = ['CR0026 Policy or Group Reference', 'CR0056 Premium Transaction Type', 'CR0057 Effective Date of Transaction'];
    const rows = [{
      'CR0026 Policy or Group Reference': 'POL-1',
      'CR0056 Premium Transaction Type': 'Original Premium',
      'CR0057 Effective Date of Transaction': '2026-01-01',
    }];
    const validationSummary = { errors: [], warnings: [], infos: [] };

    const one = buildLloydsV52ExportMetadata({
      stream: 'premium',
      binderId: 'binder-1',
      productType: 'MOTOR',
      year: 2026,
      month: 1,
      rows,
      headers,
      specVersion: 'spec-v1',
      ruleProfileVersion: 'rules-v1',
      validationSummary,
    });
    const two = buildLloydsV52ExportMetadata({
      stream: 'premium',
      binderId: 'binder-1',
      productType: 'MOTOR',
      year: 2026,
      month: 1,
      rows,
      headers,
      specVersion: 'spec-v1',
      ruleProfileVersion: 'rules-v1',
      validationSummary,
    });
    expect(one.exportHash).toBe(two.exportHash);
    expect(one.rowIdentityKeys).toEqual(two.rowIdentityKeys);
  });

  it('includes product type in export lineage and hash', () => {
    const base = {
      stream: 'premium' as const,
      binderId: 'binder-1',
      year: 2026,
      month: 1,
      rows: [{ 'CR0026 Policy or Group Reference': 'POL-1' }],
      headers: ['CR0026 Policy or Group Reference'],
      ruleProfileVersion: 'rules-v1',
      validationSummary: { errors: [], warnings: [], infos: [] },
    };
    const motor = buildLloydsV52ExportMetadata({
      ...base,
      productType: 'MOTOR',
      specVersion: lloydsV52SpecVersionForProduct('MOTOR'),
    });
    const home = buildLloydsV52ExportMetadata({
      ...base,
      productType: 'HOME',
      specVersion: lloydsV52SpecVersionForProduct('HOME'),
    });

    expect(motor.productType).toBe('MOTOR');
    expect(home.productType).toBe('HOME');
    expect(motor.specVersion).toBe('lloyds-v52-motor-1');
    expect(home.specVersion).toBe('lloyds-v52-home-1');
    expect(motor.exportHash).not.toBe(home.exportHash);
  });

  it('enforces premium mandatory CR coverage and arithmetic for NB + endorsement samples', () => {
    const mandatoryPremiumFields = [
      'CR0001 Reporting Period Start Date',
      'CR0002 Reporting Period End Date',
      'CR0013 Coverholder Name',
      'CR0014 Coverholder PIN',
      'CR0005 UMR',
      'CR0006 Agreement Number',
      'CR0010 Year of Account',
      'CR0016 Risk Code',
      'CR0017 Class of Business',
      'CR0019 Type of Insurance',
      'CR0020 Original Currency',
      'CR0021 Total Gross Written Premium',
      'CR0022 Risk Transaction Type',
      'CR0026 Policy or Group Reference',
      'CR0029 Certificate Reference',
      'CR0030 Risk Inception Date',
      'CR0031 Risk Expiry Date',
      'CR0056 Premium Transaction Type',
      'CR0057 Effective Date of Transaction',
      'CR0059 Gross Premium Paid This Time',
      'CR0061 Commission Percentage',
      'CR0062 Commission Amount',
      'CR0064 Total Taxes and Levies',
      'CR0925 Total Fee Amount',
      'CR0065 Net Premium to London (Original Currency)',
      'CR0288 Number of Instalments',
      'CR0289 Instalment Basis',
      'CR0066 Settlement Currency',
      'CR0067 Rate of Exchange',
      'CR0068 Net Premium to London (Settlement Currency)',
      'CR1297 Lloyds Platform',
    ] as const;

    const nbRow = {
      'CR0001 Reporting Period Start Date': '01/03/2026',
      'CR0002 Reporting Period End Date': '31/03/2026',
      'CR0013 Coverholder Name': 'Abbeygate MGA',
      'CR0014 Coverholder PIN': '115933OFE',
      'CR0005 UMR': 'B6081ABBEYGATE0125',
      'CR0006 Agreement Number': 'ABBEYGATE0125',
      'CR0010 Year of Account': 2026,
      'CR0016 Risk Code': 'AUTO_MOTOR',
      'CR0017 Class of Business': 'MOTOR',
      'CR0019 Type of Insurance': 'DIRECT',
      'CR0020 Original Currency': 'EUR',
      'CR0021 Total Gross Written Premium': 261.0,
      'CR0022 Risk Transaction Type': 'New Business',
      'CR0026 Policy or Group Reference': 'ABOLV1000006',
      'CR0029 Certificate Reference': '825000001',
      'CR0035 Insured Name': 'Sample Insured',
      'CR0030 Risk Inception Date': '15/03/2026',
      'CR0031 Risk Expiry Date': '14/03/2027',
      'CR0056 Premium Transaction Type': 'Original Premium',
      'CR0057 Effective Date of Transaction': '15/03/2026',
      'CR0058 Expiry Date of Transaction': '14/03/2027',
      'CR0059 Gross Premium Paid This Time': 261.0,
      'CR0061 Commission Percentage': 30,
      'CR0062 Commission Amount': 78.3,
      'CR0064 Total Taxes and Levies': 2,
      'CR0925 Total Fee Amount': 9,
      'CR0065 Net Premium to London (Original Currency)': 182.7,
      'CR0288 Number of Instalments': 1,
      'CR0289 Instalment Basis': 'Single',
      'CR0066 Settlement Currency': 'EUR',
      'CR0067 Rate of Exchange': 1,
      'CR0068 Net Premium to London (Settlement Currency)': 182.7,
      'CR1297 Lloyds Platform': 'LBS',
      'CR0077 Tax 1 Territory': 'CYPRUS',
      'CR0078 Tax 1 Type': 'STAMP DUTY',
      'CR0079 Tax 1 Taxable Amount': 261.0,
      'CR0080 Tax 1 Rate': '',
      'CR0081 Tax 1 Fixed Rate': 2,
      'CR0083 Tax 1 Amount': 2,
    };

    const endorsementRow = {
      ...nbRow,
      'CR0021 Total Gross Written Premium': 301.0,
      'CR0022 Risk Transaction Type': 'Adjustment',
      'CR0056 Premium Transaction Type': 'Additional Premium',
      'CR0057 Effective Date of Transaction': '15/06/2026',
      'CR0059 Gross Premium Paid This Time': 40.0,
      'CR0062 Commission Amount': 12.0,
      'CR0064 Total Taxes and Levies': 0,
      'CR0925 Total Fee Amount': 0,
      'CR0065 Net Premium to London (Original Currency)': 28.0,
      'CR0068 Net Premium to London (Settlement Currency)': 28.0,
      'CR0077 Tax 1 Territory': '',
      'CR0078 Tax 1 Type': '',
      'CR0079 Tax 1 Taxable Amount': '',
      'CR0080 Tax 1 Rate': '',
      'CR0081 Tax 1 Fixed Rate': '',
      'CR0083 Tax 1 Amount': '',
    };

    const rows = [nbRow, endorsementRow];
    for (const row of rows) {
      for (const field of mandatoryPremiumFields) {
        expect(row[field]).toBeDefined();
        expect(String(row[field]).trim()).not.toBe('');
      }
    }

    const validation = validateLloydsV52Rows('premium', rows);
    expect(validation.errors).toHaveLength(0);
    expect(validation.warnings).toHaveLength(0);
  });

  it('fails when CR1297 is blank', () => {
    const row = {
      'CR0013 Coverholder Name': 'A',
      'CR0014 Coverholder PIN': 'P',
      'CR0005 UMR': 'U',
      'CR0006 Agreement Number': 'AG',
      'CR0026 Policy or Group Reference': 'POL',
      'CR0029 Certificate Reference': 'CERT-1',
      'CR0022 Risk Transaction Type': 'New Business',
      'CR0056 Premium Transaction Type': 'Original Premium',
      'CR0057 Effective Date of Transaction': '2026-01-01',
      'CR0021 Total Gross Written Premium': 100,
      'CR0059 Gross Premium Paid This Time': 100,
      'CR0061 Commission Percentage': 30,
      'CR0062 Commission Amount': 30,
      'CR0064 Total Taxes and Levies': 2,
      'CR0925 Total Fee Amount': 9,
      'CR0065 Net Premium to London (Original Currency)': 70,
      'CR0067 Rate of Exchange': 1,
      'CR0068 Net Premium to London (Settlement Currency)': 70,
      'CR0020 Original Currency': 'EUR',
      'CR0288 Number of Instalments': 1,
      'CR0289 Instalment Basis': 'Single',
      'CR0077 Tax 1 Territory': 'CYPRUS',
      'CR0078 Tax 1 Type': 'STAMP DUTY',
      'CR0079 Tax 1 Taxable Amount': 100,
      'CR0081 Tax 1 Fixed Rate': 2,
      'CR0083 Tax 1 Amount': 2,
    };
    const validation = validateLloydsV52Rows('premium', [row]);
    expect(validation.errors.some((error) => error.code === 'SEMANTIC_PLATFORM_MISSING')).toBe(true);
  });

  it('fails when CR0022 uses internal shorthand code', () => {
    const row = {
      'CR0013 Coverholder Name': 'A',
      'CR0014 Coverholder PIN': 'P',
      'CR0005 UMR': 'U',
      'CR0006 Agreement Number': 'AG',
      'CR0026 Policy or Group Reference': 'POL',
      'CR0029 Certificate Reference': 'CERT-1',
      'CR0022 Risk Transaction Type': 'NB',
      'CR0056 Premium Transaction Type': 'Original Premium',
      'CR0057 Effective Date of Transaction': '2026-01-01',
      'CR0021 Total Gross Written Premium': 100,
      'CR0059 Gross Premium Paid This Time': 100,
      'CR0061 Commission Percentage': 30,
      'CR0062 Commission Amount': 30,
      'CR0064 Total Taxes and Levies': 2,
      'CR0925 Total Fee Amount': 9,
      'CR0065 Net Premium to London (Original Currency)': 70,
      'CR0067 Rate of Exchange': 1,
      'CR0068 Net Premium to London (Settlement Currency)': 70,
      'CR1297 Lloyds Platform': 'LBS',
      'CR0020 Original Currency': 'EUR',
      'CR0288 Number of Instalments': 1,
      'CR0289 Instalment Basis': 'Single',
      'CR0077 Tax 1 Territory': 'CYPRUS',
      'CR0078 Tax 1 Type': 'STAMP DUTY',
      'CR0079 Tax 1 Taxable Amount': 100,
      'CR0081 Tax 1 Fixed Rate': 2,
      'CR0083 Tax 1 Amount': 2,
    };
    const validation = validateLloydsV52Rows('premium', [row]);
    expect(validation.errors.some((error) => error.code === 'SEMANTIC_RISK_TRANSACTION_TYPE_UNMAPPED')).toBe(true);
  });

  it('warns on zero-premium adjustment row carrying default charges', () => {
    const row = {
      'CR0013 Coverholder Name': 'A',
      'CR0014 Coverholder PIN': 'P',
      'CR0005 UMR': 'U',
      'CR0006 Agreement Number': 'AG',
      'CR0026 Policy or Group Reference': 'POL',
      'CR0029 Certificate Reference': 'CERT-1',
      'CR0022 Risk Transaction Type': 'Adjustment',
      'CR0056 Premium Transaction Type': 'Additional Premium',
      'CR0057 Effective Date of Transaction': '2026-01-01',
      'CR0021 Total Gross Written Premium': 100,
      'CR0059 Gross Premium Paid This Time': 0,
      'CR0061 Commission Percentage': 30,
      'CR0062 Commission Amount': 0,
      'CR0064 Total Taxes and Levies': 2,
      'CR0925 Total Fee Amount': 9,
      'CR0065 Net Premium to London (Original Currency)': 0,
      'CR0067 Rate of Exchange': 1,
      'CR0068 Net Premium to London (Settlement Currency)': 0,
      'CR1297 Lloyds Platform': 'LBS',
      'CR0020 Original Currency': 'EUR',
      'CR0288 Number of Instalments': 1,
      'CR0289 Instalment Basis': 'Single',
      'CR0077 Tax 1 Territory': 'CYPRUS',
      'CR0078 Tax 1 Type': 'STAMP DUTY',
      'CR0079 Tax 1 Taxable Amount': 0,
      'CR0081 Tax 1 Fixed Rate': 2,
      'CR0083 Tax 1 Amount': 2,
    };
    const validation = validateLloydsV52Rows('premium', [row]);
    expect(validation.warnings.some((warning) => warning.code === 'SEMANTIC_ZERO_MOVEMENT_CHARGES_PRESENT')).toBe(true);
  });

  it('warns when tax detail does not reconcile to CR0064', () => {
    const row = {
      'CR0013 Coverholder Name': 'A',
      'CR0014 Coverholder PIN': 'P',
      'CR0005 UMR': 'U',
      'CR0006 Agreement Number': 'AG',
      'CR0026 Policy or Group Reference': 'POL',
      'CR0029 Certificate Reference': 'CERT-1',
      'CR0022 Risk Transaction Type': 'New Business',
      'CR0056 Premium Transaction Type': 'Original Premium',
      'CR0057 Effective Date of Transaction': '2026-01-01',
      'CR0021 Total Gross Written Premium': 100,
      'CR0059 Gross Premium Paid This Time': 100,
      'CR0061 Commission Percentage': 30,
      'CR0062 Commission Amount': 30,
      'CR0064 Total Taxes and Levies': 2,
      'CR0925 Total Fee Amount': 9,
      'CR0065 Net Premium to London (Original Currency)': 70,
      'CR0067 Rate of Exchange': 1,
      'CR0068 Net Premium to London (Settlement Currency)': 70,
      'CR1297 Lloyds Platform': 'LBS',
      'CR0020 Original Currency': 'EUR',
      'CR0288 Number of Instalments': 1,
      'CR0289 Instalment Basis': 'Single',
      'CR0077 Tax 1 Territory': 'CYPRUS',
      'CR0078 Tax 1 Type': 'STAMP DUTY',
      'CR0079 Tax 1 Taxable Amount': 100,
      'CR0081 Tax 1 Fixed Rate': 2,
      'CR0083 Tax 1 Amount': 1,
    };
    const validation = validateLloydsV52Rows('premium', [row]);
    expect(validation.warnings.some((warning) => warning.code === 'SEMANTIC_TAX_DETAIL_SUMMARY_MISMATCH')).toBe(true);
  });

  it('fails when CR0056 uses non-lloyds wording', () => {
    const row = {
      'CR0013 Coverholder Name': 'A',
      'CR0014 Coverholder PIN': 'P',
      'CR0005 UMR': 'U',
      'CR0006 Agreement Number': 'AG',
      'CR0026 Policy or Group Reference': 'POL',
      'CR0029 Certificate Reference': 'CERT-1',
      'CR0022 Risk Transaction Type': 'New Business',
      'CR0056 Premium Transaction Type': 'ORIGINAL',
      'CR0057 Effective Date of Transaction': '01/01/2026',
      'CR0030 Risk Inception Date': '01/01/2026',
      'CR0021 Total Gross Written Premium': 100,
      'CR0059 Gross Premium Paid This Time': 100,
      'CR0061 Commission Percentage': 30,
      'CR0062 Commission Amount': 30,
      'CR0064 Total Taxes and Levies': 2,
      'CR0925 Total Fee Amount': 9,
      'CR0065 Net Premium to London (Original Currency)': 70,
      'CR0067 Rate of Exchange': 1,
      'CR0068 Net Premium to London (Settlement Currency)': 70,
      'CR1297 Lloyds Platform': 'LBS',
      'CR0020 Original Currency': 'EUR',
      'CR0288 Number of Instalments': 1,
      'CR0289 Instalment Basis': 'Single',
      'CR0077 Tax 1 Territory': 'CYPRUS',
      'CR0078 Tax 1 Type': 'STAMP DUTY',
      'CR0079 Tax 1 Taxable Amount': 100,
      'CR0081 Tax 1 Fixed Rate': 2,
      'CR0083 Tax 1 Amount': 2,
    };
    const validation = validateLloydsV52Rows('premium', [row]);
    expect(validation.errors.some((error) => error.code === 'SEMANTIC_PREMIUM_TRANSACTION_TYPE_UNMAPPED')).toBe(true);
  });

  it('fails when New Business original effective date is before inception', () => {
    const row = {
      'CR0013 Coverholder Name': 'A',
      'CR0014 Coverholder PIN': 'P',
      'CR0005 UMR': 'U',
      'CR0006 Agreement Number': 'AG',
      'CR0026 Policy or Group Reference': 'POL',
      'CR0029 Certificate Reference': 'CERT-1',
      'CR0022 Risk Transaction Type': 'New Business',
      'CR0056 Premium Transaction Type': 'Original Premium',
      'CR0057 Effective Date of Transaction': '15/03/2026',
      'CR0030 Risk Inception Date': '18/03/2026',
      'CR0021 Total Gross Written Premium': 100,
      'CR0059 Gross Premium Paid This Time': 100,
      'CR0061 Commission Percentage': 30,
      'CR0062 Commission Amount': 30,
      'CR0064 Total Taxes and Levies': 2,
      'CR0925 Total Fee Amount': 9,
      'CR0065 Net Premium to London (Original Currency)': 70,
      'CR0067 Rate of Exchange': 1,
      'CR0068 Net Premium to London (Settlement Currency)': 70,
      'CR1297 Lloyds Platform': 'LBS',
      'CR0020 Original Currency': 'EUR',
      'CR0288 Number of Instalments': 1,
      'CR0289 Instalment Basis': 'Single',
      'CR0077 Tax 1 Territory': 'CYPRUS',
      'CR0078 Tax 1 Type': 'STAMP DUTY',
      'CR0079 Tax 1 Taxable Amount': 100,
      'CR0081 Tax 1 Fixed Rate': 2,
      'CR0083 Tax 1 Amount': 2,
    };
    const validation = validateLloydsV52Rows('premium', [row]);
    expect(validation.errors.some((error) => error.code === 'NB_EFFECTIVE_BEFORE_INCEPTION')).toBe(true);
  });

  it('adds informational note when fixed tax uses CR0081 and CR0080 is blank', () => {
    const row = {
      'CR0013 Coverholder Name': 'A',
      'CR0014 Coverholder PIN': 'P',
      'CR0005 UMR': 'U',
      'CR0006 Agreement Number': 'AG',
      'CR0026 Policy or Group Reference': 'POL',
      'CR0029 Certificate Reference': 'CERT-1',
      'CR0022 Risk Transaction Type': 'New Business',
      'CR0056 Premium Transaction Type': 'Original Premium',
      'CR0057 Effective Date of Transaction': '18/03/2026',
      'CR0030 Risk Inception Date': '18/03/2026',
      'CR0021 Total Gross Written Premium': 100,
      'CR0059 Gross Premium Paid This Time': 100,
      'CR0061 Commission Percentage': 30,
      'CR0062 Commission Amount': 30,
      'CR0064 Total Taxes and Levies': 2,
      'CR0925 Total Fee Amount': 9,
      'CR0065 Net Premium to London (Original Currency)': 70,
      'CR0067 Rate of Exchange': 1,
      'CR0068 Net Premium to London (Settlement Currency)': 70,
      'CR1297 Lloyds Platform': 'LBS',
      'CR0020 Original Currency': 'EUR',
      'CR0288 Number of Instalments': 1,
      'CR0289 Instalment Basis': 'Single',
      'CR0077 Tax 1 Territory': 'CYPRUS',
      'CR0078 Tax 1 Type': 'STAMP DUTY',
      'CR0079 Tax 1 Taxable Amount': 100,
      'CR0080 Tax 1 Rate': '',
      'CR0081 Tax 1 Fixed Rate': 2,
      'CR0083 Tax 1 Amount': 2,
    };
    const validation = validateLloydsV52Rows('premium', [row]);
    expect(validation.infos.some((info) => info.code === 'FIXED_TAX_NO_RATE')).toBe(true);
  });
});

