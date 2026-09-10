export type DiscoverabilityFieldOwnership =
  | 'coreTransactional'
  | 'productTransactional'
  | 'asyncEnrichment';

export const POLICY_LIST_INDEX_FIELD_OWNERSHIP: Record<string, DiscoverabilityFieldOwnership> = {
  // Core transactional discoverability
  policyNumber: 'coreTransactional',
  status: 'coreTransactional',
  bo_status: 'coreTransactional',
  bo_status_changed_at: 'coreTransactional',    // timestamp of last bo_status transition (SLA 3)
  statusSortRank: 'coreTransactional',
  bo_statusSortRank: 'coreTransactional',
  updatedAt: 'coreTransactional',
  lastActivityAt: 'coreTransactional',
  indexVersion: 'coreTransactional',

  // Product transactional discoverability
  insuredName: 'productTransactional',
  insuredDisplay: 'productTransactional',
  vehicleDisplay: 'productTransactional',
  policyholderDisplay: 'productTransactional',
  policyholderEmail: 'productTransactional',
  policyholderPhone: 'productTransactional',
  coverageStart: 'productTransactional',
  coverageEnd: 'productTransactional',
  vehicleSearch: 'productTransactional',
  address: 'productTransactional',
  segment: 'productTransactional',
  totalPremium: 'productTransactional',
  renewalDate: 'productTransactional',
  quoteExpiryDate: 'productTransactional',

  // Async enrichment
  attentionBucket: 'asyncEnrichment',
  attentionScore: 'asyncEnrichment',
  hasOpenClaim: 'asyncEnrichment',
  openClaimCount: 'asyncEnrichment',
  outstandingBalance: 'asyncEnrichment',
  invoiceOverdue: 'asyncEnrichment',
  cancellationPending: 'asyncEnrichment',
  customerActionRequired: 'asyncEnrichment',
  uwActionRequired: 'asyncEnrichment',
  complianceState: 'asyncEnrichment',
  complianceProfile: 'asyncEnrichment',
  complianceReasons: 'asyncEnrichment',
  complianceCheckedAt: 'asyncEnrichment',
  cancellationExposureEUR: 'asyncEnrichment',   // pro-rata unearned premium for OPERATIONS EUR
};

export function assertPolicyListIndexOwnership(field: string): DiscoverabilityFieldOwnership {
  const ownership = POLICY_LIST_INDEX_FIELD_OWNERSHIP[field];
  if (!ownership) {
    throw new Error(`Missing policy_list_index ownership mapping for field: ${field}`);
  }
  return ownership;
}

