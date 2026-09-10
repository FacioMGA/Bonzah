export type DashboardCore = {
  writtenPremium?: number;
  incurredClaims?: number;
  lossRatio?: number;
  policyCount?: number;
  deltas?: {
    writtenPremium?: number;
    incurredClaims?: number;
    lossRatio?: number;
    policyCount?: number;
  };
};

export type DashboardAccountRow = {
  name: string;
  units: number;
  status: string;
  gwp: string;
  ex?: number;
};

// ─── Intelligence layer (v1) ────────────────────────────────────────────────

export type DashboardTaskGroupType = 'UNDERWRITING' | 'CLAIMS' | 'BILLING' | 'OPERATIONS';

export type DashboardTaskGroup = {
  type: DashboardTaskGroupType;
  label: string;
  count: number;
  exposureEUR: number | null;
  slaBreachCount: number | null;
};

export type DashboardSlaKey = 'INVOICE_OVERDUE' | 'CLAIM_FNOL_STALE' | 'UW_REFERRAL_STALE';

export type DashboardSlaSignal = {
  key: DashboardSlaKey;
  label: string;
  count: number;
  priority: 1 | 2 | 3;
  ready: boolean;
};

export type DashboardRisk = {
  expiringIn30Days: number;
  openClaimsReserveEUR: number;
  complianceFailCount: number;
};

// ─── Smart Insight Strip (v1) ────────────────────────────────────────────────

export type InsightType     = 'CRITICAL' | 'WARNING' | 'OPPORTUNITY';
export type InsightCategory = 'UNDERWRITING' | 'SLA' | 'CONVERSION';

export type DashboardInsight = {
  type:           InsightType;
  category:       InsightCategory;
  title:          string;
  description:    string;
  actionLabel:    string;
  actionUrl:      string;
  priorityScore:  number;
  suppressionKey: string;
};

export type DashboardIntelligence = {
  tasks:    DashboardTaskGroup[];
  sla:      DashboardSlaSignal[];
  risk:     DashboardRisk;
  insights: DashboardInsight[];
};
