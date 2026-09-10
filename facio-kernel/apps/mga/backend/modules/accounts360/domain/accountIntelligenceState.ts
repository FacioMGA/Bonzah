export type AccountIntelligenceState = 'PAYMENT_ISSUE' | 'CLAIM' | 'RENEWAL' | 'HEALTHY';

export type AccountIntelligenceReason =
  | 'OVERDUE_PAYMENT'
  | 'FAILED_PAYMENT'
  | 'OPEN_CLAIM'
  | 'RENEWAL_LT_30D';

export type AccountIntelligenceStateInput = {
  overdueAmount: number;
  failedPaymentsCount: number;
  openClaimsCount: number;
  nextRenewalAt: Date | null;
  now?: Date;
};

export type AccountIntelligenceStateResult = {
  state: AccountIntelligenceState;
  reasons: AccountIntelligenceReason[];
  priority: number;
  score: number;
};

function daysUntil(target: Date, now: Date): number {
  const ms = target.getTime() - now.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function deriveAccountIntelligenceState(input: AccountIntelligenceStateInput): AccountIntelligenceStateResult {
  const reasons: AccountIntelligenceReason[] = [];
  const now = input.now || new Date();
  const overdueAmount = Number(input.overdueAmount || 0);
  const failedPaymentsCount = Number(input.failedPaymentsCount || 0);
  const openClaimsCount = Number(input.openClaimsCount || 0);
  const nextRenewalAt = input.nextRenewalAt instanceof Date ? input.nextRenewalAt : null;
  const renewalInDays = nextRenewalAt ? daysUntil(nextRenewalAt, now) : null;

  if (overdueAmount > 0) reasons.push('OVERDUE_PAYMENT');
  if (failedPaymentsCount > 0) reasons.push('FAILED_PAYMENT');
  if (openClaimsCount > 0) reasons.push('OPEN_CLAIM');
  if (renewalInDays !== null && renewalInDays >= 0 && renewalInDays < 30) reasons.push('RENEWAL_LT_30D');

  if (overdueAmount > 0 || failedPaymentsCount > 0) {
    return {
      state: 'PAYMENT_ISSUE',
      reasons,
      priority: 1,
      score: Math.min(100, 70 + Math.round(overdueAmount > 0 ? 15 : 0) + Math.min(15, failedPaymentsCount * 5)),
    };
  }
  if (openClaimsCount > 0) {
    return {
      state: 'CLAIM',
      reasons,
      priority: 2,
      score: Math.min(100, 50 + Math.min(30, openClaimsCount * 10)),
    };
  }
  if (renewalInDays !== null && renewalInDays >= 0 && renewalInDays < 30) {
    return {
      state: 'RENEWAL',
      reasons,
      priority: 3,
      score: Math.max(10, 40 - Math.max(0, renewalInDays)),
    };
  }
  return {
    state: 'HEALTHY',
    reasons,
    priority: 4,
    score: 0,
  };
}
