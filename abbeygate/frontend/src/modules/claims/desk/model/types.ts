import type { DevelopmentType, Worksheet } from '@/src/modules/claims/model/worksheetTypes';

export type PolicyOption = {
  id: string;
  policyNumber: string;
  insuredName: string;
};

export type DetailPolicyContext = {
  id: string;
  policyNumber: string;
  holderName: string;
  anchorTitle: string;
  premium: number;
  currency: string;
  coverageRows?: Array<{ coverage: string; limit: string; excess: string }>;
};

export type TabKey = 'overview' | 'activity' | 'exposure' | 'evidence' | 'communications' | 'deadlines';

export type AuditIndicator = {
  dotClass: string;
  title: string;
};

export type CreateCaseDraft = {
  policyId: string;
  reporterType: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  shortDescription: string;
  dateOfLoss: string;
  location: string;
  locationDetails: {
    address: string;
    city: string;
    state: string;
    zip: string;
    country?: string;
  } | null;
  insuredName: string;
};

export type ClaimsDeskDerivedState = {
  caseMode: boolean;
  hasMeaningfulIntakeData: boolean;
  awaitingFnolResponse: boolean;
  availableDevelopmentTypes: Array<{ value: DevelopmentType; label: string }>;
  visibleTabs: Array<{ id: TabKey; label: string }>;
  intakeStatusPill: string;
  auditIndicator: AuditIndicator;
};

export type ClaimsDeskContext = {
  worksheet: Worksheet | null;
  caseMode: boolean;
  hasMeaningfulIntakeData: boolean;
  awaitingFnolResponse: boolean;
};

