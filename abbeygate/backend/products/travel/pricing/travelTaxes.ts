import type {
  JurisdictionProductConfig,
  TaxBreakdown,
} from '../../../modules/jurisdiction/domain/productConfiguration.js';
import {
  isTravelTaxCountry,
  lookupTravelTaxRow,
  type TravelEuTaxRow,
} from './data/travel-eu-tax-rates.loader.js';

/**
 * Travel per-country tax engine — implements ADR-0024.
 *
 * Replaces the generic `applyTenantTaxes` call inside `travelCalculator.ts`.
 * The per-country regulatory rate comes from
 * `data/travel-eu-tax-rates.json` (canonical owner of Travel tax data),
 * keyed by the resolved `JurisdictionProductConfig.countryCode`.
 *
 * Scope:
 *   - This module owns regulatory premium taxes (IPT, stamp duty,
 *     parafiscal levies, document-duty minimums) only.
 *   - Broker admin fee (`tenant.adminFee`) is NOT in scope — it is
 *     added separately in `travelCalculator.ts` so the regulatory tax
 *     line is auditable on its own.
 *
 * Rounding:
 *   - All money rounded to 2dp using EXCEL_COMPAT (matches motorTaxes).
 *
 * REFER:
 *   - When the loader returns a row with `refer: true` (e.g. NL
 *     pending BRIT confirmation), this function returns `refer: true`
 *     and the calculator must surface a REFERRAL outcome — never
 *     synthesise a default rate (`no-defensive-fallbacks`).
 */

export type TravelTaxResult = {
  profileCode: JurisdictionProductConfig['taxRegime']['profileCode'];
  refer: boolean;
  referReason?: string;
  rows: TaxBreakdown[];
  iptAmount: number;
  parafiscalAmount: number;
  flatStampDuty: number;
  totalTaxAmount: number;
  interimConservative: boolean;
};

export type TravelTaxInput = {
  config: JurisdictionProductConfig;
  netPremium: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function taxRow(args: Omit<TaxBreakdown, 'rounding'>): TaxBreakdown {
  return {
    ...args,
    amount: round2(args.amount),
    ...(args.base !== undefined ? { base: round2(args.base) } : {}),
    rounding: { mode: 'EXCEL_COMPAT', precision: 2 },
  };
}

function isReferRow(row: TravelEuTaxRow): row is Extract<TravelEuTaxRow, { refer: true }> {
  return row.refer === true;
}

export function calculateTravelTaxes(input: TravelTaxInput): TravelTaxResult {
  const net = Math.max(0, Number(input.netPremium) || 0);
  const countryCode = input.config.countryCode;

  if (!isTravelTaxCountry(countryCode)) {
    // Schema invariant + JurisdictionProductConfig should already exclude this,
    // but fail loud per `no-defensive-fallbacks` if a non-authorised country
    // ever reaches the tax engine.
    throw new Error(
      `[travelTaxes] Country '${countryCode}' is not in the BRIT-authorised Travel tax list. ` +
        `Add a row to data/travel-eu-tax-rates.json (or refer to UW) before pricing.`,
    );
  }

  const row = lookupTravelTaxRow(countryCode);

  if (isReferRow(row)) {
    return {
      profileCode: input.config.taxRegime.profileCode,
      refer: true,
      referReason: row.notes,
      rows: [taxRow({ code: 'NET_PREMIUM', amount: net })],
      iptAmount: 0,
      parafiscalAmount: 0,
      flatStampDuty: 0,
      totalTaxAmount: 0,
      interimConservative: false,
    };
  }

  // Active row — compute IPT, parafiscal levies, flat stamp duty + minimum.
  let iptAmount = round2(net * row.iptRate);
  if (row.minimumDuty !== undefined && iptAmount < row.minimumDuty) {
    iptAmount = round2(row.minimumDuty);
  }

  let parafiscalAmount = 0;
  const parafiscalRows: TaxBreakdown[] = [];
  for (const levy of row.parafiscalLevies ?? []) {
    let amount = 0;
    if (levy.rate !== undefined) {
      amount = round2(net * levy.rate);
      parafiscalRows.push(taxRow({ code: levy.code, amount, rate: levy.rate, base: net }));
    } else if (levy.flatPerPolicy !== undefined) {
      amount = round2(levy.flatPerPolicy);
      parafiscalRows.push(taxRow({ code: levy.code, amount }));
    }
    parafiscalAmount = round2(parafiscalAmount + amount);
  }

  const flatStampDuty = row.flatStampDuty !== undefined ? round2(row.flatStampDuty) : 0;
  const totalTaxAmount = round2(iptAmount + parafiscalAmount + flatStampDuty);

  const rows: TaxBreakdown[] = [
    taxRow({ code: 'NET_PREMIUM', amount: net }),
    taxRow({ code: 'IPT', amount: iptAmount, rate: row.iptRate, base: net }),
    ...parafiscalRows,
    ...(flatStampDuty > 0 ? [taxRow({ code: 'STAMP_DUTY', amount: flatStampDuty })] : []),
  ];

  return {
    profileCode: input.config.taxRegime.profileCode,
    refer: false,
    rows,
    iptAmount,
    parafiscalAmount,
    flatStampDuty,
    totalTaxAmount,
    interimConservative: row.interimConservative === true,
  };
}
