import type { CsrStream } from './crsV52Motor.js';

export type ApplicabilitySeverity = 'error' | 'warning' | 'info';

export type ApplicabilityProfile = {
  productLine?: 'motor' | 'unknown';
  territoryGroup?: 'europe' | 'global' | 'unknown';
  riskSubmittedSeparately?: boolean;
  settlementCurrencyDiffers?: boolean;
  hasCommission?: boolean;
  hasTaxes?: boolean;
  hasFees?: boolean;
  includesRiskLevelFinancials?: boolean;
  hasTransactionExpiry?: boolean;
  hasExcess?: boolean;
  hasOwnDamageCover?: boolean;
};

export type ApplicabilityResult = {
  applicable: boolean;
  mandatoryMode: 'always' | 'conditional' | 'not_applicable';
  severity: ApplicabilitySeverity;
  reason?: string;
};

type PolicyRule = {
  stream: CsrStream | 'all';
  key: string;
  evaluate: (profile: ApplicabilityProfile) => ApplicabilityResult;
};

const always = (severity: ApplicabilitySeverity = 'error'): ApplicabilityResult => ({
  applicable: true,
  mandatoryMode: 'always',
  severity,
});

const maybe = (applies: boolean, severity: ApplicabilitySeverity = 'warning', reason?: string): ApplicabilityResult => ({
  applicable: applies,
  mandatoryMode: applies ? 'conditional' : 'not_applicable',
  severity,
  reason,
});

const RULES: PolicyRule[] = [
  {
    stream: 'all',
    key: 'risk_not_submitted_separately',
    evaluate: (profile) => maybe(!profile.riskSubmittedSeparately, 'warning', 'Risk data expected when premium is standalone.'),
  },
  {
    stream: 'all',
    key: 'premium_has_commission',
    evaluate: (profile) => maybe(Boolean(profile.hasCommission), 'warning'),
  },
  {
    stream: 'all',
    key: 'premium_has_taxes',
    evaluate: (profile) => maybe(Boolean(profile.hasTaxes), 'warning'),
  },
  {
    stream: 'all',
    key: 'premium_has_fees',
    evaluate: (profile) => maybe(Boolean(profile.hasFees), 'warning'),
  },
  {
    stream: 'all',
    key: 'premium_has_transaction_expiry',
    evaluate: (profile) => maybe(Boolean(profile.hasTransactionExpiry), 'warning'),
  },
  {
    stream: 'premium',
    key: 'settlement_currency_differs',
    evaluate: (profile) => maybe(Boolean(profile.settlementCurrencyDiffers), 'warning', 'Settlement currency differs from original currency.'),
  },
  {
    stream: 'risk',
    key: 'motor_has_excess',
    evaluate: (profile) => maybe(Boolean(profile.hasExcess), 'warning'),
  },
  {
    stream: 'risk',
    key: 'motor_own_damage',
    evaluate: (profile) => maybe(Boolean(profile.hasOwnDamageCover), 'warning'),
  },
  {
    stream: 'risk',
    key: 'risk_level_financials_included',
    evaluate: (profile) => maybe(Boolean(profile.includesRiskLevelFinancials), 'info'),
  },
];

export function getDefaultApplicabilityProfile(): ApplicabilityProfile {
  return {
    productLine: 'motor',
    territoryGroup: 'europe',
    riskSubmittedSeparately: false,
    settlementCurrencyDiffers: false,
    hasCommission: true,
    hasTaxes: true,
    hasFees: true,
    includesRiskLevelFinancials: true,
    hasTransactionExpiry: true,
    hasExcess: true,
    hasOwnDamageCover: true,
  };
}

export function evaluateApplicability(args: {
  stream: CsrStream;
  applicabilityKey?: string;
  profile?: ApplicabilityProfile;
}): ApplicabilityResult {
  const { stream, applicabilityKey } = args;
  const profile = args.profile || getDefaultApplicabilityProfile();
  if (!applicabilityKey) return always('error');
  const rule = RULES.find((candidate) => candidate.key === applicabilityKey && (candidate.stream === stream || candidate.stream === 'all'));
  if (!rule) {
    return maybe(false, 'warning', `Unknown applicability key: ${applicabilityKey}`);
  }
  return rule.evaluate(profile);
}

