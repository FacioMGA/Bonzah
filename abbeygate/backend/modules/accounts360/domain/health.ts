export type AccountHealthStatus = 'HEALTHY' | 'ATTENTION' | 'AT_RISK';

export type AccountHealthInput = {
  overdueBalance: number;
  failedPayments: number;
  openClaimsCount: number;
  renewalIn30DaysCount: number;
  billingIssueCount: number;
  cancellationSignals: number;
};

export type AccountHealthResult = {
  status: AccountHealthStatus;
  score: number;
  reasons: string[];
  ruleVersion: number;
};

const RULE_VERSION = 1;

export function deriveAccountHealth(input: AccountHealthInput): AccountHealthResult {
  const reasons: string[] = [];
  let score = 0;

  if (input.overdueBalance > 0) {
    score += 40;
    reasons.push('OVERDUE_BALANCE');
  }
  if (input.failedPayments > 0) {
    score += 25;
    reasons.push('FAILED_PAYMENT');
  }
  if (input.openClaimsCount > 0) {
    score += Math.min(20, input.openClaimsCount * 5);
    reasons.push('OPEN_CLAIMS');
  }
  if (input.renewalIn30DaysCount > 0) {
    score += 10;
    reasons.push('RENEWAL_SOON');
  }
  if (input.billingIssueCount > 0) {
    score += Math.min(15, input.billingIssueCount * 5);
    reasons.push('BILLING_ISSUE');
  }
  if (input.cancellationSignals > 0) {
    score += 30;
    reasons.push('CANCELLATION_SIGNAL');
  }

  const status: AccountHealthStatus = score >= 60 ? 'AT_RISK' : score >= 25 ? 'ATTENTION' : 'HEALTHY';
  return { status, score, reasons, ruleVersion: RULE_VERSION };
}
