import type { DevFormState, Worksheet } from '@/src/modules/claims/model/worksheetTypes';

type PaymentClassification = NonNullable<Worksheet['paymentModel']>['classifications'][number];
type PaymentPayee = NonNullable<Worksheet['paymentModel']>['payees'][number];

const FALLBACK_CLASSIFICATIONS: PaymentClassification[] = [
  {
    costCategory: 'indemnity',
    costSubType: 'other',
    allowedPayeeRoles: ['insured', 'claimant', 'third_party', 'repairer'],
    reportingTreatment: 'indemnity',
    operationalBucket: 'INDEMNITY',
    requiresInvoiceReference: false,
    requiresNote: false,
    uiLabel: 'Indemnity',
    guidance: null,
  },
  {
    costCategory: 'indemnity',
    costSubType: 'defence_fee',
    allowedPayeeRoles: ['legal_provider'],
    reportingTreatment: 'indemnity',
    operationalBucket: 'DEFENCE_COSTS',
    requiresInvoiceReference: true,
    requiresNote: false,
    uiLabel: 'Defence fee',
    guidance: 'Policy-liability defence fees are treated as indemnity for reporting.',
  },
  {
    costCategory: 'fees',
    costSubType: 'attorney_coverage_fee',
    allowedPayeeRoles: ['legal_provider'],
    reportingTreatment: 'fees',
    operationalBucket: 'LEGAL_FEES',
    requiresInvoiceReference: true,
    requiresNote: false,
    uiLabel: 'Attorney coverage fee',
    guidance: null,
  },
  {
    costCategory: 'fees',
    costSubType: 'adjuster_fee',
    allowedPayeeRoles: ['adjuster'],
    reportingTreatment: 'fees',
    operationalBucket: 'ADJUSTER_FEES',
    requiresInvoiceReference: true,
    requiresNote: false,
    uiLabel: 'Adjuster fee',
    guidance: null,
  },
  {
    costCategory: 'fees',
    costSubType: 'expense',
    allowedPayeeRoles: ['expert', 'medical_provider', 'vendor', 'other'],
    reportingTreatment: 'fees',
    operationalBucket: 'OTHER',
    requiresInvoiceReference: true,
    requiresNote: false,
    uiLabel: 'Expense',
    guidance: null,
  },
  {
    costCategory: 'fees',
    costSubType: 'tpa_fee',
    allowedPayeeRoles: ['tpa'],
    reportingTreatment: 'fees',
    operationalBucket: 'OTHER',
    requiresInvoiceReference: true,
    requiresNote: false,
    uiLabel: 'TPA fee',
    guidance: null,
  },
  {
    costCategory: 'fees',
    costSubType: 'other',
    allowedPayeeRoles: ['vendor', 'other'],
    reportingTreatment: 'fees',
    operationalBucket: 'OTHER',
    requiresInvoiceReference: false,
    requiresNote: true,
    uiLabel: 'Other fee',
    guidance: null,
  },
];

export function getClaimPaymentClassifications(worksheet?: Worksheet | null): PaymentClassification[] {
  return worksheet?.paymentModel?.classifications?.length ? worksheet.paymentModel.classifications : FALLBACK_CLASSIFICATIONS;
}

export function findClaimPaymentClassification(
  worksheet: Worksheet | null | undefined,
  costCategory: DevFormState['costCategory'],
  costSubType: DevFormState['costSubType'],
): PaymentClassification | undefined {
  return getClaimPaymentClassifications(worksheet).find(
    (item) => item.costCategory === costCategory && item.costSubType === costSubType,
  );
}

export function getClaimPaymentSubtypeOptions(
  worksheet: Worksheet | null | undefined,
  costCategory: DevFormState['costCategory'],
): PaymentClassification[] {
  return getClaimPaymentClassifications(worksheet).filter((item) => item.costCategory === costCategory);
}

export function getClaimPaymentOptionalSubtypeOptions(
  worksheet: Worksheet | null | undefined,
  costCategory: DevFormState['costCategory'],
): PaymentClassification[] {
  const options = getClaimPaymentSubtypeOptions(worksheet, costCategory);
  if (costCategory === 'indemnity') {
    return options.filter((item) => item.costSubType !== 'other');
  }
  return options;
}

export function getEligibleClaimPaymentPayees(
  worksheet: Worksheet | null | undefined,
  costCategory: DevFormState['costCategory'],
  costSubType: DevFormState['costSubType'],
): PaymentPayee[] {
  const classification = findClaimPaymentClassification(worksheet, costCategory, costSubType);
  if (!classification) return [];
  const payees = worksheet?.paymentModel?.payees || [];
  return payees.filter((payee) => payee.roles.some((role) => classification.allowedPayeeRoles.includes(role)));
}

export function getClaimPaymentRoleLabel(role: PaymentPayee['roles'][number]): string {
  switch (role) {
    case 'insured':
      return 'Insured';
    case 'claimant':
      return 'Claimant';
    case 'third_party':
      return 'Third party';
    case 'repairer':
      return 'Repairer';
    case 'legal_provider':
      return 'Legal provider';
    case 'adjuster':
      return 'Adjuster';
    case 'expert':
      return 'Expert';
    case 'tpa':
      return 'TPA';
    case 'medical_provider':
      return 'Medical provider';
    case 'vendor':
      return 'Vendor';
    case 'other':
    default:
      return 'Other';
  }
}

export function sanitizeClaimPaymentSelection(
  worksheet: Worksheet | null | undefined,
  devForm: DevFormState,
): DevFormState {
  const classification = findClaimPaymentClassification(worksheet, devForm.costCategory, devForm.costSubType);
  const eligiblePayees = getEligibleClaimPaymentPayees(worksheet, devForm.costCategory, devForm.costSubType);
  const payeeStillEligible = eligiblePayees.some((payee) => payee.id === devForm.payeeCounterpartyId);
  return {
    ...devForm,
    bucket: classification?.operationalBucket || devForm.bucket,
    payeeCounterpartyId: payeeStillEligible ? devForm.payeeCounterpartyId : '',
  };
}
