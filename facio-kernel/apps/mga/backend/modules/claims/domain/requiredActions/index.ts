export type RequiredAction = {
  id: string;
  severity: 'BLOCKING' | 'IMPORTANT' | 'INFO';
  title: string;
  cta?: { label: string; commandType: string };
  reason?: string;
};

export type RequiredActionsInput = {
  intakeStatus: 'NONE' | 'FNOL_SUBMITTED' | 'AWAITING_CLARIFICATION' | 'FNOL_CONFIRMED';
  failingGateKeys: string[];
  referralRequired: boolean;
  referralApprovedAt?: string;
  largeLossIndicator: boolean;
  largeLossNotifiedAt?: string;
  lockedDeductible?: number;
};

export function deriveRequiredActions(input: RequiredActionsInput): RequiredAction[] {
  const actions: RequiredAction[] = [];

  if (input.intakeStatus !== 'FNOL_CONFIRMED') {
    actions.push({
      id: 'confirm-fnol',
      severity: 'BLOCKING',
      title: 'Confirm FNOL before financial actions',
      cta: { label: 'Confirm FNOL', commandType: 'CONFIRM_FNOL' },
    });
  }

  if (input.failingGateKeys.length > 0) {
    actions.push({
      id: 'complete-intake-gates',
      severity: 'BLOCKING',
      title: 'Complete required FNOL fields',
      reason: `First failing gate: ${input.failingGateKeys[0]}`,
    });
  }

  if (input.referralRequired && !input.referralApprovedAt) {
    actions.push({
      id: 'approve-referral',
      severity: 'BLOCKING',
      title: 'Approve referral for authority breach',
      cta: { label: 'Approve referral', commandType: 'APPROVE_REFERRAL' },
    });
  }

  if (input.largeLossIndicator && !input.largeLossNotifiedAt) {
    actions.push({
      id: 'notify-underwriter-large-loss',
      severity: 'IMPORTANT',
      title: 'Notify underwriter for large loss',
    });
  }

  if (input.intakeStatus === 'FNOL_CONFIRMED' && typeof input.lockedDeductible !== 'number') {
    actions.push({
      id: 'diagnose-deductible-lock',
      severity: 'INFO',
      title: 'Validate deductible lock snapshot',
    });
  }

  return actions.slice(0, 5);
}

