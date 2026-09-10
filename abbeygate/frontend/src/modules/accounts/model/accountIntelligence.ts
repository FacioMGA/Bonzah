type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};

export type AccountOperationalState = 'PAYMENT_ISSUE' | 'CLAIM' | 'RENEWAL' | 'HEALTHY';

export type AccountIntelligenceListItem = {
  accountId: string;
  accountName: string;
  secondaryIdentity: string;
  activePolicies: number;
  totalPolicies: number;
  totalPremium: number;
  productMix: Record<string, number>;
  openClaimsCount: number;
  outstandingReserve: number;
  overdueAmount: number;
  failedPaymentsCount: number;
  nextRenewalAt: string;
  lastActivityAt: string;
  lastActivityType: string;
  lastActivitySummary: string;
  state: AccountOperationalState;
  stateReasons: string[];
  stateScore: number;
  statePriority: number;
};

export function toAccountIntelligenceListItem(value: unknown): AccountIntelligenceListItem | null {
  const row = asRecord(value);
  const accountId = String(row.accountId || '').trim();
  const accountName = String(row.accountName || '').trim();
  if (!accountId || !accountName) return null;
  const stateRaw = String(row.state || '').toUpperCase();
  const state: AccountOperationalState =
    stateRaw === 'PAYMENT_ISSUE'
      ? 'PAYMENT_ISSUE'
      : stateRaw === 'CLAIM'
        ? 'CLAIM'
        : stateRaw === 'RENEWAL'
          ? 'RENEWAL'
          : 'HEALTHY';

  return {
    accountId,
    accountName,
    secondaryIdentity: String(row.secondaryIdentity || ''),
    activePolicies: Number(row.activePolicies || 0) || 0,
    totalPolicies: Number(row.totalPolicies || 0) || 0,
    totalPremium: Number(row.totalPremium || 0) || 0,
    productMix: Object.entries(asRecord(row.productMix)).reduce<Record<string, number>>((acc, [k, v]) => {
      acc[k] = Number(v || 0) || 0;
      return acc;
    }, {}),
    openClaimsCount: Number(row.openClaimsCount || 0) || 0,
    outstandingReserve: Number(row.outstandingReserve || 0) || 0,
    overdueAmount: Number(row.overdueAmount || 0) || 0,
    failedPaymentsCount: Number(row.failedPaymentsCount || 0) || 0,
    nextRenewalAt: String(row.nextRenewalAt || ''),
    lastActivityAt: String(row.lastActivityAt || ''),
    lastActivityType: String(row.lastActivityType || ''),
    lastActivitySummary: String(row.lastActivitySummary || ''),
    state,
    stateReasons: Array.isArray(row.stateReasons) ? row.stateReasons.map((entry) => String(entry || '')) : [],
    stateScore: Number(row.stateScore || 0) || 0,
    statePriority: Number(row.statePriority || 4) || 4,
  };
}
