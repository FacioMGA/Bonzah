import { describe, it, expect } from 'vitest';
import type { BdxRawRow, BdxRowDto } from '../types.js';
import { mapRawRowToDto } from '../mapper.js';
import { runCompletenessValidation } from '../validator.js';
import { registerAllProducts } from '../../../../../products/registerProducts.js';

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

// This file holds pure-mapper regression tests — fixtures that exercise
// `mapRawRowToDto` and the synchronous validators without spinning up a
// tenant ALS context. The companion `bdxImport.service.test.ts` covers the
// evaluator path that hits `getTenantConfig()` and therefore requires
// `runWithOperatingTenant`. Splitting keeps the evaluator file under
// the `max-lines` cap (800) without weakening the regression coverage.
describe('bdx mapper regressions', () => {
  // Regression — see commit 824718b4 ("refactor(spine/v2): delete legacy/
  // back-compat paths"). That refactor stripped the AB→CV translation table
  // and the AB 171 classic-vehicle resolver on the assumption that the
  // operator's BDX spreadsheets would arrive with canonical codes. They do
  // not (every Cyprus motor BDX from Jan 2025 onward uses the `AB N`
  // dialect). The deletion silently produced ~10k "endorsement code not in
  // registry" warnings, and the chained replay engine then blocked every
  // downstream endorsement on those policies. The tests below pin the
  // restored behavior so it cannot be deleted again without a loud test
  // failure.
  it('normalizes BDX AB-dialect endorsement codes to canonical CV codes', () => {
    const dto = mapRawRowToDto(motorRow({
      Id: 'ab-alias-row',
      Entry: 'NB',
      Insured: 'Cyprus Driver',
      Policy: 'ABLV1099001',
      Inception: '2025-12-01',
      Expiry: '2026-12-01',
      'Date Of Birth': '1980-01-01',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      Make: 'TOYOTA',
      Model: 'COROLLA',
      'Engine Size': 1600,
      'Vehicle Value': 12000,
      Year: 2018,
      Registration: 'AB1234',
      Excess: 250,
      Endorsement: 'AB 4, AB 5, AB 7, AB 22, AB 23, AB 24, AB 46, ABG 001',
    }), 2);
    expect(dto.parsedEndorsements.sort()).toEqual([
      'ABG001', 'CV 22', 'CV 23', 'CV 24', 'CV 4', 'CV 46', 'CV 5', 'CV 7',
    ]);
  });

  it('splits Volante hyphen-delimited motor endorsement chains into canonical codes', () => {
    const dto = mapRawRowToDto(motorRow({
      'NIE/Passport': 'hyphen-chain-row',
      'Entry Type': 'RNL',
      Insured: 'Cyprus Driver',
      'Policy Number': 'ABLV1001768',
      'Booked Date': '01/07/2026',
      'Inception Date': '01/07/2026',
      'Expiry Date': '01/07/2027',
      'Date Of Birth': '1980-01-01',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      Make: 'TOYOTA',
      Model: 'COROLLA',
      'Engine Size': 1600,
      'Vehicle Value': 12000,
      Year: 2018,
      Registration: 'JULY001',
      Excess: 250,
      Endorsement: 'CV4-CV5-CV172-CV999-CV1028-CV1029-',
    }), 2);
    expect(dto.parsedEndorsements).toEqual([
      'CV 4', 'CV 5', 'CV 172', 'CV 999', 'CV 1028', 'CV 1029',
    ]);
  });

  it('drops AB 171 on a modern private car', () => {
    const dto = mapRawRowToDto(motorRow({
      Id: 'ab171-modern',
      Entry: 'NB',
      Insured: 'Modern Driver',
      Policy: 'ABLV2026100',
      Inception: '2025-12-01',
      Expiry: '2026-12-01',
      'Date Of Birth': '1988-01-01',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      Make: 'HONDA',
      Model: 'CR-V',
      'Engine Size': 1600,
      'Vehicle Value': 18000,
      Year: 2021,
      Registration: 'NEW171',
      Excess: 250,
      Endorsement: 'AB 171, AB 4',
    }), 2);
    expect(dto.parsedEndorsements).toEqual(['CV 4']);
  });

  it('maps AB 171 to ABG001 on a classic vehicle', () => {
    const dto = mapRawRowToDto(motorRow({
      Id: 'ab171-classic',
      Entry: 'NB',
      Insured: 'Classic Driver',
      Policy: 'ABLV1972001',
      Inception: '2025-12-01',
      Expiry: '2026-12-01',
      'Date Of Birth': '1960-01-01',
      Cover: 'Comp',
      Use: 'SDP',
      Drivers: 'Policy Holder',
      Make: 'MG',
      Model: 'B',
      'Engine Size': 1800,
      'Vehicle Value': 15000,
      Year: 1972,
      Registration: 'CLS001',
      Excess: 250,
      Endorsement: 'AB 171',
      Details: 'Classic',
    }), 2);
    expect(dto.parsedEndorsements).toContain('ABG001');
  });

  it('preserves ABG001 codes verbatim (no false-space insertion)', () => {
    const dto = mapRawRowToDto(motorRow({
      Id: 'abg001-row',
      Entry: 'NB',
      Insured: 'X',
      Policy: 'ABLV1099002',
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
      Registration: 'REG1',
      Excess: 200,
      Endorsement: 'abg001, ABG 001, CV 4',
    }), 2);
    expect(dto.parsedEndorsements).toContain('ABG001');
    expect(dto.parsedEndorsements).not.toContain('ABG 001');
    expect(dto.parsedEndorsements).toContain('CV 4');
  });

  it('maps July Volante Cyprus motor headers into the canonical motor DTO', () => {
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
    expect(dto).toMatchObject({
      sourceId: 'fixed-july-1',
      policyRef: 'ABLV/JULY0001',
      entry: 'NB',
      premiumPayable: 332,
      grossPremium: 321,
      commission: 96.3,
      payableToArb: 235.7,
    });
    expect(dto.declared.tax).toBe(11);
  });

  it('maps July Volante Portugal green-card fee into declared reconciliation fees', () => {
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
    expect(dto).toMatchObject({
      sourceId: 'pt-fixed-july-1',
      policyRef: 'ABLV/PT1000677',
      entry: 'RNL',
      premiumPayable: 1417,
      grossPremium: 1254.51,
      commission: 376.35,
      payableToArb: 1040.65,
    });
    expect(dto.declared).toMatchObject({ tax: 161.74, fees: 0.75 });
  });

  it('keeps the prior payable-to-ARB header spelling mapped', () => {
    const dto = mapRawRowToDto(motorRow({
      Id: 'prior-arb-1',
      Entry: 'NB',
      Insured: 'Prior Header',
      Policy: 'ABLV/PRIORARB',
      'Pay able to ARB': 202.3,
    }), 2);
    expect(dto.payableToArb).toBe(202.3);
    expect(dto.declared.net).toBe(202.3);
  });

  // Travel: each certificate is its own policy. The BDX "Policy or Group
  // Ref" column is operator-side metadata (e.g. corporate scheme covering
  // many travellers); it is intentionally shared across many rows. If
  // the mapper uses it as the policy identifier, the BDX commit step
  // hits `Unique constraint failed on (policyNumber, renewalSequence)`
  // for every row past the first in the scheme, because Policy has
  // `@@unique([policyNumber, renewalSequence])`. Pin: same Group Ref +
  // different Cert Refs MUST produce distinct policyRefs.
  it('travel rows in the same Group Ref produce distinct policyRefs per Cert Ref', () => {
    const baseRow: Record<string, unknown> = {
      __productLine: 'travel',
      'Class of Business': 'TRAVEL',
      'Policy or Group Ref': 'BRIT/ABG/SCHEME/CORPORATE-001',
      'Risk, Transaction Type': 'NB',
      'Risk Inception Date': '2026-04-01',
      'Risk Expiry Date': '2027-04-01',
      'Insured Country (see code list)': 'Portugal',
      'Total gross written premium': 100,
      'Level of Cover': 'Silver',
      'Type of Cover': 'Multi Trip',
      'Number of Days': 31,
    };
    const a = mapRawRowToDto({ ...baseRow, 'Certificate Ref': 'BRIT/ABG/0001', 'Insured First Name': 'Alice' }, 5);
    const b = mapRawRowToDto({ ...baseRow, 'Certificate Ref': 'BRIT/ABG/0002', 'Insured First Name': 'Bob' }, 6);
    const c = mapRawRowToDto({ ...baseRow, 'Certificate Ref': 'BRIT/ABG/0003', 'Insured First Name': 'Carol' }, 7);
    const refs = [a.policyRef, b.policyRef, c.policyRef];
    expect(new Set(refs).size).toBe(3);
    expect(refs).toEqual(['BRIT/ABG/0001', 'BRIT/ABG/0002', 'BRIT/ABG/0003']);
  });

  // ADR-0056 regression: home/travel mappers stamped ONE shared placeholder
  // email (`bdx-import@import.local`) on every imported row. Account
  // materialization dedupes policy holders by email, so all imported policies
  // collapsed onto the first holder carrying that address (~8,900 policies on
  // two names in production). Pin: the placeholder email is unique per
  // certificate ref, and the shared literal is gone.
  it('stamps a per-certificate placeholder email on home and travel rows', () => {
    const travelBase: BdxRawRow = {
      __productLine: 'travel',
      'Class of Business': 'TRAVEL',
      'Risk, Transaction Type': 'NB',
      'Risk Inception Date': '2026-04-01',
      'Risk Expiry Date': '2027-04-01',
      'Insured Country (see code list)': 'Portugal',
      'Total gross written premium': 100,
      'Level of Cover': 'Silver',
      'Type of Cover': 'Single Trip',
    };
    const travelA = mapRawRowToDto({ ...travelBase, 'Certificate Ref': 'BRIT/ABG/0001', 'Insured First Name': 'Alice' }, 5);
    const travelB = mapRawRowToDto({ ...travelBase, 'Certificate Ref': 'BRIT/ABG/0002', 'Insured First Name': 'Bob' }, 6);

    const homeBase: BdxRawRow = {
      __productLine: 'home',
      'Class of Business': 'HOME',
      'Risk, Transaction Type': 'NB',
      'Risk Start Date': '2026-04-01',
      'Risk End Date & Transaction End Date': '2027-04-01',
      'Insured Country (see code list)': 'Cyprus',
      'Total Gross Premium including IPT': 250,
    };
    const homeA = mapRawRowToDto({ ...homeBase, 'Certificate Ref': 'BZ/ABG/0001SS', 'Insured First Name': 'Carol' }, 7);
    const homeB = mapRawRowToDto({ ...homeBase, 'Certificate Ref': 'BZ/ABG/0002SS', 'Insured First Name': 'Dave' }, 8);

    const emailOf = (dto: BdxRowDto): string => {
      const proposer = (dto.productData?.proposer ?? {}) as { email?: string };
      return String(proposer.email || '');
    };

    const emails = [emailOf(travelA), emailOf(travelB), emailOf(homeA), emailOf(homeB)];
    expect(new Set(emails).size).toBe(4);
    for (const email of emails) {
      expect(email).toMatch(/^[a-z0-9]+@import\.local$/);
      expect(email).not.toBe('bdx-import@import.local');
    }
    expect(emailOf(travelA)).toBe('britabg0001@import.local');
    expect(emailOf(homeA)).toBe('bzabg0001ss@import.local');
  });

  // Travel: when Certificate Ref is missing, the mapper does NOT silently
  // fall back to Group Ref / Broker's Ref. Lloyds v5.2 BDX makes
  // Certificate Ref mandatory on every travel risk row; falling through
  // would re-introduce the unique-constraint storm at commit time (every
  // traveller in a corporate scheme would land on the same policyNumber
  // and collide on `@@unique([policyNumber, renewalSequence])`).
  // The mapper returns an empty policyRef so the validator surfaces the
  // problem to the operator. Pin both halves of that contract.
  // (Skill: `.cursor/skills/no-defensive-fallbacks/SKILL.md`.)
  it('travel rows without Certificate Ref produce an empty policyRef + Critical completeness gap', () => {
    const rowMissingCertRef: Record<string, unknown> = {
      __productLine: 'travel',
      'Policy or Group Ref': 'BRIT/ABG/SCHEME-001',
      "Broker's Ref Number": 'BR-001',
      'Risk, Transaction Type': 'NB',
      'Risk Inception Date': '2026-04-01',
      'Risk Expiry Date': '2027-04-01',
      'Type of Cover': 'Single Trip',
      'Insured First Name': 'Anne',
      'Insured Full Name, Last Name or Company Name': 'Onymous',
    };
    const dto = mapRawRowToDto(rowMissingCertRef, 8);
    // The mapper must not silently fill the required field. Group Ref
    // and Broker's Ref are present but neither is accepted as policyRef.
    expect(dto.policyRef).toBe('');
    const completenessGaps = runCompletenessValidation(dto)
      .filter((g) => g.severity === 'Critical');
    expect(completenessGaps.length).toBeGreaterThan(0);
    expect(completenessGaps.some((g) => g.category === 'COMPLETENESS' && /policyRef/.test(g.message))).toBe(true);
  });

  // Travel: maxTripDays must always be a positive integer. After commit
  // `f8be2652` the mapper still left maxTripDays undefined for some rows
  // whose 'Type of Cover' value did not contain the literal word 'multi'.
  // The canonical validator infers multi-trip from other signals too,
  // which made those rows fail. Pin: every travel row produces a
  // positive maxTripDays via explicit cell → inception/expiry span → 31.
  it('travel mapper always produces a positive maxTripDays', () => {
    const cases: Array<Record<string, unknown> & { expected?: number }> = [
      { 'Number of Days': 14, 'Type of Cover': 'Multi Trip', expected: 14 },
      { 'Number of Days': 7, 'Type of Cover': 'Single Trip', expected: 7 },
      { 'Type of Cover': 'Multi Trip', expected: 31 },
      { 'Type of Cover': 'Single Trip', 'Risk Trip Start Date': '2025-07-01', 'Risk Trip End Date': '2025-07-15', expected: 15 },
      { 'Type of Cover': 'Single Trip', expected: 31 },
    ];
    for (const c of cases) {
      const row: Record<string, unknown> = {
        __productLine: 'travel',
        'Certificate Ref': 'BRIT/TEST/001',
        'Insured First Name': 'John',
        'Insured Full Name, Last Name or Company Name': 'Doe',
        'Level of Cover': 'Gold',
        'Risk Trip Start Date': '2025-07-01',
        'Risk Trip End Date': '2025-07-31',
        ...c,
      };
      const dto = mapRawRowToDto(row, 2);
      const quote = (dto.productData as Record<string, unknown> | undefined)?.quote as Record<string, unknown> | undefined;
      expect(quote?.maxTripDays, `case ${JSON.stringify(c)} should yield positive maxTripDays`).toBeGreaterThan(0);
      if (c.expected !== undefined) {
        expect(quote?.maxTripDays).toBe(c.expected);
      }
    }
  });

  // Regression — CAN (cancellation) and PAM (premium adjustment) rows
  // legitimately ship with blank/0 premium columns because the operator's
  // workbook uses formulas that net to zero on a refund/adjustment line.
  // Pre-`spine/v2` Wave 5 these rows passed COMPLETENESS and the
  // orchestrator routed them through `replayEndorsementRow` to record a
  // RiskTransaction. After Wave 5 the validator demanded rating fields on
  // every row and ~990 such rows started failing as "incomplete". Restore
  // disposition-aware required-field validation: only base business
  // (NB / NB-COC / RNL) needs the rating fields.
  it('does not require rating fields on CAN/PAM/ADJ endorsement rows', () => {
    // Validate the rule at the synchronous DTO + completeness boundary so we
    // do not need to spin up a tenant ALS context just for one check.
    for (const entry of ['CAN', 'PAM', 'ADJ', 'FIVA-PAM', 'NTU']) {
      const dto = mapRawRowToDto(motorRow({
        Id: 'endo-row-' + entry,
        Entry: entry,
        Insured: 'Existing Customer',
        Policy: 'ABLV1099003',
        Inception: '2025-12-01',
        Expiry: '2026-12-01',
        // ALL rating fields legitimately blank — this is a mid-term row
        // against an already-bound policy.
      }), 2);
      const completeness = runCompletenessValidation(dto)
        .filter((g) => g.severity === 'Critical');
      expect(completeness, `entry=${entry} should not be flagged COMPLETENESS-critical for missing rating fields`).toEqual([]);
    }
  });
});
