import type {
  JurisdictionProductConfig,
  TaxBreakdown,
} from '../../../modules/jurisdiction/domain/productConfiguration.js';

export type MotorTaxInput = {
  config: JurisdictionProductConfig;
  grossPremium: number;
  netPremium?: number;
  entryType?: string;
  termMonths: number;
  inceptionDate: Date;
};

export type MotorTaxResult = {
  profileCode: JurisdictionProductConfig['taxRegime']['profileCode'];
  rows: TaxBreakdown[];
  legacy: {
    mifSurcharge: number;
    stampDuty: number;
    policyFee: number;
  };
  totalTaxAmount: number;
  greenCardFee: number;
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

function calculateCyMotorCurrent(input: MotorTaxInput): MotorTaxResult {
  const mifSurcharge = input.termMonths === 6 ? 4.5 : 9.0;
  const stampDuty = input.inceptionDate.getFullYear() >= 2026 ? 0 : 2.0;
  const rows = [
    taxRow({ code: 'NET_PREMIUM', amount: input.netPremium ?? input.grossPremium }),
    taxRow({ code: 'MIF', amount: mifSurcharge }),
    taxRow({ code: 'STAMP_DUTY', amount: stampDuty }),
  ];
  return {
    profileCode: 'CY_MOTOR_ABBEYGATE_CURRENT',
    rows,
    legacy: {
      mifSurcharge,
      stampDuty,
      policyFee: 0,
    },
    totalTaxAmount: round2(mifSurcharge + stampDuty),
    greenCardFee: 0,
  };
}

function calculatePtMotorVolanteConvergence(input: MotorTaxInput): MotorTaxResult {
  const entryType = String(input.entryType || '').trim().toUpperCase();
  const greenCardFee = entryType === 'NB' || entryType === 'RNL' ? 0.75 : 0;

  const hasExplicitNet = Number.isFinite(input.netPremium);
  const netPremium = hasExplicitNet
    ? Number(input.netPremium)
    : (Number(input.grossPremium || 0) - greenCardFee) / 1.129;
  const taxableGross = hasExplicitNet
    ? netPremium * 1.129
    : Number(input.grossPremium || 0) - greenCardFee;
  const totalTaxValue = taxableGross - netPremium;
  const stampDuty = netPremium * 0.09;
  const fgaTpo = netPremium * 0.00425;
  const inem = netPremium * 0.025;
  const fga = totalTaxValue - stampDuty - fgaTpo - inem;

  const rows = [
    taxRow({ code: 'NET_PREMIUM', amount: netPremium }),
    taxRow({ code: 'TOTAL_TAX_VALUE', amount: totalTaxValue, rate: 0.129, base: netPremium }),
    taxRow({ code: 'STAMP_DUTY', amount: stampDuty, rate: 0.09, base: netPremium }),
    taxRow({ code: 'FGA_TPO', amount: fgaTpo, rate: 0.00425, base: netPremium }),
    taxRow({ code: 'FGA', amount: fga, base: netPremium }),
    taxRow({ code: 'INEM', amount: inem, rate: 0.025, base: netPremium }),
    taxRow({ code: 'GREEN_CARD_FEE', amount: greenCardFee }),
  ];

  return {
    profileCode: 'PT_MOTOR_VOLANTE_BDX_12_9_CONVERGENCE',
    rows,
    legacy: {
      mifSurcharge: round2(totalTaxValue),
      stampDuty: round2(stampDuty),
      policyFee: round2(greenCardFee),
    },
    totalTaxAmount: round2(totalTaxValue + greenCardFee),
    greenCardFee: round2(greenCardFee),
  };
}

function calculatePercentageIptMotor(input: MotorTaxInput, profileCode: MotorTaxResult['profileCode'], rate: number): MotorTaxResult {
  const hasExplicitNet = Number.isFinite(input.netPremium);
  const netPremium = hasExplicitNet
    ? Number(input.netPremium)
    : Number(input.grossPremium || 0) / (1 + rate);
  const ipt = netPremium * rate;
  const rows = [
    taxRow({ code: 'NET_PREMIUM', amount: netPremium }),
    taxRow({ code: 'IPT', amount: ipt, rate, base: netPremium }),
  ];
  return {
    profileCode,
    rows,
    legacy: {
      mifSurcharge: round2(ipt),
      stampDuty: 0,
      policyFee: 0,
    },
    totalTaxAmount: round2(ipt),
    greenCardFee: 0,
  };
}

export function calculateMotorTaxes(input: MotorTaxInput): MotorTaxResult {
  switch (input.config.taxRegime.profileCode) {
    case 'CY_MOTOR_ABBEYGATE_CURRENT':
      return calculateCyMotorCurrent(input);
    case 'PT_MOTOR_VOLANTE_BDX_12_9_CONVERGENCE':
      return calculatePtMotorVolanteConvergence(input);
    case 'GR_MOTOR_TENANT_IPT_CURRENT':
      return calculatePercentageIptMotor(input, 'GR_MOTOR_TENANT_IPT_CURRENT', 0.15);
    case 'ES_MOTOR_TENANT_IPT_CURRENT':
      return calculatePercentageIptMotor(input, 'ES_MOTOR_TENANT_IPT_CURRENT', 0.0815);
    default:
      throw new Error(`Unsupported motor tax profile: ${input.config.taxRegime.profileCode}`);
  }
}
