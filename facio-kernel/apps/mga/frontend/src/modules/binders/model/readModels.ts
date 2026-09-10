export type BinderStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'ARCHIVED'
  | 'PENDING'
  | 'UNKNOWN';

export type BinderHealthFlag = 'healthy' | 'warning' | 'critical';

export type BinderIndexRow = {
  id: string;
  coverholderName: string;
  leadCapacityProviderName: string;
  productLabel: string;
  regionLabel: string;
  umr: string;
  agreementNumber: string;
  status: BinderStatus;
  startDate: string | null;
  endDate: string | null;
  defaultCurrency: string;
  settlementCurrency: string;
  version: number;
  lloydsReportingVer: string;
  lastUpdatedAt: string | null;
  effectivePeriodLabel: string;
  healthFlag: BinderHealthFlag;
  publishabilityFlag: 'publishable' | 'blocked';
  programUsageCount: number;
  policyCount: number;
  grossPremiumWritten: number;
  grossPremiumLimit: number;
  gpiUsagePct: number | null;
  gpiWarnThresholdPct: number;
  scopeLabel: string;
  hasReportingConfig: boolean;
  hasMissingConfig: boolean;
};

export type BinderPartyReadModel = {
  id: string;
  role: string;
  name: string;
  registrationNumber: string | null;
  partySubtype: string | null;
  address: Record<string, unknown>;
  contact: Record<string, unknown>;
  rolesMeta: Record<string, unknown>;
};

export type BinderDocumentReadModel = {
  id: string;
  type: string;
  name: string;
  filename: string | null;
  storageUri: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
  meta: Record<string, unknown>;
};

export type BinderCoverageReadModel = {
  id: string;
  coverageCode: string;
  title: string | null;
  allowed: boolean;
  maxLimit: Record<string, unknown>;
  deductible: Record<string, unknown>;
  partyLimits: Record<string, unknown>;
  wordingAnchorClauseId: string | null;
  meta: Record<string, unknown>;
};

export type BinderClauseReadModel = {
  id: string;
  clauseType: string;
  textFragment: string;
  codes: string[];
  pointer: Record<string, unknown>;
  meta: Record<string, unknown>;
};

export type BinderFinancialsReadModel = {
  maxLine: number | null;
  grossPremiumLimit: number | null;
  notifiablePercent: number | null;
  commissionRate: number | null;
  profitCommission: Record<string, unknown>;
  premiumAccount: Record<string, unknown>;
};

export type BinderReportingReadModel = {
  writtenRiskSchedule: string | null;
  paidClaimsSchedule: string | null;
  bordereauFormat: string | null;
  destination: Record<string, unknown>;
  reportingContacts: Record<string, unknown>;
};

export type BinderProgramLinkReadModel = {
  id: string;
  status: string;
  programId: string;
  programName: string | null;
  programStatus: string | null;
  mapping: Record<string, unknown>;
  updatedAt: string | null;
};

export type BinderDetailBundle = {
  binder: {
    id: string;
    coverholderName: string;
    coverholderPin: string | null;
    umr: string;
    agreementNumber: string;
    lloydsReportingVer: string;
    defaultCurrency: string;
    settlementCurrency: string;
    status: BinderStatus;
    startDate: string | null;
    endDate: string | null;
    version: number;
    etag: string | null;
    config: Record<string, unknown>;
    createdAt: string | null;
    updatedAt: string | null;
  };
  parties: BinderPartyReadModel[];
  documents: BinderDocumentReadModel[];
  coverages: BinderCoverageReadModel[];
  clauses: BinderClauseReadModel[];
  financials: BinderFinancialsReadModel | null;
  reporting: BinderReportingReadModel | null;
  programLinks: BinderProgramLinkReadModel[];
};

export type BinderUsageSummary = {
  linkedPrograms: BinderProgramLinkReadModel[];
  totals: {
    linkedPrograms: number;
    activeLinks: number;
  };
};

export type BinderSimulationRuleOutcome = {
  ruleCode: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
};

export type BinderSimulationResult = {
  pass: boolean;
  authoritative: boolean;
  reasons: string[];
  matchedRules: BinderSimulationRuleOutcome[];
  referralTarget: string | null;
  evaluatedAt: string;
  inputs: {
    territory: string | null;
    riskLocationCountry?: string | null;
    insuredDomicileCountry?: string | null;
    vehicleValue: number | null;
  };
};

export type BinderPublishResult = {
  binderId: string;
  status: BinderStatus;
  reportingPeriodsCreated: number;
  message: string | null;
};
