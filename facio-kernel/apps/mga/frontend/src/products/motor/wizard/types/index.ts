import type { PolicyHolderProfile } from '@facio/products';

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Phase 6k canonical motor `QuoteData`. The 16 personal-details keys
 * live exclusively under `proposer: PolicyHolderProfile` — there is
 * no flat `firstName` / `email` / `telephone` / `country` etc. on the
 * root. The Prisma `canonicalize_motor_proposer` migration rewrites
 * pre-existing rows; the BE schema rejects flat-shape writes.
 */
/**
 * Driver coverage restriction (ABY-232 / ADR-0025). See
 * `backend/platform/types/autoInsurance.ts` for the canonical doc
 * comment.
 */
export type MotorDriverRestriction =
  | 'POLICYHOLDER_ONLY'
  | 'NAMED_DRIVERS'
  | 'ANY_DRIVER_25_PLUS'
  | 'ANY_DRIVER_40_PLUS';

export interface QuoteData {
  driverRestriction?: MotorDriverRestriction | null;
  additionalDrivers?: AdditionalDriver[];
  motorConvictions?: MotorConvictionEntry[];
  proposer: PolicyHolderProfile;
  policyHolders?: PolicyHolderProfile[];
  licenseYears: number | string;
  licenseType: string;
  licenseIssuedIn: string;
  licenseForeignDeclarationAccepted?: boolean | null;
  hasClaims: boolean | null;
  claimsDetails: string;
  claimsCountLast5Years: number | string;
  claimsTotalCostLast5Years: number | string;
  maxFaultClaimCostLast5Years: number | string;
  hasConvictions: boolean | null;
  convictionsDetails: string;
  hasMajorConvictionLast5Years: boolean | null;
  convictionClass: string;
  majorConvictionWithinYears: number | string;
  seriousTechnicalOffenceCount?: number;
  majorConvictionsCountLast5Years?: number;
  hasAdditionalDrivers: boolean | null;
  youngestDriverAge: number | string;
  otherDriversClaims: boolean;
  otherDriversClaimsDetails: string;
  otherDriversConvictions: boolean;
  otherDriversConvictionsDetails: string;
  vehicleLocation: string;
  coverRequired: string;
  renewalDate: string;
  vehicleType: string;
  motorcycleRidersNamed: boolean | null;
  classicIsGenuine: boolean | null;
  classicIsSecondaryVehicle: boolean | null;
  make: string;
  model: string;
  cabrio: string;
  fuelType: string;
  kmsPerYear: string;
  year: number;
  countryOfRegistration: string;
  registrationNumber: string;
  vin: string;
  numberOfSeats: number;
  modified: boolean | null;
  modificationsDetails: string;
  parking: string;
  parkingOther: string;
  engineSize: number;
  /** Manufacturer maximum combined power in kW — required when fuelType === 'Electric'. */
  electricPowerKw?: number | null;
  vehicleValue: number;
  ncb: string;
  protectNCB: boolean;
  vehicleUse: string;
  requiredExcess: string;
  ncdProofUpload?: string;
  infoTrueAndAccurate: boolean;
  fairProcessingAccepted: boolean;

  /**
   * Customer follow-ups requested by underwriting (BO).
   * Stored on the policy `quoteData` so the public wizard can render them.
   */
  __followUpRequests?: Array<{
    id: string;
    fieldKey: string;
    question: string;
    note: string;
    type: string;
    stepKey?: 'policy-holder' | 'driving-history' | 'vehicle-cover' | 'your-quote' | 'issue-details' | 'payment' | '';
    requestedAt?: string;
  }>;
  /** Answers keyed by follow-up request id. */
  __followUpAnswers?: Record<string, string>;
  /** Misc non-rating metadata (server writes). */
  __meta?: Record<string, unknown>;
  // Underwriting Adjustments
  uwAdjustment?: UwAdjustmentLineLegacy;
  uwAdjustments?: UwAdjustmentLine[];
}

export interface MotorConvictionEntry {
  id?: string;
  date?: string;
  convictionClass?: string;
  description?: string;
}

export type UwAdjustmentLineType = 'pricing' | 'schedule_note';
export type UwAdjustmentKind = 'discount' | 'loading';
export type UwAdjustmentAmountType = 'pct' | 'amount';
export type UwAdjustmentScopeType = 'policy' | 'coverage';
export type UwAdjustmentScopeRef = 'TPL' | 'OWN_DAMAGE' | string;
export type UwScheduleNoteCategory = 'EXCLUSION' | 'SUB_LIMIT' | 'CONDITION_WARRANTY' | 'OTHER';
export type UwSchedulePresentation = 'inherent' | 'separate_line';

export interface UwAdjustmentLineLegacy {
  id?: string;
  name?: string;
  type: string;
  mode: string;
  value: number;
  reason: string;
}

export interface UwAdjustmentLine {
  id?: string;
  lineType?: UwAdjustmentLineType;
  name?: string;
  type?: UwAdjustmentKind | string;
  mode?: UwAdjustmentAmountType | string;
  value?: number;
  reason?: string;
  reasonText?: string;
  scopeType?: UwAdjustmentScopeType;
  scopeRef?: UwAdjustmentScopeRef;
  schedulePresentation?: UwSchedulePresentation;
  endorsementId?: string | null;
  category?: UwScheduleNoteCategory | string;
  text?: string;
}

export interface AdditionalDriver {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  licenseYears?: number | string;
  email?: string;
  telephone?: string;
}

export interface PremiumBreakdown {
  // TPL Module
  tplBase: number;
  tplClaimsFactor: number;
  tplMileageFactor: number;
  tplLicenseFactor: number;
  tplFinal: number;

  // Comprehensive Module
  compBase: number;
  compAgeFactor: number;
  compClaimsFactor: number;
  compExcessFactor: number;
  compLicenseFactor: number;
  compFinal: number;

  // Extras
  windscreen: number;

  // Additional Drivers (youngest driver age factor)
  youngestDriverAge?: number;
  additionalDriversUnder25Factor?: number;

  // Total
  finalPremium: number;
}

export interface BreakdownCost {
  grossPremium: number;
  ncdAmount: number;
  onlineDiscount: number;
  subtotalNetPremiumBeforeUwAdj?: number;
  uwAdjustmentAmount?: number;
  subtotalNetPremium: number;
  mifSurcharge: number;
  tax: number;
  policyFee: number;
  totalPremium: number;
}

export interface QuoteOption {
  name: string;
  annualPremium: number;
  monthlyPremium?: number;
  compulsoryExcess?: number;
  voluntaryExcess?: number;
  totalExcess: number;
  tag?: string;
  description?: string;
  breakdown?: PremiumBreakdown;
  costDetails?: BreakdownCost;
  calculationTrace?: {
    steps: Array<{
      id: string;
      name: string;
      kind: 'table_lookup' | 'factor' | 'fee' | 'subtotal' | 'total';
      inputs?: Record<string, unknown>;
      factor?: number;
      amount?: number;
      output?: number;
      notes?: string;
    }>;
  };
}

export interface QuoteResponse {
  reference: string;
  currency: string;
  primaryOption: QuoteOption;
  alternatives: QuoteOption[];
  // AI Recommendations
  recommendations?: Array<{
    bundleId: string;
    excess: number;
    claimProtection: boolean;
    probability: number;
  }>;
  warnings: string[];
  validUntil: string;
  status: 'quoted' | 'referral' | 'declined';
  referralMessage?: string;
}
