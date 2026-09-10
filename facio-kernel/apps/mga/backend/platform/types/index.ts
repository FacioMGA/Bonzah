// FacioMGA - TypeScript Type Definitions
// Core types for the Abbeygate 2025 Binder MVP

// ============================================================================
// PRICING TYPES
// ============================================================================

export type PremiumBasis = 'FIXED_COVERAGE' | 'HYBRID';
export type PricingRuleType = 'FIXED_COVERAGE' | 'HYBRID' | 'OVERRIDE';

export interface FixedCoverageConfig {
  fixedAmount: number;
  coverageTiers?: Array<{
    minCoverage: number;
    maxCoverage: number;
    amount: number;
  }>;
}

export interface HybridConfig {
  cohorts: Array<{
    name: string;
    criteria: Record<string, unknown>;
    rule: FixedCoverageConfig;
  }>;
  defaultRule: FixedCoverageConfig;
}

export interface OverrideConfig {
  amount: number;
  reason: string;
}

export type PricingRuleConfig =
  | FixedCoverageConfig
  | HybridConfig
  | OverrideConfig;

export interface PremiumCalculation {
  premium: number;
  basis: PremiumBasis;
  calculationDetails: {
    depositAmount?: number;
    percentage?: number;
    fixedAmount?: number;
    proRataFactor?: number;
    daysActive?: number;
    sumInsured?: number; // Added for PERCENT_OF_LIMIT
    /**
     * Step-by-step trace of the calculation. REQUIRED for all new products
     * (Motor/Home/Travel emit it); older entry-points may still produce
     * legacy calls with no steps — enforcement is via lint + strict env flag.
     */
    steps?: import('./pricing.js').CalculationStep[];
    /** Stable calculator version tag (`${product}@${semver}`). */
    calculatorVersion?: string;
  };
}

export interface PremiumAdjustment {
  originalPremium: number;
  adjustedPremium: number;
  adjustmentAmount: number;
  adjustmentDate: Date;
  reason: string;
}

export interface AuthorityLimits {
  maxUnits?: number;
  maxCoverage?: number;
  maxPremium?: number;
  requiresApproval?: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}

// ============================================================================
// INVOICING TYPES
// ============================================================================

export interface DateRange {
  start: Date;
  end: Date;
}

export interface ProRataCalculation {
  daysActive: number;
  daysInPeriod: number;
  proRataFactor: number;
  adjustedAmount: number;
}

export interface CommissionSplit {
  type: 'PERCENTAGE' | 'FIXED';
  value: number;
  recipients?: Array<{
    name: string;
    percentage: number;
  }>;
}

export interface InvoiceLineItemData {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  proRataDays?: number;
  proRataFactor?: number;
}

export interface InvoiceGenerationParams {
  billingPeriod: DateRange;
  includeDraft?: boolean;
}

// ============================================================================
// RECONCILIATION TYPES
// ============================================================================

export interface BankPayment {
  reference: string;
  amount: number;
  date: Date;
  method: 'ACH' | 'WIRE' | 'CHECK';
  description?: string;
}

export interface ReconciliationMatch {
  reconciliationId?: string;
  invoiceId: string;
  matchType: 'EXACT' | 'FUZZY' | 'PARTIAL' | 'EXCEPTION';
  matchedAmount: number;
  tolerance: number;
  confidence: number; // 0-1
  notes?: string;
}

export interface ReconciliationJournalEntry {
  reconciliationId: string;
  invoiceNumber: string;
  paymentReference: string;
  paymentAmount: number;
  matchedAmount: number;
  status: string;
  date: Date;
}

// ============================================================================
// DECLARATION TYPES
// ============================================================================

// Declarations/units types removed from the motor-only surface.

// ============================================================================
// CLAIMS TYPES
// ============================================================================

export interface ClaimSubmission {
  policyId: string;
  claimType: string;
  claimAmount: number;
  description: string;
  documents: Array<{
    type: string;
    fileUrl: string;
    fileName: string;
  }>;
  submittedBy: string;
}

export interface AdjudicationDecision {
  status: 'APPROVED' | 'QUERIED' | 'DECLINED';
  approvedAmount?: number;
  notes: string;
  adjudicatedBy: string;
}

export interface PaymentData {
  amount: number;
  paymentDate: Date;
  paymentMethod: string;
  reference?: string;
  notes?: string;
}

// ============================================================================
// SMART UW FORM TYPES
// ============================================================================

export interface SmartUwFormData {
  propertyInfo: {
    address: string;
    propertyType: string;
    numberOfUnits: number;
    yearBuilt?: number;
  };
  affordabilityRatio: number;
  tenantScreening: {
    creditCheck: boolean;
    incomeVerification: boolean;
    employmentVerification: boolean;
    referencesChecked: boolean;
  };
  evictionHistory: {
    hasEvictions: boolean;
    evictionCount: number;
    lastEvictionDate: string | null;
  };
  propertyCondition: string;
  riskAssessment: string;
  autoFilledFields: Record<string, unknown>;
  submittedAt: string;
  submittedBy: string;
}

// ============================================================================
// API TYPES
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface BordereauxParams {
  type: 'premium' | 'commissions' | 'cancellations';
  period: {
    start: Date;
    end: Date;
  };
  format: 'csv' | 'excel';
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type Decimal = number; // Decimal type for monetary values

export interface DateRange {
  start: Date;
  end: Date;
}

