import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  ProductConfigurationError,
  getTravelLegalContacts,
  resolveJurisdictionProductConfig,
} from '../productConfiguration.js';
import { calculateMotorTaxes } from '../../../../products/motor/pricing/motorTaxes.js';
import { readTabularRows } from '../../../reporting/infra/readTabularRows.js';
import { logger } from '../../../../platform/utils/logger.js';

describe('jurisdiction product configuration', () => {
  it('resolves PT Motor as a product/binder/country-specific config', () => {
    const config = resolveJurisdictionProductConfig({
      productCode: 'MOTOR',
      program: { id: 'program-pt-motor', productType: 'MOTOR', metadata: { countryCode: 'PT' } },
      binder: { id: 'binder-volante', config: {} },
      tenant: { countryCode: 'CY', country: 'Cyprus' },
    });

    expect(config.countryCode).toBe('PT');
    expect(config.productCode).toBe('MOTOR');
    expect(config.programId).toBe('program-pt-motor');
    expect(config.binderId).toBe('binder-volante');
    expect(config.taxRegime.profileCode).toBe('PT_MOTOR_VOLANTE_BDX_12_9_CONVERGENCE');
  });

  it('throws instead of inventing a fallback country', () => {
    expect(() => resolveJurisdictionProductConfig({
      productCode: 'MOTOR',
      program: { productType: 'MOTOR', metadata: {} },
      binder: { config: {} },
    })).toThrow(ProductConfigurationError);
  });

  it('marks PT Home as the explicit temporary tax profile and Travel under the BRIT BAA 2026 profile', () => {
    const home = resolveJurisdictionProductConfig({ productCode: 'HOME', source: { countryCode: 'PT' } });
    // Travel resolution under the new BAA expansion (ADR-0024) accepts a
    // customer-declared override; passing tenant alone still resolves to
    // the tenant country (PT here) and the new profile code.
    const travel = resolveJurisdictionProductConfig({ productCode: 'TRAVEL', source: { countryCode: 'PT' } });

    expect(home.taxRegime.profileCode).toBe('PT_HOME_TENANT_IPT_TEMPORARY');
    expect(travel.taxRegime.profileCode).toBe('PT_TRAVEL_BRIT_BAA_2026');
  });
});

describe('Travel customer-residence override (ADR-0024)', () => {
  it('uses customerCountryOfResidence to resolve TRAVEL country, ignoring tenant', () => {
    const config = resolveJurisdictionProductConfig({
      productCode: 'TRAVEL',
      tenant: { countryCode: 'CY', country: 'Cyprus', tenantSlug: 'abbeygate-cy' },
      customerCountryOfResidence: 'Italy',
    });

    expect(config.countryCode).toBe('IT');
    expect(config.taxRegime.profileCode).toBe('IT_TRAVEL_BRIT_BAA_2026');
    // EU standard wording + CEGA assistance per ADR-0024 Travel preset.
    expect(config.documentConfig.wordingReference).toBe('EU Standard Wording 2026');
    expect(config.documentConfig.assistanceProvider).toBe('CEGA / Charles Taylor Assistance');
  });

  it('falls back to tenant when customerCountryOfResidence is not provided', () => {
    const config = resolveJurisdictionProductConfig({
      productCode: 'TRAVEL',
      tenant: { countryCode: 'PT', country: 'Portugal' },
    });

    expect(config.countryCode).toBe('PT');
    expect(config.taxRegime.profileCode).toBe('PT_TRAVEL_BRIT_BAA_2026');
  });

  it('throws when customerCountryOfResidence is passed for non-Travel products', () => {
    expect(() => resolveJurisdictionProductConfig({
      productCode: 'MOTOR',
      tenant: { countryCode: 'CY' },
      customerCountryOfResidence: 'Italy',
    })).toThrow(/TRAVEL-only/i);

    expect(() => resolveJurisdictionProductConfig({
      productCode: 'HOME',
      tenant: { countryCode: 'CY' },
      customerCountryOfResidence: 'Italy',
    })).toThrow(/TRAVEL-only/i);
  });

  it('rejects an off-list customer residence with ProductConfigurationError', () => {
    expect(() => resolveJurisdictionProductConfig({
      productCode: 'TRAVEL',
      tenant: { countryCode: 'CY' },
      customerCountryOfResidence: 'Switzerland',
    })).toThrow(ProductConfigurationError);
  });

  it('resolves all 9 BRIT-authorised Travel countries to BRIT_BAA_2026 profile codes', () => {
    const expected: Record<string, string> = {
      Cyprus: 'CY_TRAVEL_BRIT_BAA_2026',
      Portugal: 'PT_TRAVEL_BRIT_BAA_2026',
      Greece: 'GR_TRAVEL_BRIT_BAA_2026',
      Spain: 'ES_TRAVEL_BRIT_BAA_2026',
      Belgium: 'BE_TRAVEL_BRIT_BAA_2026',
      Netherlands: 'NL_TRAVEL_BRIT_BAA_2026',
      Italy: 'IT_TRAVEL_BRIT_BAA_2026',
      France: 'FR_TRAVEL_BRIT_BAA_2026',
      Malta: 'MT_TRAVEL_BRIT_BAA_2026',
    };
    for (const [country, profile] of Object.entries(expected)) {
      const config = resolveJurisdictionProductConfig({
        productCode: 'TRAVEL',
        tenant: { countryCode: 'CY' },
        customerCountryOfResidence: country,
      });
      expect(config.taxRegime.profileCode, country).toBe(profile);
    }
  });

  it.each([
    // V3 schedules (Andy 2026-05-16).
    ['Republic of Cyprus', 'CY', 'CYPRUS', 'LBS0006A', 'LBS0038A'],
    ['Portugal', 'PT', 'PORTUGAL', 'LBS0081', 'LBS0064'],
    ['Spain', 'ES', 'SPAIN', 'LBS0081', 'LBS0034A'],
    // Six BRIT-authorised countries added 2026-05-19 from Peter
    // Sheppard's email (ABY-255). All use the same standard EU
    // travel wording reference (LBS0081 01/12/2019 V1124); only the
    // country-specific cover-page and schedule data vary.
    ['Greece', 'GR', 'GREECE', 'LBS0081', 'LBS0081'],
    ['Belgium', 'BE', 'BELGIUM', 'LBS0081', 'LBS0081'],
    ['Netherlands', 'NL', 'NETHERLANDS', 'LBS0081', 'LBS0081'],
    ['Italy', 'IT', 'ITALY', 'LBS0081', 'LBS0081'],
    ['France', 'FR', 'FRANCE', 'LBS0081', 'LBS0081'],
    ['Malta', 'MT', 'MALTA', 'LBS0081', 'LBS0081'],
  ])('exposes Travel legal contacts for %s with the correct Lloyd\'s reference codes', (country, _code, jurisdiction, sosRef, complaintsRef) => {
    const config = resolveJurisdictionProductConfig({
      productCode: 'TRAVEL',
      tenant: { countryCode: 'CY' },
      customerCountryOfResidence: country,
    });
    const legal = getTravelLegalContacts(config);
    expect(legal.jurisdiction).toBe(jurisdiction);
    expect(legal.serviceOfSuit.referenceCode).toBe(sosRef);
    expect(legal.serviceOfSuit.recipients.length).toBeGreaterThanOrEqual(1);
    expect(legal.complaints.referenceCode).toBe(complaintsRef);
    // Italy's complaints procedure (3 paragraphs) is the shortest;
    // every other country has 3+ paragraphs too. Locking ≥ 3 so a
    // future "shortened" schedule can't ship without an ADR.
    expect(legal.complaints.procedureParagraphs.length).toBeGreaterThanOrEqual(3);
    expect(legal.complaints.ombudsmanName).toBeTruthy();
  });

  // The previous `throws MissingTravelLegalContactsError` test was
  // removed on 2026-05-19: every country supported by
  // `JURISDICTION_TRAVEL_DOCUMENT_PRESETS` now has a corresponding
  // entry in `TRAVEL_LEGAL_CONTACTS`, so the error path is no longer
  // reachable from a real customer flow. `MissingTravelLegalContactsError`
  // is intentionally kept in `productConfiguration.ts` as the failure
  // mode for any future country added to the document presets without
  // its legal contacts; the next country added must come paired with
  // a `TRAVEL_LEGAL_CONTACTS` entry, or this guard will fail-loud at
  // issuance time.

  it('throws when getTravelLegalContacts is called for a non-Travel product', () => {
    const motor = resolveJurisdictionProductConfig({ productCode: 'MOTOR', source: { countryCode: 'CY' } });
    expect(() => getTravelLegalContacts(motor)).toThrow(/non-Travel product/);
  });

  it('attaches per-country local Charles Taylor assistance numbers to Travel configs', () => {
    const italy = resolveJurisdictionProductConfig({
      productCode: 'TRAVEL',
      tenant: { countryCode: 'CY' },
      customerCountryOfResidence: 'Italy',
    });
    expect(italy.documentConfig.assistanceLocalNumbers).toEqual([
      { city: 'Genoa', phone: '+39 010 6469694' },
      { city: 'Milan / Rome', phone: '+39 06 9480 6000' },
    ]);

    // Cyprus / Portugal / Malta have no dedicated local CEGA number per
    // Peter 2026-05-16 — the central CEGA medical line is the only
    // assistance contact, and `assistanceLocalNumbers` is undefined.
    const cyprus = resolveJurisdictionProductConfig({
      productCode: 'TRAVEL',
      tenant: { countryCode: 'CY' },
      customerCountryOfResidence: 'Republic of Cyprus',
    });
    expect(cyprus.documentConfig.assistanceLocalNumbers).toBeUndefined();
  });
});

describe('motor tax profiles', () => {
  it.each(['CY', 'PT', 'ES'])('uses the approved AB/S/1/2026 Motor wording reference for %s', (countryCode) => {
    const config = resolveJurisdictionProductConfig({ productCode: 'MOTOR', source: { countryCode } });
    expect(config.documentConfig.wordingReference).toBe('AB/S/1/2026');
  });

  it.each([
    ['CY', 'Volante /CY/Abbeygate/05.2024'],
    ['PT', 'Volante /PT/Abbeygate/2026'],
    ['ES', 'Volante /ES/Abbeygate/2026'],
  ])('does not leak the Motor wording reference into %s Home configuration', (countryCode, wordingReference) => {
    const config = resolveJurisdictionProductConfig({ productCode: 'HOME', source: { countryCode } });
    expect(config.documentConfig.wordingReference).toBe(wordingReference);
  });

  it.each(['BUSINESS', 'OPEN_MARKET'])('does not leak the Motor wording reference into CY %s configuration', (productCode) => {
    const config = resolveJurisdictionProductConfig({ productCode, source: { countryCode: 'CY' } });
    expect(config.documentConfig.wordingReference).toBe('Volante /CY/Abbeygate/05.2024');
  });

  it('calculates PT Volante BDX convergence rows with explicit rounding metadata', () => {
    const config = resolveJurisdictionProductConfig({ productCode: 'MOTOR', source: { countryCode: 'PT' } });
    const result = calculateMotorTaxes({
      config,
      grossPremium: 112.9 + 0.75,
      entryType: 'NB',
      termMonths: 12,
      inceptionDate: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(result.profileCode).toBe('PT_MOTOR_VOLANTE_BDX_12_9_CONVERGENCE');
    expect(result.rows.find((row) => row.code === 'NET_PREMIUM')?.amount).toBe(100);
    expect(result.rows.find((row) => row.code === 'TOTAL_TAX_VALUE')?.amount).toBe(12.9);
    expect(result.rows.find((row) => row.code === 'STAMP_DUTY')?.amount).toBe(9);
    expect(result.rows.find((row) => row.code === 'FGA_TPO')?.amount).toBe(0.43);
    expect(result.rows.find((row) => row.code === 'INEM')?.amount).toBe(2.5);
    expect(result.rows.find((row) => row.code === 'FGA')?.amount).toBe(0.98);
    expect(result.rows.find((row) => row.code === 'GREEN_CARD_FEE')?.amount).toBe(0.75);
    expect(result.rows.every((row) => row.rounding?.mode === 'EXCEL_COMPAT')).toBe(true);
  });

  it('keeps current CY motor tax profile stable', () => {
    const config = resolveJurisdictionProductConfig({ productCode: 'MOTOR', source: { countryCode: 'CY' } });
    const result = calculateMotorTaxes({
      config,
      grossPremium: 100,
      netPremium: 100,
      termMonths: 12,
      inceptionDate: new Date('2025-12-01T00:00:00.000Z'),
    });

    expect(result.profileCode).toBe('CY_MOTOR_ABBEYGATE_CURRENT');
    expect(result.legacy.mifSurcharge).toBe(9);
    expect(result.legacy.stampDuty).toBe(2);
  });
});

describe('PT Motor golden BDX reconciliation', () => {
  const workbookPath = path.resolve(
    process.cwd(),
    'artifacts/BDX-import-april-26/Motor/motor-pt/BDX Volante Portugal Mar 2026.xlsx'
  );

  type GoldenRow = Record<string, unknown>;

  function n(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function component(result: ReturnType<typeof calculateMotorTaxes>, code: string): number {
    return Number(result.rows.find((row) => row.code === code)?.amount || 0);
  }

  function rowEntry(row: GoldenRow): string {
    return String(row.Entry || '').trim().toUpperCase();
  }

  function hasPremium(row: GoldenRow): boolean {
    return Math.abs(n(row.Premium)) > 0;
  }

  function selectRows(rows: GoldenRow[]): GoldenRow[] {
    const byEntry = (entries: string[], limit: number) => rows
      .filter((row) => entries.includes(rowEntry(row)) && hasPremium(row))
      .slice(0, limit);
    const nonZero = rows.filter(hasPremium);
    const small = nonZero
      .slice()
      .sort((a, b) => Math.abs(n(a.Premium)) - Math.abs(n(b.Premium)))
      .slice(0, 4);
    const large = nonZero
      .slice()
      .sort((a, b) => Math.abs(n(b.Premium)) - Math.abs(n(a.Premium)))
      .filter((row) => rowEntry(row))
      .slice(0, 4);

    const selected = [
      ...byEntry(['NB'], 10),
      ...byEntry(['RNL'], 10),
      ...byEntry(['ADJ', 'NB/COC', 'PAM'], 10),
      ...byEntry(['CAN', 'NTU'], 10),
      ...small,
      ...large,
    ];

    const seen = new Set<string>();
    return selected.filter((row) => {
      const key = `${row.__sheetRowNumber}:${row.Policy}:${row.Entry}:${row.Premium}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 40);
  }

  it('reconciles stratified real Portugal BDX tax rows to the PT workbook method', async () => {
    if (!existsSync(workbookPath)) {
      logger.warn({ workbookPath }, 'Skipping PT golden BDX reconciliation; workbook fixture is not present.');
      return;
    }

    const rows = await readTabularRows({
      filePath: workbookPath,
      fileType: 'xlsx',
      productLine: 'motor',
      tenantSite: 'abbeygate-pt.facio.io',
    });
    const selected = selectRows(rows);
    expect(selected.length).toBeGreaterThanOrEqual(30);
    expect(selected.some((row) => rowEntry(row) === 'NB')).toBe(true);
    expect(selected.some((row) => rowEntry(row) === 'RNL')).toBe(true);
    expect(selected.some((row) => ['ADJ', 'NB/COC', 'PAM'].includes(rowEntry(row)))).toBe(true);
    expect(selected.some((row) => ['CAN', 'NTU'].includes(rowEntry(row)))).toBe(true);

    const config = resolveJurisdictionProductConfig({ productCode: 'MOTOR', source: { countryCode: 'PT' } });
    const componentCodes = [
      ['NET_PREMIUM', 'Net Premium'],
      ['TOTAL_TAX_VALUE', 'Tax Value'],
      ['STAMP_DUTY', 'Stamp Duty'],
      ['FGA_TPO', 'Fga (TPO)'],
      ['FGA', 'Fga'],
      ['INEM', 'INEM'],
      ['GREEN_CARD_FEE', 'Green Card Fee'],
    ] as const;
    const maxDeltaByCode = new Map<string, number>();
    const aggregate = new Map<string, { system: number; excel: number }>();
    let exactMatches = 0;
    let withinRounding = 0;
    let softToleranceRows = 0;
    const outliers: Array<{ row: unknown; policy: unknown; entry: string; code: string; delta: number }> = [];

    for (const row of selected) {
      const result = calculateMotorTaxes({
        config,
        grossPremium: n(row.Premium),
        entryType: rowEntry(row),
        termMonths: 12,
        inceptionDate: new Date(String(row.Inception || '2026-03-01')),
      });

      const excelGross = round2(n(row.Premium));
      const excelNet = round2(n(row['Net Premium']));
      const excelTax = round2(n(row['Tax Value']));
      const excelGreenCard = round2(n(row['Green Card Fee']));
      const excelStamp = round2(n(row['Stamp Duty']));
      const excelFgaTpo = round2(n(row['Fga (TPO)']));
      const excelFga = round2(n(row.Fga));
      const excelInem = round2(n(row.INEM));

      expect(round2(Math.abs(excelTax - round2(excelStamp + excelFga + excelFgaTpo + excelInem)))).toBeLessThanOrEqual(0.01);
      expect(round2(Math.abs(excelGross - round2(excelNet + excelTax + excelGreenCard)))).toBeLessThanOrEqual(0.01);
      if (Math.abs(excelNet) > 0.01) {
        expect(round2(Math.abs(excelTax - round2(excelNet * 0.129)))).toBeLessThanOrEqual(0.01);
      }

      for (const [code, excelColumn] of componentCodes) {
        const systemValue = component(result, code);
        const excelValue = round2(n(row[excelColumn]));
        const delta = round2(systemValue - excelValue);
        const absDelta = Math.abs(delta);
        maxDeltaByCode.set(code, Math.max(maxDeltaByCode.get(code) || 0, absDelta));
        const agg = aggregate.get(code) || { system: 0, excel: 0 };
        agg.system += systemValue;
        agg.excel += excelValue;
        aggregate.set(code, agg);
        if (absDelta === 0) exactMatches += 1;
        else if (absDelta <= 0.01) withinRounding += 1;
        else if (absDelta <= 0.05) softToleranceRows += 1;
        else outliers.push({ row: row.__sheetRowNumber, policy: row.Policy, entry: rowEntry(row), code, delta });
      }
    }

    const report = {
      fixtureFile: workbookPath,
      sheetNames: [...new Set(selected.map((row) => String(row.__sheetName || '')))].filter(Boolean),
      rowsSelected: selected.map((row) => ({
        sheet: row.__sheetName,
        row: row.__sheetRowNumber,
        policy: row.Policy,
        entry: rowEntry(row),
        premium: round2(n(row.Premium)),
      })),
      entryTypesCovered: [...new Set(selected.map(rowEntry))].sort(),
      rowsTested: selected.length,
      exactMatches,
      withinRounding,
      softToleranceRows,
      outlierRowReferences: outliers,
      maxDeltaByComponent: Object.fromEntries(maxDeltaByCode),
      aggregateDeltaByComponent: Object.fromEntries([...aggregate.entries()].map(([code, totals]) => [
        code,
        round2(totals.system - totals.excel),
      ])),
    };

    logger.info({ report }, 'PT Motor golden BDX reconciliation');

    expect(report.outlierRowReferences, JSON.stringify(report, null, 2)).toEqual([]);
    for (const delta of Object.values(report.aggregateDeltaByComponent)) {
      expect(Math.abs(delta), JSON.stringify(report, null, 2)).toBeLessThanOrEqual(selected.length * 0.01);
    }
  });
});
