export const RENTAL_COVERAGE_CODES = ['CDW', 'RCLI', 'SLI', 'PAI_PEI'] as const;
export type RentalCoverageCode = (typeof RENTAL_COVERAGE_CODES)[number];

export const RENTAL_PROTECTION_PACKAGE_CODES = ['COMPLETE_AUTO_GUARD', 'COMPLETE_LIABILITY_GUARD'] as const;
export type RentalProtectionPackageCode = (typeof RENTAL_PROTECTION_PACKAGE_CODES)[number];
export const RENTAL_PROTECTION_PACKAGES: Record<RentalProtectionPackageCode, { label: string; description: string; coverages: RentalCoverageCode[] }> = {
  COMPLETE_AUTO_GUARD: { label: 'Complete Auto Guard', description: 'Rental vehicle and third-party liability protection.', coverages: ['CDW', 'RCLI'] },
  COMPLETE_LIABILITY_GUARD: { label: 'Complete Liability Guard', description: 'Primary and supplemental third-party liability protection.', coverages: ['RCLI', 'SLI'] },
};

export const RENTAL_VEHICLE_CLASSES = ['compact', 'sedan', 'suv'] as const;
export type RentalVehicleClass = (typeof RENTAL_VEHICLE_CLASSES)[number];

export const RENTAL_REPAIR_PROFILES = ['low', 'standard', 'high'] as const;
export type RentalRepairProfile = (typeof RENTAL_REPAIR_PROFILES)[number];

export const RENTAL_POWERTRAINS = ['combustion', 'hybrid', 'ev'] as const;
export type RentalPowertrain = (typeof RENTAL_POWERTRAINS)[number];

export type RentalQuoteStatus = 'QUOTED' | 'REFERRED' | 'DECLINED';
export type RentalExecutionMode = 'SIMULATION' | 'INSILLION';

export type RentalVehicleRisk = {
  id?: string;
  year: number;
  make: string;
  model: string;
  class: RentalVehicleClass;
  declaredValue: number;
  repairProfile: RentalRepairProfile;
  powertrain: RentalPowertrain;
  seats?: number;
  dailyRentalPrice?: number;
};

export type RentalRatingVehicle = Pick<RentalVehicleRisk, 'year' | 'make' | 'model' | 'class' | 'declaredValue' | 'repairProfile' | 'powertrain'> & {
  id?: string;
};

export type RentalRatingSourceSnapshot = {
  datasetVersion: string;
  effectiveDate: string;
  geographicResolution: 'STATE_SEASON';
  sources: {
    roadRisk: { name: 'NHTSA_FARS_FHWA_VMT'; version: string; methodology: 'FATAL_CRASH_SEVERITY_PROXY' };
    weather: { name: 'NOAA_STORM_EVENTS'; version: string };
    theft: { name: 'NHTSA_VEHICLE_THEFT'; version: string };
  };
  fallbacks: Array<{ factor: 'theft'; from: string; to: string; reason: string }>;
};

export type RentalRatingFactor = {
  code: 'DECLARED_VALUE' | 'REPAIR_PROFILE' | 'VEHICLE_CLASS' | 'POWERTRAIN' | 'THEFT' | 'ROAD_RISK' | 'SEASONAL_WEATHER' | 'RENTAL_USE';
  label: string;
  value: number;
  appliesTo: RentalCoverageCode[];
  explanation: string;
  sourceVersion?: string;
};

export type RentalQuoteRequest = {
  programId: string;
  channel: 'WEB' | 'API';
  effectiveDate: string;
  risk: {
    pickup: { country: 'US'; state: string; location?: string };
    residence: { country: 'US'; state: string };
    rentalStart: string;
    rentalEnd: string;
    driver: {
      age: number;
      licenceValid: boolean;
      additionalDriversListed: boolean;
      additionalDrivers?: Array<{ fullName: string; licenceNumber: string; licenceState: string }>;
    };
    rentalUse: 'PERSONAL' | 'COMMERCIAL' | 'RIDESHARE_OR_DELIVERY';
    vehicle: RentalRatingVehicle;
  };
  coverages: RentalCoverageCode[];
  packageCode?: RentalProtectionPackageCode;
};

export type RentalPricePreviewRequest = {
  pickup: { country: 'US'; state: string };
  rentalStart: string;
  rentalEnd: string;
  vehicle: RentalRatingVehicle;
  coverages: RentalCoverageCode[];
};

/**
 * Pre-quote coverage discovery. Answers "what may this renter buy, and why not
 * otherwise" before any coverage has been selected and before a quote identity
 * exists. The vehicle is optional: without it the renter-and-trip eligibility
 * gates still resolve, but no price is returned.
 */
export type RentalCoverageDiscoveryRequest = {
  pickup: { country: 'US'; state: string; location?: string };
  residence?: { country: 'US'; state: string };
  rentalStart: string;
  rentalEnd: string;
  driver: { age: number; licenceValid: boolean };
  rentalUse: 'PERSONAL' | 'COMMERCIAL' | 'RIDESHARE_OR_DELIVERY';
  vehicle?: RentalRatingVehicle;
};

export type RentalDiscoveredCoverage = {
  code: RentalCoverageCode;
  label: string;
  available: boolean;
  /** Populated only when `available` is false. */
  unavailableReason: string | null;
  /** Coverages that must also be selected for this one to be permitted. */
  requires: RentalCoverageCode[];
  limit: string;
  deductible: string;
  description: string;
  /** Present only when a vehicle was supplied and the risk is quotable. */
  indicativeDailyPrice: number | null;
  indicativeTripPrice: number | null;
};

export type RentalCoverageDiscoveryResponse = {
  eligibility: {
    status: RentalQuoteStatus;
    explanation: string;
    ruleReferences: string[];
    referralRequirements: string[];
  };
  chargedPeriods: number | null;
  coverages: RentalDiscoveredCoverage[];
  packages: Array<{ code: RentalProtectionPackageCode; label: string; description: string; coverages: RentalCoverageCode[]; available: boolean }>;
  /** Present only when a vehicle was supplied and the risk is quotable. */
  ratingSource: RentalRatingSourceSnapshot | null;
  fees: number;
  feeComponents: Array<{ code: 'INSURANCE_SERVICE_FEE'; label: string; amount: number }>;
  currency: 'USD';
  ruleVersion: string;
  warnings: string[];
  demoStatus: 'DEMO BUILD';
};

export type RentalCoveragePrice = {
  code: RentalCoverageCode;
  label: string;
  selected: boolean;
  dailyPrice: number;
  tripPrice: number;
  limit: string;
  deductible: string;
  description: string;
};

export type RentalPricePreviewResponse = {
  chargedPeriods: number;
  vehicleMultiplier: number;
  factors: RentalRatingFactor[];
  ratingSource: RentalRatingSourceSnapshot;
  coverages: RentalCoveragePrice[];
  subtotal: number;
  fees: number;
  feeComponents: Array<{ code: 'INSURANCE_SERVICE_FEE'; label: string; amount: number }>;
  tax: number;
  total: number;
  currency: 'USD';
  demoStatus: 'DEMO BUILD';
};

export type RentalQuoteResponse = {
  quoteId: string;
  riskSnapshot: RentalQuoteRequest['risk'];
  status: RentalQuoteStatus;
  message: string;
  customerExplanation: string[];
  ruleReferences: string[];
  ruleVersion: string;
  effectiveDate: string;
  expiresAt: string;
  chargedPeriods: number;
  vehicleMultiplier: number | null;
  factors: RentalRatingFactor[];
  ratingSource: RentalRatingSourceSnapshot | null;
  coverages: RentalCoveragePrice[];
  subtotal: number;
  fees: number;
  feeComponents: Array<{ code: 'INSURANCE_SERVICE_FEE'; label: string; amount: number }>;
  tax: number;
  total: number;
  currency: 'USD';
  warnings: string[];
  referralRequirements: string[];
  correlationId: string;
  integrityToken: string;
  demoStatus?: 'DEMO BUILD';
  executionMode?: RentalExecutionMode;
  providerValidationErrors?: string[];
  providerRates?: Partial<Record<RentalCoverageCode, string>>;
  package?: { code: RentalProtectionPackageCode; label: string; coverages: RentalCoverageCode[] };
};

export type RentalBindRequest = {
  integrityToken: string;
  payment: { provider: 'SIMULATED' | 'HOSTED'; token: string };
  expectedTotal?: number;
  policyholder: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    email: string;
    phone: string;
    address: { line1: string; line2?: string; city: string; state: string; postalCode: string; country: 'US' };
    licence: { number: string; state: string };
  };
  rentalAgreement: { rentalCompany: string; agencyEmail?: string };
  inspectionRecipient?: 'Renter' | 'Rental Agency';
  alternateEmail?: string;
  policyBookingTimeZone?: string;
  additionalDrivers?: Array<{ firstName: string; lastName: string; email: string; dateOfBirth: string; phone: string }>;
  rmsMetadata?: { reservationId?: string; reservationCreatedAt?: string; vehicleId?: string; vin?: string; mileageOut?: number; mileageIn?: number; licensePlate?: string; licenseState?: string; rentalContractReference?: string; purchasePaidAt?: string };
  consents: {
    electronicDelivery: true;
    termsAndPrivacyAccepted: true;
    exclusionsAccepted: true;
    truthfulnessAccepted: true;
    liabilityNoticeAccepted: boolean;
    wordingVersion: string;
    acceptedAt: string;
  };
};

export type RentalBindResponse = {
  confirmationId: string;
  quoteId: string;
  status: 'SIMULATED_CONFIRMED' | 'CONFIRMED';
  paymentStatus: 'SIMULATED_VERIFIED' | 'VERIFIED';
  confirmedAt: string;
  total: number;
  currency: 'USD';
  ruleVersion: string;
  demoStatus?: 'SIMULATED';
  executionMode?: RentalExecutionMode;
  providerReferences?: { quoteId?: string; quoteNumber?: string; paymentId?: string; policyId?: string; policyNumber?: string };
  documents?: Array<{ coverage: RentalCoverageCode; href: string }>;
};

export type RentalPolicyResponse = {
  policyId: string;
  policyNumber?: string;
  quoteId: string;
  paymentStatus: string;
  executionMode: RentalExecutionMode;
  coverages: RentalCoverageCode[];
  documents: Array<{ coverage: RentalCoverageCode; href: string }>;
  providerReferences?: RentalBindResponse['providerReferences'];
};

export type SummitVehicle = RentalVehicleRisk & {
  id: string;
  name: string;
  category: string;
  seats: number;
  bags: number;
  dailyRentalPrice: number;
  availability: 'AVAILABLE';
  accent: string;
};
