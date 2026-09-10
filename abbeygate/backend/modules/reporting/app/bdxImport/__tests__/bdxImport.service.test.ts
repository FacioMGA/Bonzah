import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { evaluateBdxMigrationRows } from '../service.js';
import { buildQuoteDataFromDto, mapRawRowToDto } from '../mapper.js';
import { filterRowsForTenantSheet, readTabularRows } from '../../../infra/readTabularRows.js';
import { registerAllProducts } from '../../../../../products/registerProducts.js';
import { resolveJurisdictionProductConfig } from '../../../../jurisdiction/domain/productConfiguration.js';

registerAllProducts();

/**
 * Tag a row literal as a motor BDX row.
 *
 * `mapRawRowToDto` requires an explicit `__productLine` (or compatible
 * `Class of Business`) since `spine/v2` Wave 5 deleted the silent
 * default-to-motor branch. In production the productLine flows from
 * the operator's UI selection through `BdxImportRequest.productLine`
 * (see `evaluateBdxMigrationRows`); here in tests we tag the row
 * literal directly so each fixture is self-describing.
 */
function motorRow<T extends Record<string, unknown>>(r: T): T & { __productLine: 'motor' } {
  return { __productLine: 'motor' as const, ...r };
}

// Pure-mapper regression tests (no tenant ALS context) live in
// `mapperRegression.test.ts`. This file holds the evaluator-path tests
// that hit `getTenantConfig()` and therefore require
// `runWithOperatingTenant`.
describe('bdx import evaluation', () => {
  // Regression — see commit 824718b4 ("refactor(spine/v2): delete legacy/
  // back-compat paths"). The mapper-side coverage for the AB→CV alias
  // map, the AB 171 classic-vehicle resolver, ABG001 case-insensitivity,
  // travel Group-Ref-vs-Cert-Ref policyRef ordering, travel
  // maxTripDays defaulting, and the disposition-aware completeness
  // carve-out for CAN/PAM/ADJ rows lives in `mapperRegression.test.ts`.
  // Keep the failure modes in sync — both files must pass for a BDX
  // commit to succeed on a typical Cyprus + Portugal corpus.

  it('flags structural failures for malformed rows', async () => {
    const evaluations = await evaluateBdxMigrationRows({
      rows: [
        motorRow({
          Id: 'x1',
          Entry: '',
          Insured: 'Test Person',
          Policy: '',
          Inception: '',
          Expiry: '',
          Cover: '',
        }),
      ],
      request: {
        sourceFilePath: 'ignored.xlsx',
        dryRun: true,
      },
      program: { id: 'prog-1', metadata: {} },
    });
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]?.result).toBe('FAIL');
    expect(evaluations[0]?.gaps.some((g) => g.category === 'STRUCTURAL')).toBe(true);
  });

  it('is deterministic for same input row', async () => {
    const row = motorRow({
      Id: '1',
      Entry: 'NB',
      Insured: 'Test User',
      Policy: 'ABLV1000001',
      Inception: '2025-12-01',
      Expiry: '2026-12-01',
      DateOfBirth: '1980-01-01',
      'Date Of Birth': '1980-01-01',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      Make: 'FORD',
      Model: 'FOCUS',
      'Engine Size': 1600,
      'Vehicle Value': 10000,
      Year: 2018,
      Registration: 'ABC123',
      Excess: 200,
      'Premium Payable': 300,
      'Gross  Premium': 289,
      'MIF Payable': 9,
      'Stamp Payable': 2,
      Commission: 86.7,
      'Payable to ARB': 202.3,
    });
    const first = await evaluateBdxMigrationRows({
      rows: [row],
      request: { sourceFilePath: 'ignored.xlsx', dryRun: true, productLine: 'motor' },
      program: { id: 'prog-1', metadata: {} },
    });
    const second = await evaluateBdxMigrationRows({
      rows: [row],
      request: { sourceFilePath: 'ignored.xlsx', dryRun: true, productLine: 'motor' },
      program: { id: 'prog-1', metadata: {} },
    });
    expect(first[0]?.result).toBe(second[0]?.result);
    expect(first[0]?.dto.rowKey).toBe(mapRawRowToDto(row, 2).rowKey); // row already wrapped via motorRow above
    expect(first[0]?.enrichment?.profile).toBe('BDX_CONTRACT_PROFILE_MOTOR');
  });

  it('uses PT Motor BDX defaults without Cyprus leakage', () => {
    const config = resolveJurisdictionProductConfig({ productCode: 'MOTOR', source: { countryCode: 'PT' } });
    const dto = mapRawRowToDto(motorRow({
      Id: 'pt-1',
      Entry: 'NB',
      Insured: 'Portugal Driver',
      Policy: 'PTM1000001',
      Inception: '2026-06-01',
      Expiry: '2027-06-01',
      'Date Of Birth': '1980-01-01',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      Make: 'FORD',
      Model: 'FOCUS',
      'Engine Size': 1600,
      'Vehicle Value': 10000,
      Year: 2018,
      Registration: 'PT-123',
      Excess: 200,
    }), 2, config);
    const quoteData = buildQuoteDataFromDto(dto, config);
    const proposer = quoteData.proposer as Record<string, unknown>;
    const address = proposer.address as Record<string, unknown>;
    const migration = quoteData.__migrationMeta as Record<string, unknown>;

    expect(address.country).toBe('Portugal');
    expect(quoteData.countryOfRegistration).toBe('Portugal');
    expect(quoteData.licenseIssuedIn).toBe('Portugal');
    expect(proposer.nationality).toBe('Portugal');
    expect(migration.source).toBe('BDX_VOLANTE_PORTUGAL_2026');
  });

  it('uses PT Home and Travel BDX defaults instead of Cyprus fallbacks', () => {
    const homeConfig = resolveJurisdictionProductConfig({ productCode: 'HOME', source: { countryCode: 'PT' } });
    const travelConfig = resolveJurisdictionProductConfig({ productCode: 'TRAVEL', source: { countryCode: 'PT' } });
    const homeDto = mapRawRowToDto({
      __productLine: 'home',
      'Certificate Ref': 'PTH-1',
      'Risk, Transaction Type': 'NB',
      'Insured First Name': 'Home',
      'Insured Full Name, Last Name or Company Name': 'Owner',
      'Risk Gross Total Premium (ex Ipt)': 100,
    }, 2, homeConfig);
    const travelDto = mapRawRowToDto({
      __productLine: 'travel',
      'Certificate Ref': 'PTT-1',
      'Risk, Transaction Type': 'NB',
      'Insured First Name': 'Travel',
      'Insured Full Name, Last Name or Company Name': 'User',
      'Total gross written premium': 100,
    }, 3, travelConfig);

    expect((homeDto.productData?.proposer as Record<string, unknown> | undefined)?.nationality).toBe('Portugal');
    expect(((homeDto.productData?.property as Record<string, unknown> | undefined)?.address as Record<string, unknown> | undefined)?.country).toBe('Portugal');
    expect((travelDto.productData?.eligibility as Record<string, unknown> | undefined)?.countryOfResidence).toBe('Portugal');
  });

  it('parses day-first BDX dates so they remain usable for validation and proration', () => {
    const row = {
      Id: 'day-first-dates',
      Entry: 'RNL',
      Insured: 'Date Format Driver',
      Policy: 'ABLV2600001',
      Booked: '10/02/2026',
      Inception: '14/02/2026',
      Expiry: '14/02/2027',
      'Date Of Birth': '17/02/1960',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      Make: 'FORD',
      Model: 'KA 1.2 TITANIUM',
      'Engine Size': 1242,
      'Vehicle Value': 5000,
      Year: 2015,
      Registration: 'DATE26',
      Excess: 250,
      'Premium Payable': 300,
      'Gross  Premium': 289,
      'MIF Payable': 9,
      'Stamp Payable': 2,
      'Comm.': 86.7,
      'Pay able to ARB': 202.3,
    };
    const dto = mapRawRowToDto(motorRow(row), 2);
    const quoteData = buildQuoteDataFromDto(dto);
    expect(dto.bookedDate).toBe('2026-02-10');
    expect(dto.inceptionDate).toBe('2026-02-14');
    expect(dto.expiryDate).toBe('2027-02-14');
    expect(dto.dateOfBirth).toBe('1960-02-17');
    expect(Number(quoteData.policyTermMonths)).toBeGreaterThan(11);
  });

  // `spine/v2` Wave 5 deleted four endorsement tests — all of them
  // exercised the (deleted) Cyprus dialect translation table:
  //   - normalizes ABG endorsement alias to ABG001
  //   - drops AB 171 for obvious non-classic private cars
  //   - maps AB 171 to ABG001 for old classic candidates
  //   - maps legacy AB endorsement aliases ... and dedupes normalized codes
  // Source spreadsheets must arrive with canonical codes (`CV N`,
  // `ABG001`); deduplication + normalization (`cv999` → `CV 999`)
  // remain covered by `mapRawRowToDto` paths exercised in other tests.
  it('normalizes and deduplicates canonical endorsement tokens', () => {
    const row = {
      __sheetName: 'Mar.25',
      Id: 'canonical-codes-1',
      Entry: 'NB',
      Insured: 'Owner',
      Policy: 'ABLV2999001',
      Inception: '2025-12-01',
      Expiry: '2026-12-01',
      'Date Of Birth': '1970-01-01',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      Make: 'FORD',
      Model: 'FOCUS',
      'Engine Size': 1600,
      'Vehicle Value': 10000,
      Year: 2018,
      Registration: 'CANON1',
      Excess: 200,
      Endorsement: 'cv4,CV 4,cv5,cv 7,CV22,ABG001,ABG001',
    };
    const dto = mapRawRowToDto(motorRow(row), 3);
    expect(dto.parsedEndorsements).toEqual([
      'CV 4',
      'CV 5',
      'CV 7',
      'CV 22',
      'ABG001',
    ]);
  });

  it('keeps row keys unique across month sheets', () => {
    const janRow = {
      __sheetName: 'Jan.25',
      Id: 'same-id',
      Entry: 'NB',
      Insured: 'Test User',
      Policy: 'ABLV1000001',
      Inception: '2025-12-01',
      Expiry: '2026-12-01',
      'Date Of Birth': '1980-01-01',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      Make: 'FORD',
      Model: 'FOCUS',
      'Engine Size': 1600,
      'Vehicle Value': 10000,
      Year: 2018,
      Registration: 'ABC123',
      Excess: 200,
      'Premium Payable': 300,
      'Gross  Premium': 289,
      'MIF Payable': 9,
      'Stamp Payable': 2,
      'Comm.': 86.7,
      'Pay able to ARB': 202.3,
    };
    const febRow = {
      ...janRow,
      __sheetName: 'Feb.25',
    };
    const janDto = mapRawRowToDto(motorRow(janRow), 3);
    const febDto = mapRawRowToDto(motorRow(febRow), 3);
    expect(janDto.rowKey).not.toBe(febDto.rowKey);
    expect(janDto.sourceSheetName).toBe('Jan.25');
    expect(febDto.sourceSheetName).toBe('Feb.25');
  });

  it('maps motorhome details to Motorcaravan vehicle type', () => {
    const row = {
      Id: 'mh-1',
      Entry: 'NB',
      Insured: 'Motorhome Owner',
      Policy: 'ABLV1888001',
      Inception: '2025-12-01',
      Expiry: '2026-12-01',
      'Date Of Birth': '1980-01-01',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      Make: 'FIAT',
      Model: 'DUCATO',
      'Engine Size': 2200,
      'Vehicle Value': 40000,
      Year: 2018,
      Registration: 'MH001',
      Excess: 400,
      Details: 'Motorhome',
    };
    const dto = mapRawRowToDto(motorRow(row), 2);
    const quoteData = buildQuoteDataFromDto(dto);
    expect(quoteData.vehicleType).toBe('Motorcaravan');
  });

  it('fills contract fields so the issue-readiness gate does not block import', async () => {
    const row = {
      Id: 'missing-nif-1',
      Entry: 'NB',
      Insured: 'No Nif',
      Policy: 'ABLV1999002',
      Inception: '2025-12-01',
      Expiry: '2026-12-01',
      'Date Of Birth': '1970-01-01',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      Make: 'FORD',
      Model: 'FIESTA',
      'Engine Size': 1000,
      'Vehicle Value': 9000,
      Year: 2018,
      Registration: 'NNIF1',
      Excess: 250,
      'Premium Payable': 300,
      'Gross  Premium': 289,
      'MIF Payable': 9,
      'Stamp Payable': 2,
      'Comm.': 86.7,
      'Pay able to ARB': 202.3,
    };
    const evaluations = await evaluateBdxMigrationRows({
      rows: [row],
      request: { sourceFilePath: 'ignored.xlsx', dryRun: true, productLine: 'motor' },
      program: { id: 'prog-1', metadata: {} },
    });
    expect(evaluations[0]?.result).toBe('FAIL');
    expect(evaluations[0]?.gaps.some((g) => g.message.includes('Issue readiness gate failed for import'))).toBe(false);
  });

  it('stores migration compliance when reconciliation is over threshold', async () => {
    const row = {
      Id: 'gross-gap-over-threshold',
      Entry: 'NB',
      Insured: 'Mismatch Driver',
      Policy: 'ABLV3000001',
      Inception: '2025-12-01',
      Expiry: '2026-12-01',
      'Date Of Birth': '1980-01-01',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      Make: 'FORD',
      Model: 'FIESTA',
      'Engine Size': 1000,
      'Vehicle Value': 9000,
      Year: 2018,
      Registration: 'BIGGAP1',
      Excess: 250,
      'Premium Payable': 120,
      'Gross  Premium': 100,
      'MIF Payable': 10,
      'Stamp Payable': 10,
      'Comm.': 30,
      'Pay able to ARB': 70,
    };
    const evaluations = await evaluateBdxMigrationRows({
      rows: [row],
      request: { sourceFilePath: 'ignored.xlsx', dryRun: true, productLine: 'motor' },
      program: { id: 'prog-1', metadata: {} },
    });
    expect(evaluations[0]?.result).toBe('FAIL');
    expect(evaluations[0]?.migrationCompliance?.state).toBe('FAIL');
    expect(evaluations[0]?.migrationCompliance?.reasonCodes).toContain('BDX_RECONCILIATION_OVER_20_PCT');
  });

  // `spine/v2` Wave 5 deleted the `applyApprovedBdxCorrections` table
  // that hard-coded fixes for individual policy refs (e.g. `ABLV1006371`
  // expiry 2016 → 2026). Dirty source rows must now be fixed at the
  // spreadsheet, not laundered by import code. The reciprocal test
  // (`applies approved workbook typo corrections for specific policy rows`)
  // was deleted alongside the function.

  it('infers electric BDX rows so zero engine size can normalize in core validation', () => {
    const row = {
      Id: 'ev-bdx-row',
      Entry: 'NB/COC',
      Insured: 'Electric Driver',
      Policy: 'ABLV5000001',
      Booked: '2025-12-02',
      Inception: '2025-10-07',
      Expiry: '2026-10-07',
      'Date Of Birth': '1979-06-28',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      Make: 'Vauxhall',
      Model: 'Vivaro 3100 Elite E',
      'Engine Size': '',
      'Vehicle Value': 120,
      Year: 2025,
      Registration: '43713',
      Excess: 250,
      'Premium Payable': 120,
      'Gross  Premium': 120,
      'MIF Payable': 0,
      'Stamp Payable': 0,
      'Comm.': 0,
      'Pay able to ARB': 120,
    };
    const dto = mapRawRowToDto(motorRow(row), 2);
    const quoteData = buildQuoteDataFromDto(dto);
    expect(quoteData.fuelType).toBe('Electric');
    expect(quoteData.engineSize).toBe(0);
  });

  it('replays later same-policy rows as endorsements in chronological order', async () => {
    const baselineRow = {
      Id: 'policy-baseline',
      Entry: 'NB',
      Insured: 'Same Policy',
      Policy: 'ABLV4000001',
      Booked: '2025-01-01',
      Inception: '2025-01-01',
      Expiry: '2026-01-01',
      'Date Of Birth': '1980-01-01',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      Make: 'FORD',
      Model: 'FOCUS',
      'Engine Size': 1400,
      'Vehicle Value': 9000,
      Year: 2018,
      Registration: 'POL4001',
      Excess: 250,
      'Premium Payable': 300,
      'Gross  Premium': 289,
      'MIF Payable': 9,
      'Stamp Payable': 2,
      'Comm.': 86.7,
      'Pay able to ARB': 202.3,
    };
    const deltaRow = {
      ...baselineRow,
      Id: 'policy-delta',
      Entry: 'PAM',
      Booked: '2025-02-01',
      'Premium Payable': 10,
      'Gross  Premium': 9.52,
      'MIF Payable': 0.48,
      'Stamp Payable': 0,
      'Comm.': 2.85,
      'Pay able to ARB': 6.67,
    };
    const evaluations = await evaluateBdxMigrationRows({
      rows: [baselineRow, deltaRow],
      request: { sourceFilePath: 'ignored.xlsx', dryRun: true, productLine: 'motor' },
      program: { id: 'prog-1', metadata: {} },
    });
    expect(evaluations[0]?.dto.policyRef).toBe('ABLV4000001');
    expect(evaluations[0]?.policyImportDisposition).toBe('IMPORT_POLICY');
    expect(evaluations[1]?.policyImportDisposition).toBe('IMPORT_ENDORSEMENT');
  });

  // ADR-0056 regression: when a policy's earliest held row is a transaction
  // line (PAM/ADJ/CAN/NTU) — because the NB/RNL term row lives in a file we do
  // not hold — it must NOT be marked IMPORT_POLICY. Doing so materialised
  // bordereau adjustment lines as standalone production policies.
  it('never marks a transaction line as the policy-creating row', async () => {
    const pamOnlyRow = {
      Id: 'orphan-pam',
      Entry: 'PAM',
      Insured: 'Orphan Adjustment',
      Policy: 'ABLV5000001',
      Booked: '2025-03-01',
      Inception: '2025-01-01',
      Expiry: '2026-01-01',
      'Date Of Birth': '1980-01-01',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      'Premium Payable': 10,
      'Gross  Premium': 9.52,
      'MIF Payable': 0.48,
      'Stamp Payable': 0,
      'Comm.': 2.85,
      'Pay able to ARB': 6.67,
    };
    const evaluations = await evaluateBdxMigrationRows({
      rows: [pamOnlyRow],
      request: { sourceFilePath: 'ignored.xlsx', dryRun: true, productLine: 'motor' },
      program: { id: 'prog-1', metadata: {} },
    });
    expect(evaluations[0]?.dto.policyRef).toBe('ABLV5000001');
    expect(evaluations[0]?.policyImportDisposition).toBe('IMPORT_ENDORSEMENT');
  });

  it('evaluates rows deterministically via migration entrypoint', async () => {
    const rows = [
      {
        Id: 'x1',
        Entry: '',
        Insured: 'Test Person',
        Policy: '',
        Inception: '',
        Expiry: '',
        Cover: '',
      },
    ];
    const request = { sourceFilePath: 'ignored.xlsx', dryRun: true, productLine: 'motor' as const };
    const program = { id: 'prog-1', metadata: {} };
    await expect(evaluateBdxMigrationRows({ rows, request, program })).resolves.toEqual(
      await evaluateBdxMigrationRows({ rows, request, program })
    );
  });

  it('reads CSV as a single-tab BDX source with month and product metadata', async () => {
    const filePath = path.join(os.tmpdir(), `bdx-import-test-April-2026-${Date.now()}.csv`);
    await fs.writeFile(
      filePath,
      [
        'Certificate Ref,Risk, Transaction Type,Risk Inception Date,Risk Expiry Date,Insured First Name,Insured Full Name, Last Name or Company Name,Total gross written premium,Coverholder commission amount for whole risk/written premium,Total taxes payable locally,Net written Premium to London in original currency,Level of Cover,Area of Cover,Travellers,Type of Cover,Number of Days,Traveller 1 DOB',
        'BRIT/ABG/CSV001,NB,2026-04-01,2027-04-01,Ada,Traveller,100,30,5,70,Silver,Worldwide,Individual,Multi Trip,31,1980-01-01',
      ].join('\n'),
    );
    try {
      const rows = await readTabularRows({
        filePath,
        fileType: 'csv',
        productLine: 'travel',
        tenantSite: 'abbeygate-pt.facio.io',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.__sheetName).toBe('CSV');
      expect(rows[0]?.__sourceMonth).toBe('2026-04');
      expect(rows[0]?.__productLine).toBe('travel');
      expect(rows[0]?.__tenantSite).toBe('abbeygate-pt.facio.io');
    } finally {
      await fs.unlink(filePath).catch(() => undefined);
    }
  });

  it('filters multi-country XLSX workbooks to the requested tenant sheet', async () => {
    const rows = filterRowsForTenantSheet([
      { __sheetName: 'Portugal', Policy: 'PT-1' },
      { __sheetName: 'Cyprus', Policy: 'CY-1' },
      { __sheetName: 'Spain', Policy: 'ES-1' },
    ], 'abbeygate-pt.facio.io');
    expect(rows).toEqual([{ __sheetName: 'Portugal', Policy: 'PT-1' }]);
  });

  it('maps Lloyds v5.2 travel rows into product quote data', () => {
    const dto = mapRawRowToDto({
      __productLine: 'travel',
      __sourceMonth: '2026-04',
      'Class of Business': 'TRAVEL',
      'Certificate Ref': 'BRIT/ABG/0001',
      'Policy or Group Ref': 'DIRECT/BRIT/ABG/0001',
      'Risk, Transaction Type': 'NB',
      'Risk Inception Date': '2026-04-01',
      'Risk Expiry Date': '2027-04-01',
      'Effective Date of Transaction': '2026-03-25',
      'Insured First Name': 'Ada',
      'Insured Full Name, Last Name or Company Name': 'Traveller',
      'Insured Country (see code list)': 'Portugal',
      'Total gross written premium': 120,
      'Coverholder commission amount for whole risk/written premium': 36,
      'Total taxes payable locally': 6,
      'Net written Premium to London in original currency': 84,
      'Level of Cover': 'Gold',
      'Area of Cover': 'WorldwideInc',
      Travellers: 'Couple',
      'Type of Cover': 'Multi Trip',
      'Number of Days': 31,
      'Traveller 1 DOB': '1980-01-01',
    }, 6);
    expect(dto.productType).toBe('TRAVEL');
    expect(dto.productLine).toBe('travel');
    // policyRef must be the per-certificate ref, NOT the group ref —
    // see the travel-policyRef regression test below for the why.
    expect(dto.policyRef).toBe('BRIT/ABG/0001');
    expect(dto.sourceId).toBe('BRIT/ABG/0001');
    expect(dto.productData?.quote).toMatchObject({ selectedPlan: 'gold' });
    expect(dto.productData?.trip).toMatchObject({ planType: 'annual_multi_trip' });
  });

  it('marks historical Britt Travel BDX eligibility assertions for import reconstruction', () => {
    const dto = mapRawRowToDto({
      __productLine: 'travel',
      __sheetName: 'Sheet1',
      'Class of Business': 'TRAVEL',
      'Certificate Ref': 'BRIT/ABG/00002017',
      'Risk, Transaction Type': 'NB',
      'Risk Inception Date': '2025-06-21',
      'Risk Expiry Date': '2026-06-21',
      'Insured First Name': 'Teresa',
      'Insured Full Name, Last Name or Company Name': 'Cotton',
      'Insured Country (see code list)': 'Cyprus',
      'Total gross written premium': 182.29,
      'Coverholder commission amount for whole risk/written premium': 42.84,
      'Total taxes payable locally': 2,
      'Net written Premium to London in original currency': 137.45,
      'Level of Cover': 'Platinum',
      'Type of Cover': 'Multi Trip',
      'Number of Days': 31,
      'Traveller 1 DOB': '1957-03-23',
      'Traveller 2 Name': 'Roger Cotton',
      'Traveller 2 DOB': '1950-08-25',
      'Traveller 2 NIE': '129084162',
      Travellers: 'Couple',
    }, 2);
    expect(dto.productData?.bdxImportAssertions).toMatchObject({
      profile: 'BDX_HISTORICAL_TRAVEL_LLOYDS_V52_BRITT_2025_2026',
    });
    expect(dto.productData?.eligibility).toMatchObject({
      countryOfResidence: 'Republic of Cyprus',
      nationality: 'United Kingdom',
      hasOtherNationality: false,
      residenceDuration: 'gt_3_years',
      willRemainResident: true,
      residencyStatus: 'permanent_resident',
      legallyPermittedToReside: true,
      informationAccurate: true,
    });
    expect(dto.productData?.travellers).toMatchObject({
      coverType: 'couple',
      travellerCount: 2,
      additionalTravellerDOBs: ['1950-08-25'],
      additionalTravellers: [
        {
          firstName: 'Roger',
          lastName: 'Cotton',
          idType: 'id_card',
          idNumber: '129084162',
        },
      ],
    });
  });

  it('maps Lloyds v5.2 home rows into product quote data', () => {
    const dto = mapRawRowToDto({
      __productLine: 'home',
      __sheetName: 'Cyprus',
      'Class of Business': 'PROPERTY',
      'Certificate Ref': 'BZ/ABG/0001',
      'Risk, Transaction Type': 'NB',
      'Risk Start Date': '2026-04-01',
      'Risk End Date & Transaction End Date': '2027-04-01',
      'Date Issue of Schedule': '2026-03-25',
      'Insured First Name': 'Ada',
      'Insured Full Name, Last Name or Company Name': 'Home',
      'Insured Country (see code list)': 'Cyprus',
      'Risk Gross Total Premium (ex Ipt)': 200,
      'Total Commission': 50,
      IPT: 10,
      'Risk Net Total Premium (ex Ipt)': 150,
      'Total Gross Premium including IPT': 210,
      'Property Type': 'Villa',
      'Buildings Sum Insured': 100000,
      'Contents Sum Insured': 25000,
      'No Of Beds': 3,
    }, 4);
    expect(dto.productType).toBe('HOME');
    expect(dto.productLine).toBe('home');
    expect(dto.productData?.property).toMatchObject({ propertyType: 'Villa' });
    expect(dto.productData?.coverage).toMatchObject({ buildings: 100000, contents: 25000 });
  });

  it('maps Beazley shifted home BDX sums insured into canonical coverage', () => {
    const dto = mapRawRowToDto({
      __productLine: 'home',
      __sheetName: 'Sheet1',
      'Class of Business': 'PROPERTY',
      'Certificate Ref': 'BZ/ABG/00005857S',
      'Risk, Transaction Type': 'NB',
      'Risk Inception Date': '2025-06-20',
      'Risk Expiry Date': '2026-06-19',
      'Insured First Name': 'John',
      'Insured Full Name, Last Name or Company Name': 'Waters',
      'Insured Country (see code list)': 'Portugal',
      'Risk Gross Total Premium (ex Ipt)': 106,
      'Coverholder commission amount for whole risk/written premium': 24.91,
      'Total taxes payable locally': 13.67,
      'Net written Premium to London in original currency': 81.09,
      'Total Gross Premium including IPT': 119.67,
      'Interested Party Name': 'Static Caravan',
      'No Of Beds': '1990 or Later',
      'Flat Roof': 2,
      'Buildings Sum Insured': 'N',
      'Buildings Gross Premium (ex IPT)': 0,
      'Contents Gross Premium (ex IPT)': '15,000.00',
      'Solar Gross Premium (ex ipt)': 0,
    }, 2);
    expect(dto.productData?.bdxImportAssertions).toMatchObject({
      profile: 'BDX_HISTORICAL_HOME_LLOYDS_V52_BEAZLEY_2025_2026',
    });
    expect(dto.productData?.property).toMatchObject({
      propertyType: 'Static Caravan',
      bedrooms: 2,
      yearBuilt: '1990 or Later',
      landAreaSqm: 0,
      urbanArea: true,
    });
    expect(dto.productData?.coverage).toMatchObject({ buildings: 0, contents: 15000 });
  });

  it('defaults Home/Travel BDX phone values for canonical validation', () => {
    const homeConfig = resolveJurisdictionProductConfig({ productCode: 'HOME', source: { countryCode: 'CY' } });
    const travelConfig = resolveJurisdictionProductConfig({ productCode: 'TRAVEL', source: { countryCode: 'CY' } });
    const homeDto = mapRawRowToDto({
      __productLine: 'home',
      'Class of Business': 'PROPERTY',
      'Certificate Ref': 'BZ/ABG/PHONE',
      'Risk, Transaction Type': 'NB',
      'Risk Start Date': '2026-04-01',
      'Risk End Date & Transaction End Date': '2027-04-01',
      'Insured First Name': 'Phone',
      'Insured Full Name, Last Name or Company Name': 'Home',
      'Total gross written premium': 100,
      'Coverholder commission amount for whole risk/written premium': 25,
      'Total taxes payable locally': 2,
      'Net written Premium to London in original currency': 75,
      'Property Type': 'apartment1st',
      'Buildings Sum Insured': 100000,
    }, 2, homeConfig);
    const travelDto = mapRawRowToDto({
      __productLine: 'travel',
      'Class of Business': 'TRAVEL',
      'Certificate Ref': 'BRIT/ABG/PHONE',
      'Risk, Transaction Type': 'NB',
      'Risk Inception Date From Date': '2026-04-01',
      'Risk Expiry Date To Date': '2027-04-01',
      'Insured First Name': 'Phone',
      'Insured Full Name, Last Name or Company Name': 'Travel',
      'Total gross written premium': 100,
      'Coverholder commission amount for whole risk/written premium': 25,
      'Total taxes payable locally': 2,
      'Net written Premium to London in original currency': 75,
      'Traveller 1 DOB': '1980-01-01',
    }, 2, travelConfig);
    expect(homeDto.productData?.proposer).toMatchObject({ phone: '+35722000000' });
    expect(homeDto.productData?.property).toMatchObject({ propertyType: 'Apartment' });
    expect(travelDto.inceptionDate).toBe('2026-04-01');
    expect(travelDto.expiryDate).toBe('2027-04-01');
    expect(travelDto.productData?.proposer).toMatchObject({ phone: '+35722000000' });
  });

  it('maps Portugal motor premium aliases into the canonical motor DTO', () => {
    const dto = mapRawRowToDto(motorRow({
      'Tax Identification Number': 298820226,
      Entry: 'NB',
      Insured: 'Portugal Driver',
      Policy: 'ABLV/PT1000058',
      Booked: '24/03/2026',
      Inception: '28/05/2025',
      Expiry: '28/05/2026',
      'Date Of Birth': '1970-07-02',
      Make: 'PORSCHE',
      Model: 'CAYENNE 3.0 D',
      'Engine Size': 2967,
      'Vehicle Value': 26000,
      Year: 2010,
      Registration: '89LB54',
      Cover: 'Comp',
      Excess: 500,
      Drivers: 'Any Driver Over 25',
      Use: 'SDP',
      Premium: 97,
      'Net Premium': 85.92,
      'Tax Value': 11.08,
      Comm: 25.77,
      'Due to ARB': 71.22,
    }), 2);
    expect(dto.sourceId).toBe('298820226');
    expect(dto.premiumPayable).toBe(97);
    expect(dto.grossPremium).toBe(85.92);
    expect(dto.mifPayable).toBe(11.08);
    expect(dto.commission).toBe(25.77);
    expect(dto.payableToArb).toBe(71.22);
  });

  it('maps July Volante motor Commission and Payable to ARB headers into the canonical motor DTO', () => {
    const dto = mapRawRowToDto(motorRow({
      'NIE/Passport': 'fixed-july-1',
      'Entry Type': 'NB',
      Insured: 'July Driver',
      'Policy Number': 'ABLV/JULY0001',
      'Booked Date': '01/07/2026',
      'Inception Date': '01/07/2026',
      'Expiry Date': '01/07/2027',
      'Date Of Birth': '1980-01-01',
      Make: 'FORD',
      Model: 'FOCUS',
      'Engine Size': 1600,
      'Vehicle Value': 10000,
      Year: 2018,
      Registration: 'JULY001',
      Cover: 'Comp',
      Excess: 200,
      Drivers: 'Policy Holder',
      Use: 'SDP',
      Premium: 332,
      'Net Premium': 321,
      Mif: 9,
      Stamp: 2,
      Commission: 96.3,
      'Payable to ARB': 235.7,
    }), 2);
    expect(dto.sourceId).toBe('fixed-july-1');
    expect(dto.policyRef).toBe('ABLV/JULY0001');
    expect(dto.entry).toBe('NB');
    expect(dto.premiumPayable).toBe(332);
    expect(dto.grossPremium).toBe(321);
    expect(dto.declared.tax).toBe(11);
    expect(dto.commission).toBe(96.3);
    expect(dto.payableToArb).toBe(235.7);
  });

  it('maps Portugal July Volante Green Card Fee into declared reconciliation fees', () => {
    const dto = mapRawRowToDto(motorRow({
      Id: 'pt-fixed-july-1',
      'Entry Type': 'RNL',
      Insured: 'Portugal Driver',
      'Policy Number': 'ABLV/PT1000677',
      'Booked Date': '08/07/2026',
      'Inception Date': '08/07/2026',
      'Expiry Date': '08/07/2027',
      'Date Of Birth': '1962-09-26',
      Make: 'MERCEDES',
      Model: 'GLC (253) 300 4MATIC',
      'Engine Size': 1991,
      'Vehicle Value': 71430,
      Year: 2024,
      Registration: 'BL63VV',
      Cover: 'Comp',
      Excess: '1,000.00',
      Drivers: 'Named Drivers Only',
      Use: 'SDP',
      Premium: '1,417.00',
      'Net Premium': '1,254.51',
      'Tax Value': 161.74,
      'Green Card Fee': 0.75,
      Commission: 376.35,
      'Payable to ARB': 1040.65,
    }), 2);
    expect(dto.sourceId).toBe('pt-fixed-july-1');
    expect(dto.policyRef).toBe('ABLV/PT1000677');
    expect(dto.entry).toBe('RNL');
    expect(dto.premiumPayable).toBe(1417);
    expect(dto.grossPremium).toBe(1254.51);
    expect(dto.declared.tax).toBe(161.74);
    expect(dto.declared.fees).toBe(0.75);
    expect(dto.commission).toBe(376.35);
    expect(dto.payableToArb).toBe(1040.65);
  });

});
