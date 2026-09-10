type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};

export type AccountHealth = 'HEALTHY' | 'ATTENTION' | 'AT_RISK';

export type Account360ListItem = {
  accountId: string;
  accountName: string;
  accountType: string;
  secondaryIdentity: string;
  ownerBroker: string;
  activePoliciesCount: number;
  annualizedPremium: number;
  healthStatus: AccountHealth;
  healthScore: number;
  openClaimsCount: number;
  billingIssueCount: number;
  renewalIn30DaysCount: number;
  lastActivityAt: string;
  lastActivitySummary: string;
  productMix: Record<string, number>;
};

export function toAccount360ListItem(value: unknown): Account360ListItem | null {
  const row = asRecord(value);
  const accountId = String(row.accountId || '').trim();
  const accountName = String(row.accountName || '').trim();
  if (!accountId || !accountName) return null;
  const statusRaw = String(row.healthStatus || '').toUpperCase();
  const healthStatus: AccountHealth =
    statusRaw === 'AT_RISK' ? 'AT_RISK' : statusRaw === 'ATTENTION' ? 'ATTENTION' : 'HEALTHY';
  const productMixRaw = asRecord(row.productMix);
  const productMix: Record<string, number> = {};
  for (const [key, v] of Object.entries(productMixRaw)) {
    productMix[key] = Number(v || 0) || 0;
  }

  return {
    accountId,
    accountName,
    accountType: String(row.accountType || 'INDIVIDUAL'),
    secondaryIdentity: String(row.secondaryIdentity || ''),
    ownerBroker: String(row.ownerBroker || ''),
    activePoliciesCount: Number(row.activePoliciesCount || 0) || 0,
    annualizedPremium: Number(row.annualizedPremium || 0) || 0,
    healthStatus,
    healthScore: Number(row.healthScore || 0) || 0,
    openClaimsCount: Number(row.openClaimsCount || 0) || 0,
    billingIssueCount: Number(row.billingIssueCount || 0) || 0,
    renewalIn30DaysCount: Number(row.renewalIn30DaysCount || 0) || 0,
    lastActivityAt: String(row.lastActivityAt || ''),
    lastActivitySummary: String(row.lastActivitySummary || ''),
    productMix,
  };
}
