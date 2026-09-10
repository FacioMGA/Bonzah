export type BdxEntryType = 'NB' | 'RNL' | 'CAN' | 'PAM' | 'NB/COC' | 'ADJ' | 'FIVA-PAM' | 'NTU';

/**
 * Entry types that legitimately open a policy term. Only these may become a
 * standalone Policy row. PAM/ADJ/FIVA-PAM/CAN/NTU are transaction lines on an
 * existing term and MUST be replayed as endorsements — importing them as base
 * policies is the 2026-07-30 incident root cause (ADR-0056).
 */
export const TERM_CREATING_BDX_ENTRIES: ReadonlySet<string> = new Set(['NB', 'NB/COC', 'RNL']);

export function isTermCreatingBdxEntry(entry: unknown): boolean {
  const normalized = String(entry || '').trim().toUpperCase();
  // Blank entry defaults to NB at the mapper boundary (`canonicalEntry`);
  // treat it as term-creating so entry-less product files keep importing.
  return !normalized || TERM_CREATING_BDX_ENTRIES.has(normalized);
}
export type BdxCoverType = 'Comp' | 'Tpo';
export type BdxVehicleUse = 'SDP' | 'Class 1' | 'Class 2' | 'Class 3';
export type BdxDriverMode = 'Named Drivers Only' | 'Any Driver Over 25' | 'Policy Holder';
export type BdxValidationStage = 'STRUCTURAL' | 'COMPLETENESS' | 'CALCULABILITY' | 'RECONCILIATION' | 'DOMAIN' | 'MAPPING';
export type BdxSeverity = 'Critical' | 'Warning' | 'Informational';
export type BdxRowResult = 'PASS' | 'FAIL';
export type BdxProductLine = 'motor' | 'travel' | 'home';
export type BdxImportFileType = 'xlsx' | 'csv';
export type BdxImportMode = 'dryRun' | 'commit';
export type BdxSystemProductType = 'MOTOR' | 'TRAVEL' | 'HOME';

export type BdxRawRow = Record<string, unknown> & {
  __sourceFile?: string;
  __sheetName?: string;
  __sheetRowNumber?: number;
  __sourceMonth?: string;
  __productLine?: BdxProductLine;
  __tenantSite?: string;
};

export type BdxRowDto = {
  sourceFile?: string;
  sourceSheetName: string;
  sourceMonth?: string;
  sourceRowNumber: number;
  productLine?: BdxProductLine;
  productType?: BdxSystemProductType;
  tenantSite?: string;
  sourceId: string;
  policyRef: string;
  rowKey: string;
  termKey?: string;
  policyChainKey: string;
  entry: string;
  insured: string;
  nif: string;
  endorsementRaw: string;
  bookedDate: string;
  inceptionDate: string;
  expiryDate: string;
  dateOfBirth: string;
  occupation: string;
  postcode: string;
  make: string;
  model: string;
  engineSize: number | null;
  ncbYears: number | null;
  claimProtection: string;
  vehicleValue: number | null;
  vehicleYear: number | null;
  registration: string;
  cover: string;
  excess: number | null;
  drivers: string;
  use: string;
  premiumPayable: number | null;
  grossPremium: number | null;
  mifPayable: number | null;
  stampPayable: number | null;
  commission: number | null;
  payableToArb: number | null;
  note: string;
  details: string;
  productData?: Record<string, unknown>;
  declared: {
    gross: number;
    commission: number;
    tax: number;
    fees: number;
    net: number;
    total: number;
  };
  parsedEndorsements: string[];
};

export type BdxGap = {
  rowId: string;
  policyRef: string;
  category: BdxValidationStage;
  severity: BdxSeverity;
  message: string;
  rootCauseHint?: string;
};

export type BdxValidationContext = {
  allowedEntries: Set<string>;
  allowedCover: Set<string>;
  allowedUse: Set<string>;
  allowedDrivers: Set<string>;
  knownEndorsementCodes: Set<string>;
  tolerances: {
    gross: number;
    commission: number;
    tax: number;
    fees: number;
    net: number;
    total: number;
  };
};

export type BdxCalculatedBreakdown = {
  gross: number;
  commission: number;
  tax: number;
  fees: number;
  net: number;
  total: number;
};

export type BdxMigrationCompliance = {
  state: 'PASS' | 'FAIL';
  reasonCodes: string[];
  grossDeltaAmount?: number;
  grossDeltaPct?: number;
  thresholdPct?: number;
  notes?: string[];
  appliedUwAdjustment?: {
    type: 'loading' | 'discount';
    mode: 'pct';
    value: number;
    amount: number;
    reason: string;
  };
};

export type BdxPolicyImportDisposition =
  | 'IMPORT_POLICY'
  | 'IMPORT_ENDORSEMENT'
  | 'IMPORT_RENEWAL'
  | 'SKIP_UNGROUPED_ROW';

export type BdxImportOutcomeStatus =
  | 'imported'
  | 'already_imported'
  | 'failed_with_reason'
  | 'skipped'
  | 'deferred_waiting_for_prior_row'
  | 'blocked_existing_history'
  | 'blocked_prior_row_failed'
  | 'blocked_transaction_row_without_base';

export type BdxRowEvaluation = {
  dto: BdxRowDto;
  rawRow?: BdxRawRow;
  result: BdxRowResult;
  calculated: BdxCalculatedBreakdown | null;
  deltas: BdxCalculatedBreakdown | null;
  gaps: BdxGap[];
  normalizedQuoteData?: Record<string, unknown>;
  productQuoteData?: Record<string, unknown>;
  appliedEndorsements?: Array<{ code: string; params?: unknown }>;
  migrationCompliance?: BdxMigrationCompliance;
  slugResolutions?: Array<{
    field: string;
    sourceValue: string;
    slug: string;
    productLine?: BdxProductLine;
    status: 'created' | 'requires_review';
    reason: string;
  }>;
  policyImportDisposition?: BdxPolicyImportDisposition;
  enrichment?: {
    profile: string;
    version: string;
    filledFields: string[];
    fieldSources?: Record<string, 'bdx' | 'derived' | 'default'>;
  };
};

export type BdxImportRequest = {
  sourceFilePath: string;
  sourceHash?: string;
  dryRun: boolean;
  productLine?: BdxProductLine;
  fileType?: BdxImportFileType;
  mode?: BdxImportMode;
  tenantHost?: string;
  operatingTenantId?: string;
  dryRunJobId?: string;
  startRow?: number;
  endRow?: number;
  tolerances?: Partial<BdxValidationContext['tolerances']>;
  importRunId?: string;
  accountId?: string | null;
  programId?: string | null;
  binderId?: string | null;
  /** Resolved server-side from the selected Program + Binder; never client input. */
  binderProductAuthorityId?: string | null;
  /**
   * Server-side resolver for imports spanning binder periods. It is injected
   * by the policy import worker and resolves the authority for each row's
   * inception/booked date; it is never accepted from HTTP input.
   */
  resolveBinderProductAuthorityId?: (dto: BdxRowDto) => Promise<string | null>;
};

export type BdxImportSummary = {
  totalRows: number;
  passRows: number;
  failRows: number;
  policyImportCandidateRows: number;
  endorsementReplayRows: number;
  renewalReplayRows: number;
  skippedDeltaRows: number;
  skippedBlankRows?: number;
  skippedAggregateRows?: number;
  skippedSupersededRows: number;
  importedRows: number;
  rejectedRows: number;
  generatedPolicyIds: string[];
  createdSlugCount?: number;
  missingSlugReviewCount?: number;
  failureReasonCounts?: Record<string, number>;
};

export type BdxImportResult = {
  runId: string;
  dryRun: boolean;
  sourceFilePath: string;
  sourceHash?: string;
  productLine?: BdxProductLine;
  fileType?: BdxImportFileType;
  tenantHost?: string;
  operatingTenantId?: string;
  summary: BdxImportSummary;
  evaluations: BdxRowEvaluation[];
  gapsByCategory: Record<BdxValidationStage, number>;
  outputs: {
    policyCreationSummary: {
      importedPolicyIds: string[];
      importedCount: number;
      rejectedCount: number;
    };
    reconciliationStatistics: {
      avgGrossDelta: number;
      avgCommissionDelta: number;
      avgTaxDelta: number;
      avgNetDelta: number;
      avgTotalDelta: number;
    };
    exceptionFile: Array<{
      rowId: string;
      policyRef: string;
      sourceSheetName?: string;
      sourceMonth?: string;
      sourceRowNumber?: number;
      termKey?: string;
      result: BdxRowResult;
      primaryGap: string;
    }>;
    importOutcomes: Array<{
      rowId: string;
      policyRef: string;
      policyChainKey: string;
      termKey?: string;
      sourceSheetName?: string;
      sourceMonth?: string;
      sourceRowNumber: number;
      status: BdxImportOutcomeStatus;
      policyId?: string;
      reason?: string;
    }>;
    enrichmentSummary: {
      profile: string;
      version: string;
      filledFieldCounts: Record<string, number>;
      sourceCounts?: Record<'bdx' | 'derived' | 'default', number>;
      createdSlugs?: Array<{
        field: string;
        sourceValue: string;
        slug: string;
        productLine?: BdxProductLine;
      }>;
      missingSlugsRequiringReview?: Array<{
        field: string;
        sourceValue: string;
        productLine?: BdxProductLine;
        reason: string;
      }>;
    };
    gapReport: {
      structural: BdxGap[];
      rating: BdxGap[];
      reconciliation: BdxGap[];
      domain: BdxGap[];
    };
  };
};
