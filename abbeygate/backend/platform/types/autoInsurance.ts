// Motor-specific type definitions. These types describe the motor (auto insurance) quote data shape.
// Future products will define their own QuoteData types in products/<productType>/types/.

import type { PolicyHolderProfile } from '@facio/products';

export interface PricingTaxBreakdown {
  code: string;
  amount: number;
  rate?: number;
  base?: number;
  rounding?: {
    mode: 'HALF_UP' | 'BANKERS' | 'EXCEL_COMPAT';
    precision: 2;
  };
}

/**
 * Phase 6k canonical motor `QuoteData`. Personal-details live
 * exclusively under `proposer: PolicyHolderProfile` — there is no flat
 * `firstName` / `email` / `telephone` / `country` etc. on the root.
 * The Prisma `canonicalize_motor_proposer` migration rewrites
 * pre-existing rows; the BE schema rejects flat-shape writes.
 */
/**
 * Driver coverage restriction (ABY-232 / ADR-0025). Canonical enum
 * that governs WHO is allowed to drive under the policy and is the
 * single source of truth for the named/open coverage split. Required
 * from the quote stage onward.
 *
 *   POLICYHOLDER_ONLY    — only the policyholder is authorised
 *   NAMED_DRIVERS        — policyholder + named additional drivers
 *   ANY_DRIVER_25_PLUS   — open authorised drivers, ages 25–70
 *   ANY_DRIVER_40_PLUS   — open authorised drivers, ages 40–70
 *
 * `driverPricingBasis` (NAMED_DRIVERS | OPEN_DRIVERS) is a derived
 * projection of this field — see
 * `backend/products/motor/pricing/factors/abbeygateFactors.ts:resolveDriverPricingBasis`.
 * Legacy quotes that pre-date ABY-232 carry no `driverRestriction`;
 * `MotorProductAdapter.normalize` fills it from `hasAdditionalDrivers`
 * for read-side back-compat.
 */
export type MotorDriverRestriction =
  | 'POLICYHOLDER_ONLY'
  | 'NAMED_DRIVERS'
  | 'ANY_DRIVER_25_PLUS'
  | 'ANY_DRIVER_40_PLUS';

export interface QuoteData {
  additionalDrivers?: AdditionalDriver[];
  /**
   * Canonical coverage restriction (see `MotorDriverRestriction`).
   * Optional on the type purely so the legacy adapter normalize step
   * can fill it; new writes must always supply it.
   */
  driverRestriction?: MotorDriverRestriction;
  /**
   * Derived projection of `driverRestriction`. Do not write directly
   * — `resolveDriverPricingBasis()` is the canonical accessor.
   */
  driverPricingBasis?: 'NAMED_DRIVERS' | 'OPEN_DRIVERS';
  uwAdjustmentPctCap?: number;
  // Step 1: Your Details (canonical nested shape)
  proposer: PolicyHolderProfile;

  // Step 2: Driving & History
  licenseYears: number | string;
  licenseType: string;
  licenseIssuedIn: string;
  licenseForeignDeclarationAccepted?: boolean | null;
  hasClaims: boolean;
  claimsDetails: string;
  claimsCountLast5Years: number | string;
  claimsTotalCostLast5Years: number | string;
  maxFaultClaimCostLast5Years: number | string;
  hasConvictions: boolean;
  convictionsDetails: string;
  hasMajorConvictionLast5Years: boolean | null;
  convictionClass: string;
  majorConvictionWithinYears: number | string;
  /**
   * ABY-232: UI signal that drives whether the named-drivers list is
   * collected — only meaningful when
   * `driverRestriction === 'NAMED_DRIVERS'`. For every other
   * `driverRestriction` value the wizard / BO controllers
   * cascade-clear this to `false` and `additionalDrivers` to `[]`.
   */
  hasAdditionalDrivers: boolean;
  youngestDriverAge: number | string;
  otherDriversClaims: boolean;
  otherDriversClaimsDetails: string;
  otherDriversConvictions: boolean;
  otherDriversConvictionsDetails: string;

  // Step 3: Vehicle & Cover
  vehicleLocation: string;
  coverRequired: string; // 'Comprehensive' | 'Third Party Liability'
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
  modified: boolean;
  modificationsDetails: string;
  parking: string;
  parkingOther: string;
  garageTotalValue: number | string;
  engineSize: number;
  /**
   * Battery capacity in kWh for EVs (5–400). Per ADR-0016, the canonical
   * EV capacity field. Required for EV rows by `step3.ts`; rejected for
   * ICE rows. Legacy stored EV records that pre-date PR 4 may carry no
   * `batteryKWh` value — `motorUwAutomation.ts` flags them as YELLOW
   * (`YELLOW.EV_BATTERY_KWH_MISSING`) on rerate / renewal so UW can
   * source the missing capacity before issuance.
   */
  batteryKWh?: number | null;
  vehicleValue: number;
  ncb: string; // No Claims Bonus
  protectNCB: boolean;
  vehicleUse: string;
  businessUseDetails: string;
  requiredExcess: string;
  ncdProofUpload?: string;
  homeInsuranceRenewalDate: string;
  infoTrueAndAccurate: boolean;
  fairProcessingAccepted: boolean;

  // Underwriting Adjustments
  uwAdjustment?: UwAdjustmentLineLegacy; // Legacy
  uwAdjustments?: UwAdjustmentLine[];
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
  stampDuty: number;
  policyFee: number;
  totalPremium: number;
  taxRows?: PricingTaxBreakdown[];
  taxProfileCode?: string;
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
    steps: Array<import('./pricing.js').CalculationStep>;
    calculatorVersion?: string;
    taxRows?: PricingTaxBreakdown[];
    taxProfileCode?: string;
  };
}

export interface QuoteResponse {
  reference: string;
  currency: string;
  primaryOption: QuoteOption;
  alternatives: QuoteOption[];
  warnings: string[];
  validUntil: string;
  status: 'quoted' | 'referral' | 'declined';
  referralMessage?: string;
}

export interface Coverage {
  id: string;
  name: string;
  type: 'BUILT_IN' | 'OPT_IN' | 'OPT_OUT';
  description: string;
  included: boolean;
  limit?: number | string;
  excess?: number;
  premium?: number;
}
