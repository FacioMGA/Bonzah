// Lloyd's CRS v5.2 — Motor canonical types.
// Re-exported by `../crsV52Motor.ts` so all existing consumers
// (`crsV52Home.ts`, `crsV52Travel.ts`, `bordereaux/lloydsV52/*`,
// the lineage generator) continue to import from the same path.

import type { QuoteData, QuoteResponse } from '../../../../platform/types/autoInsurance.js';

export type CsrStream = 'risk' | 'premium' | 'claims';
export type CsrRequiredness = 'mandatory' | 'conditional' | 'optional';
export type CsrValidationSeverity = 'error' | 'warning' | 'info';
export type CsrSourceReliability = 'high' | 'medium' | 'fragile';
export type CsrSourceKind = 'typed_column' | 'json_snapshot' | 'derived_projection' | 'constant' | 'computed';

export type CsrColumnSpec<RowCtx> = {
  key: string;
  title: string;
  required?: boolean;
  crCode?: string;
  lloydsDefinition?: string;
  plainEnglishNote?: string;
  requiredness?: CsrRequiredness;
  validationSeverity?: CsrValidationSeverity;
  sourceReliability?: CsrSourceReliability;
  sourceEntity?: string;
  sourceField?: string;
  sourcePath?: string;
  sourceKind?: CsrSourceKind;
  authoritativeSource?: boolean;
  derivationRule?: string;
  fallbackRule?: string;
  applicabilityKey?: string;
  get: (ctx: RowCtx) => unknown;
};

export type RiskRowCtx = {
  binder?: Record<string, unknown>;
  policy: Record<string, unknown>;
  policyHolder: Record<string, unknown>;
  riskTransaction?: Record<string, unknown>;
  quoteData: Partial<QuoteData>;
  quoteResponse: Partial<QuoteResponse>;
};

export type PremiumRowCtx = {
  binder?: Record<string, unknown>;
  policy: Record<string, unknown>;
  policyHolder: Record<string, unknown>;
  riskTransaction?: Record<string, unknown>;
  premiumTransaction?: Record<string, unknown>;
  quoteResponse: Partial<QuoteResponse>;
};

export type ClaimsRowCtx = {
  binder?: Record<string, unknown>;
  policy: Record<string, unknown>;
  policyHolder: Record<string, unknown>;
  claim: Record<string, unknown>;
  financials: {
    paidThisPeriodIndemnity: number;
    paidThisPeriodFees: number;
    previouslyPaidIndemnity: number;
    previouslyPaidFees: number;
    reserveIndemnityAtEnd: number;
    reserveFeesAtEnd: number;
    totalIncurredIndemnity: number;
    totalIncurredFees: number;
    totalIncurredOverall: number;
    recoveriesReceivedToDate: number;
    recoveriesExpectedAtEnd: number;
  };
  status: string;
  referredToUw: 'Y' | 'N';
  denial: 'Y' | 'N';
};
