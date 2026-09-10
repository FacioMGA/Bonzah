import type { ClaimBucket } from './commands/types.js';

export type ClaimCostCategory = 'indemnity' | 'fees';
export type ClaimCostSubType =
  | 'other'
  | 'expense'
  | 'attorney_coverage_fee'
  | 'adjuster_fee'
  | 'defence_fee'
  | 'tpa_fee';
export type ReportingTreatment = 'indemnity' | 'fees';
export type PayeeRoleCode =
  | 'insured'
  | 'claimant'
  | 'third_party'
  | 'repairer'
  | 'legal_provider'
  | 'adjuster'
  | 'expert'
  | 'tpa'
  | 'medical_provider'
  | 'vendor'
  | 'other';

export type ClaimPaymentEligibilityRule = {
  costCategory: ClaimCostCategory;
  costSubType: ClaimCostSubType;
  allowedPayeeRoles: PayeeRoleCode[];
  requiresInvoiceReference: boolean;
  requiresNote: boolean;
  allowsReimbursement: boolean;
  reportingTreatment: ReportingTreatment;
  operationalBucket: ClaimBucket;
  uiLabel: string;
  guidance?: string;
};

const RULES: ClaimPaymentEligibilityRule[] = [
  {
    costCategory: 'fees',
    costSubType: 'attorney_coverage_fee',
    allowedPayeeRoles: ['legal_provider'],
    requiresInvoiceReference: true,
    requiresNote: false,
    allowsReimbursement: false,
    reportingTreatment: 'fees',
    operationalBucket: 'LEGAL_FEES',
    uiLabel: 'Attorney coverage fee',
  },
  {
    costCategory: 'fees',
    costSubType: 'adjuster_fee',
    allowedPayeeRoles: ['adjuster'],
    requiresInvoiceReference: true,
    requiresNote: false,
    allowsReimbursement: false,
    reportingTreatment: 'fees',
    operationalBucket: 'ADJUSTER_FEES',
    uiLabel: 'Adjuster fee',
  },
  {
    costCategory: 'fees',
    costSubType: 'expense',
    allowedPayeeRoles: ['expert', 'medical_provider', 'vendor', 'other'],
    requiresInvoiceReference: true,
    requiresNote: false,
    allowsReimbursement: false,
    reportingTreatment: 'fees',
    operationalBucket: 'OTHER',
    uiLabel: 'Expense',
  },
  {
    costCategory: 'fees',
    costSubType: 'tpa_fee',
    allowedPayeeRoles: ['tpa'],
    requiresInvoiceReference: true,
    requiresNote: false,
    allowsReimbursement: false,
    reportingTreatment: 'fees',
    operationalBucket: 'OTHER',
    uiLabel: 'TPA fee',
  },
  {
    costCategory: 'fees',
    costSubType: 'other',
    allowedPayeeRoles: ['vendor', 'other'],
    requiresInvoiceReference: false,
    requiresNote: true,
    allowsReimbursement: false,
    reportingTreatment: 'fees',
    operationalBucket: 'OTHER',
    uiLabel: 'Other fee',
  },
  {
    costCategory: 'indemnity',
    costSubType: 'defence_fee',
    allowedPayeeRoles: ['legal_provider'],
    requiresInvoiceReference: true,
    requiresNote: false,
    allowsReimbursement: false,
    reportingTreatment: 'indemnity',
    operationalBucket: 'DEFENCE_COSTS',
    uiLabel: 'Defence fee',
    guidance: 'Policy-liability defence fees are treated as indemnity for reporting.',
  },
  {
    costCategory: 'indemnity',
    costSubType: 'other',
    allowedPayeeRoles: ['insured', 'claimant', 'third_party', 'repairer'],
    requiresInvoiceReference: false,
    requiresNote: false,
    allowsReimbursement: true,
    reportingTreatment: 'indemnity',
    operationalBucket: 'INDEMNITY',
    uiLabel: 'Indemnity',
  },
];

const CATEGORY_VALUES: ClaimCostCategory[] = ['indemnity', 'fees'];
const SUBTYPE_VALUES: ClaimCostSubType[] = ['other', 'expense', 'attorney_coverage_fee', 'adjuster_fee', 'defence_fee', 'tpa_fee'];
const PAYEE_ROLE_VALUES: PayeeRoleCode[] = [
  'insured',
  'claimant',
  'third_party',
  'repairer',
  'legal_provider',
  'adjuster',
  'expert',
  'tpa',
  'medical_provider',
  'vendor',
  'other',
];

function ruleKey(costCategory: ClaimCostCategory, costSubType: ClaimCostSubType): string {
  return `${costCategory}:${costSubType}`;
}

const RULE_INDEX = new Map(RULES.map((rule) => [ruleKey(rule.costCategory, rule.costSubType), rule]));

export function listClaimPaymentEligibilityRules(): ClaimPaymentEligibilityRule[] {
  return RULES.map((rule) => ({ ...rule, allowedPayeeRoles: [...rule.allowedPayeeRoles] }));
}

export function normalizeClaimCostCategory(value: unknown): ClaimCostCategory | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  return CATEGORY_VALUES.includes(normalized as ClaimCostCategory) ? (normalized as ClaimCostCategory) : undefined;
}

export function normalizeClaimCostSubType(value: unknown): ClaimCostSubType | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  return SUBTYPE_VALUES.includes(normalized as ClaimCostSubType) ? (normalized as ClaimCostSubType) : undefined;
}

export function normalizePayeeRoleCode(value: unknown): PayeeRoleCode | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  return PAYEE_ROLE_VALUES.includes(normalized as PayeeRoleCode) ? (normalized as PayeeRoleCode) : undefined;
}

export function getClaimPaymentEligibilityRule(
  costCategory: ClaimCostCategory,
  costSubType: ClaimCostSubType,
): ClaimPaymentEligibilityRule | undefined {
  return RULE_INDEX.get(ruleKey(costCategory, costSubType));
}

export function derivePaymentClassificationFromLegacyBucket(bucket: ClaimBucket): Pick<ClaimPaymentEligibilityRule, 'costCategory' | 'costSubType' | 'reportingTreatment' | 'operationalBucket'> {
  switch (bucket) {
    case 'DEFENCE_COSTS':
      return {
        costCategory: 'indemnity',
        costSubType: 'defence_fee',
        reportingTreatment: 'indemnity',
        operationalBucket: 'DEFENCE_COSTS',
      };
    case 'ADJUSTER_FEES':
      return {
        costCategory: 'fees',
        costSubType: 'adjuster_fee',
        reportingTreatment: 'fees',
        operationalBucket: 'ADJUSTER_FEES',
      };
    case 'LEGAL_FEES':
      return {
        costCategory: 'fees',
        costSubType: 'attorney_coverage_fee',
        reportingTreatment: 'fees',
        operationalBucket: 'LEGAL_FEES',
      };
    case 'OTHER':
      return {
        costCategory: 'fees',
        costSubType: 'expense',
        reportingTreatment: 'fees',
        operationalBucket: 'OTHER',
      };
    case 'INDEMNITY':
    default:
      return {
        costCategory: 'indemnity',
        costSubType: 'other',
        reportingTreatment: 'indemnity',
        operationalBucket: 'INDEMNITY',
      };
  }
}

export function resolveOperationalBucketFromClassification(args: {
  costCategory?: unknown;
  costSubType?: unknown;
  fallbackBucket?: ClaimBucket;
}): ClaimBucket {
  const costCategory = normalizeClaimCostCategory(args.costCategory);
  const costSubType = normalizeClaimCostSubType(args.costSubType);
  if (costCategory && costSubType) {
    const rule = getClaimPaymentEligibilityRule(costCategory, costSubType);
    if (rule) return rule.operationalBucket;
  }
  return args.fallbackBucket || 'INDEMNITY';
}

export function normalizeReportingTreatment(value: unknown, fallbackBucket?: ClaimBucket): ReportingTreatment {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'indemnity' || normalized === 'fees') {
    return normalized;
  }
  if (fallbackBucket === 'ADJUSTER_FEES' || fallbackBucket === 'LEGAL_FEES' || fallbackBucket === 'OTHER') {
    return 'fees';
  }
  return 'indemnity';
}

export function deriveLegacyPayeeRoleFromPayeeType(value: unknown): PayeeRoleCode | undefined {
  const normalized = String(value || '').trim().toUpperCase();
  switch (normalized) {
    case 'CLAIMANT':
      return 'claimant';
    case 'GARAGE':
      return 'repairer';
    case 'ADJUSTER':
      return 'adjuster';
    case 'THIRD_PARTY':
      return 'third_party';
    case 'LAWYER':
      return 'legal_provider';
    case 'INSURED':
      return 'insured';
    default:
      return undefined;
  }
}

export function legacyPayeeTypeFromRole(role: PayeeRoleCode): string {
  switch (role) {
    case 'repairer':
      return 'GARAGE';
    case 'legal_provider':
      return 'LAWYER';
    case 'adjuster':
      return 'ADJUSTER';
    case 'third_party':
      return 'THIRD_PARTY';
    case 'insured':
      return 'INSURED';
    case 'claimant':
      return 'CLAIMANT';
    default:
      return role.toUpperCase();
  }
}

export function resolvePayeeRoleUsed(args: {
  costCategory: ClaimCostCategory;
  costSubType: ClaimCostSubType;
  availableRoles: unknown[];
  requestedRole?: unknown;
}): PayeeRoleCode | undefined {
  const rule = getClaimPaymentEligibilityRule(args.costCategory, args.costSubType);
  if (!rule) return undefined;
  const normalizedRoles = args.availableRoles
    .map((role) => normalizePayeeRoleCode(role))
    .filter((role): role is PayeeRoleCode => Boolean(role));
  const requestedRole = normalizePayeeRoleCode(args.requestedRole);
  if (requestedRole && normalizedRoles.includes(requestedRole) && rule.allowedPayeeRoles.includes(requestedRole)) {
    return requestedRole;
  }
  return rule.allowedPayeeRoles.find((role) => normalizedRoles.includes(role));
}
