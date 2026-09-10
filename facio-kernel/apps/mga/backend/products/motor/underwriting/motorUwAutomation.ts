import type { QuoteData } from '../../../platform/types/autoInsurance.js';
import { matchLocalMarketNationalityReferral } from '@facio/products';
import { z } from 'zod';
import { asRecord } from '../pricing/factors/abbeygateFactors.js';

export type UwAutomationOutcome = 'accept' | 'referral' | 'decline';

export type UwTriggerLane = 'red' | 'yellow';

export type UwTrigger = {
  lane: UwTriggerLane;
  ruleId: string;
  message: string;
  fields: string[];
};

export type MotorUwConfig = {
  allowedRiskCountries: string[];
  allowedVehicleUses: string[]; // standard uses that qualify for STP
  supportedVehicleTypeTokens: string[];
  motorcycleAllowedVehicleUses: string[];
  motorcycleAllowedCoverRequired: string[];
  motorcycleDisallowedDriverRestrictions: string[];
  referralFlags: {
    referElectricVehicles: boolean;
    referHybridVehicles: boolean;
    referMotorcycle: boolean;
    referMotorcaravan: boolean;
  };
  thresholds: {
    declineVehicleValueOver: number; // 250k
    declineGarageTotalValueOver: number; // 250k
    declineClaimsCountOver5Years: number; // >3
    declineFaultClaimOver: number; // >100k
    declineLicenceYearsUnder: number; // <1
    declineAddedDriverAgeUnder: number; // <21
    declineMotorcycleRiderAgeUnder: number; // <25
    declineMotorcycleOverCcRequiresNcdCc: number; // >200

    referralVehicleValueOver: number; // >80k
    referralFaultClaimOver: number; // >50k
    referralClaimsCountAtLeast: number; // >=2
    referralClaimsTotalUnder: number; // <50k
    referralAddedDriverAgeMin: number; // 22
    referralAddedDriverAgeMax: number; // 24
    referralMotorcaravanValueOver: number; // >30k
    referralMotorcaravanKmsOver: number; // >30,000 km/year
    referralProposerAgeUnder: number;
    referralStpAgeUnder: number;
    referralStpLicenceYearsAtMost: number;
    referralSeatsOver: number;
    referralClassicVehicleValueOver: number;
    referralSeriousTechnicalConvictionsAtLeast: number;
  };
};

export interface UwAutomationDecision {
  outcome: UwAutomationOutcome;
  lane: 'green' | 'yellow' | 'red';
  reasons: string[];
  triggers?: UwTrigger[];
  config?: MotorUwConfig;
}

type UwReasonBucket = 'decline' | 'referral';

function dateOnly(value: string): Date | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, monthIndex, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== monthIndex ||
      parsed.getUTCDate() !== day
    ) {
      return null;
    }
    return parsed;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getAge(dobString: string, referenceDateString: string): number | null {
  const birthDate = dateOnly(dobString);
  const referenceDate = dateOnly(referenceDateString);
  if (!birthDate || !referenceDate) return null;
  let age = referenceDate.getUTCFullYear() - birthDate.getUTCFullYear();
  const m = referenceDate.getUTCMonth() - birthDate.getUTCMonth();
  if (m < 0 || (m === 0 && referenceDate.getUTCDate() < birthDate.getUTCDate())) age--;
  return age;
}

function ncdIsNone(ncb: string): boolean {
  const v = String(ncb || '').toLowerCase().trim();
  return v === '' || v === 'none' || v === '0' || v.includes('no claims') && v.includes('0');
}

function toNumberOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function isMotorcaravanType(vehicleType: unknown): boolean {
  const normalized = String(vehicleType || '').toLowerCase();
  return normalized.includes('motorcaravan') || normalized.includes('motorhome') || normalized.includes('caravan');
}

const nonEmptyStringArray = z.array(z.string().trim().min(1)).min(1);

export const MotorUwConfigSchema = z.object({
  allowedRiskCountries: nonEmptyStringArray,
  allowedVehicleUses: nonEmptyStringArray,
  supportedVehicleTypeTokens: nonEmptyStringArray,
  motorcycleAllowedVehicleUses: nonEmptyStringArray,
  motorcycleAllowedCoverRequired: nonEmptyStringArray,
  motorcycleDisallowedDriverRestrictions: z.array(z.string().trim().min(1)),
  referralFlags: z.object({
    referElectricVehicles: z.boolean(),
    referHybridVehicles: z.boolean(),
    referMotorcycle: z.boolean(),
    referMotorcaravan: z.boolean(),
  }).strict(),
  thresholds: z.object({
    declineVehicleValueOver: z.number().finite().nonnegative(),
    declineGarageTotalValueOver: z.number().finite().nonnegative(),
    declineClaimsCountOver5Years: z.number().finite().nonnegative(),
    declineFaultClaimOver: z.number().finite().nonnegative(),
    declineLicenceYearsUnder: z.number().finite().nonnegative(),
    declineAddedDriverAgeUnder: z.number().finite().nonnegative(),
    declineMotorcycleRiderAgeUnder: z.number().finite().nonnegative(),
    declineMotorcycleOverCcRequiresNcdCc: z.number().finite().nonnegative(),
    referralVehicleValueOver: z.number().finite().nonnegative(),
    referralFaultClaimOver: z.number().finite().nonnegative(),
    referralClaimsCountAtLeast: z.number().finite().nonnegative(),
    referralClaimsTotalUnder: z.number().finite().nonnegative(),
    referralAddedDriverAgeMin: z.number().finite().nonnegative(),
    referralAddedDriverAgeMax: z.number().finite().nonnegative(),
    referralMotorcaravanValueOver: z.number().finite().nonnegative(),
    referralMotorcaravanKmsOver: z.number().finite().nonnegative(),
    referralProposerAgeUnder: z.number().finite().nonnegative(),
    referralStpAgeUnder: z.number().finite().nonnegative(),
    referralStpLicenceYearsAtMost: z.number().finite().nonnegative(),
    referralSeatsOver: z.number().finite().nonnegative(),
    referralClassicVehicleValueOver: z.number().finite().nonnegative(),
    referralSeriousTechnicalConvictionsAtLeast: z.number().finite().nonnegative(),
  }).strict(),
}).strict();

export class MotorUwConfigurationError extends Error {
  readonly code = 'MOTOR_UW_CONFIGURATION_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'MotorUwConfigurationError';
  }
}

export function parseMotorUwConfig(value: unknown): MotorUwConfig {
  const parsed = MotorUwConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new MotorUwConfigurationError(
      `Motor underwriting configuration is incomplete or invalid: ${parsed.error.issues.map((issue) => issue.path.join('.') || issue.message).join(', ')}`,
    );
  }
  return parsed.data;
}

/**
 * Motor Scheme underwriting evaluation.
 *
 * IMPORTANT: If a required input for a rule is missing, we default to REFERRAL
 * rather than silently quoting. That keeps automation safe.
 */
export function evaluateConfiguredMotorUwAutomation(quoteData: QuoteData, config: unknown): UwAutomationDecision {
  return evaluateMotorUwWithConfig(quoteData, parseMotorUwConfig(config));
}

function evaluateMotorUwWithConfig(quoteData: QuoteData, cfg: MotorUwConfig): UwAutomationDecision {
  const reasonsDecline: string[] = [];
  const reasonsReferral: string[] = [];
  const triggers: UwTrigger[] = [];

  const push = (lane: UwTriggerLane, ruleId: string, message: string, fields: string[], bucket?: UwReasonBucket) => {
    triggers.push({ lane, ruleId, message, fields });
    const target = bucket || (lane === 'red' ? 'decline' : 'referral');
    if (target === 'decline') reasonsDecline.push(message);
    else reasonsReferral.push(message);
  };

  const allowedRiskCountries = new Set(cfg.allowedRiskCountries);
  const allowedVehicleUses = new Set(cfg.allowedVehicleUses);

  const age = getAge(quoteData.proposer?.dateOfBirth ?? '', quoteData.renewalDate);
  const licenseYears = toNumberOrNull(quoteData.licenseYears);
  const youngestDriverAge = toNumberOrNull(quoteData.youngestDriverAge);
  const engineSize = toNumberOrNull(quoteData.engineSize) ?? 0;
  const vehicleValue = toNumberOrNull(quoteData.vehicleValue) ?? 0;
  // ADR-0102: Electric vehicles use manufacturer maximum combined power in
  // kW. Records without it are referred so the real value is sourced before
  // rerate, renewal, or issuance; no value is inferred or defaulted.
  const fuelType = String(quoteData.fuelType || '').trim();
  const isElectric = fuelType === 'Electric';
  const isHybrid = fuelType === 'Hybrid';
  const electricPowerKw = toNumberOrNull(quoteData.electricPowerKw);
  const electricMissingPowerKw = isElectric && (electricPowerKw === null || electricPowerKw <= 0);

  const claimsCount = toNumberOrNull(quoteData.claimsCountLast5Years);
  const claimsTotalCost = toNumberOrNull(quoteData.claimsTotalCostLast5Years);
  const maxFaultClaimCost = toNumberOrNull(quoteData.maxFaultClaimCostLast5Years);
  const hasMajorConviction = quoteData.hasMajorConvictionLast5Years;
  const garageTotalValue = toNumberOrNull(quoteData.garageTotalValue);

  const riskCountry = String(quoteData.countryOfRegistration || quoteData.vehicleLocation || '').trim();

  // Abbeygate is an expat broker: same-market nationals are outside online
  // Motor appetite. Cross-territory operating nationals remain expats.
  // Canonical matcher lives in @facio/products — do not re-state aliases.
  const proposerNationality = asRecord(quoteData.proposer).nationality;
  const localNational = matchLocalMarketNationalityReferral(proposerNationality, riskCountry);
  if (localNational) {
    push(
      'yellow',
      'YELLOW.LOCAL_MARKET_NATIONALITY_REFERRAL',
      `Proposer of ${localNational.demonym} nationality requires referral before any quotation is issued.`,
      ['proposer.nationality'],
    );
  }

  const isMotorcycle = String(quoteData.vehicleType || '').toLowerCase().includes('motorbike') || String(quoteData.vehicleType || '').toLowerCase().includes('motorcycle');
  const isMotorcaravan = isMotorcaravanType(quoteData.vehicleType);
  const isClassic = String(quoteData.vehicleType || '').toLowerCase().includes('classic');
  const classicIsGenuine = quoteData.classicIsGenuine;
  const classicIsSecondaryVehicle = quoteData.classicIsSecondaryVehicle;

  if (cfg.referralFlags.referElectricVehicles && isElectric) {
    push(
      'yellow',
      'YELLOW.EV_REFERRAL',
      'Electric vehicle requires referral to our underwriters.',
      ['fuelType'],
    );
  }

  if (cfg.referralFlags.referHybridVehicles && isHybrid) {
    push(
      'yellow',
      'YELLOW.HYBRID_REFERRAL',
      'Hybrid vehicle requires referral to our underwriters.',
      ['fuelType'],
    );
  }

  if (cfg.referralFlags.referMotorcycle && isMotorcycle) {
    push(
      'yellow',
      'YELLOW.MOTORCYCLE_REFERRAL',
      'Motorcycle requires referral to our underwriters.',
      ['vehicleType'],
    );
  }

  if (cfg.referralFlags.referMotorcaravan && isMotorcaravan) {
    push(
      'yellow',
      'YELLOW.MOTORCARAVAN_REFERRAL',
      'Motorhome / Motor Caravan requires referral to our underwriters.',
      ['vehicleType'],
    );
  }

  // --- Red lane (auto-decline / no quote) ---

  // 1. Risks outside the programme's configured territory scope.
  if (riskCountry && !allowedRiskCountries.has(riskCountry)) {
    push('red', 'RED.COUNTRY_NOT_ALLOWED', 'Risk country is outside the programme territory scope.', ['country', 'countryOfRegistration', 'vehicleLocation']);
  }

  // 2. Vehicle value exceeding €250,000 (Hard Stop)
  if (vehicleValue > cfg.thresholds.declineVehicleValueOver) {
    push('red', 'RED.VEHICLE_VALUE_OVER_CAP', `Vehicle value exceeds €${cfg.thresholds.declineVehicleValueOver.toLocaleString()}.`, ['vehicleValue']);
  }

  // 3. Garage total value exceeding €250,000
  if (garageTotalValue !== null && garageTotalValue > cfg.thresholds.declineGarageTotalValueOver) {
    push('red', 'RED.GARAGE_VALUE_OVER_CAP', `Garage total value exceeds €${cfg.thresholds.declineGarageTotalValueOver.toLocaleString()}.`, ['garageTotalValue', 'parking']);
  }

  // 4. Motor vehicles with more than 3 claims in the last 5 years
  if (quoteData.hasClaims) {
    if (claimsCount === null) {
      push('yellow', 'YELLOW.CLAIMS_COUNT_MISSING', 'Claims count missing (required for automation).', ['claimsCountLast5Years']);
    } else if (claimsCount > cfg.thresholds.declineClaimsCountOver5Years) {
      push('red', 'RED.CLAIMS_COUNT_OVER_3', `More than ${cfg.thresholds.declineClaimsCountOver5Years} claims in the last 5 years.`, ['claimsCountLast5Years']);
    }

    // 5. Fault claims exceeding €100,000
    if (maxFaultClaimCost !== null && maxFaultClaimCost > cfg.thresholds.declineFaultClaimOver) {
      push('red', 'RED.FAULT_CLAIM_OVER_100K', `Fault claim exceeds €${cfg.thresholds.declineFaultClaimOver.toLocaleString()}.`, ['maxFaultClaimCostLast5Years']);
    }
  }

  // 6. Drivers without a full licence held for at least 1 year
  if (String(quoteData.licenseType || '') !== 'Full') {
    push('red', 'RED.LICENCE_NOT_FULL', 'Driver does not hold a full licence.', ['licenseType']);
  }
  if (licenseYears !== null && licenseYears < cfg.thresholds.declineLicenceYearsUnder) {
    push('red', 'RED.LICENCE_YEARS_UNDER_1', `Full licence held for less than ${cfg.thresholds.declineLicenceYearsUnder} year.`, ['licenseYears']);
  }

  // 7. Added drivers aged under 21
  if (quoteData.hasAdditionalDrivers) {
    if (youngestDriverAge !== null && youngestDriverAge < cfg.thresholds.declineAddedDriverAgeUnder) {
      push('red', 'RED.AAD_UNDER_21', `Added driver is under ${cfg.thresholds.declineAddedDriverAgeUnder}.`, ['youngestDriverAge']);
    }
  }

  // ABY-232 / ADR-0025: open-driver coverage restriction sanity
  // check. If the policy is on `ANY_DRIVER_25_PLUS` /
  // `ANY_DRIVER_40_PLUS` and the proposer themselves is below the
  // restriction's minimum age, the policy cannot legitimately bind
  // open driving. Flag as yellow so an underwriter can confirm the
  // coverage basis before issuance.
  {
    const restriction = (quoteData as { driverRestriction?: string }).driverRestriction;
    const minAge = restriction === 'ANY_DRIVER_25_PLUS' ? 25 : restriction === 'ANY_DRIVER_40_PLUS' ? 40 : null;
    if (minAge !== null && age !== null && age < minAge) {
      push(
        'yellow',
        'YELLOW.OPEN_DRIVER_PROPOSER_UNDER_RESTRICTION',
        `Open-driver coverage (${restriction}) requires drivers aged ${minAge}+ — the proposer is ${age}.`,
        ['driverRestriction', 'proposer.dateOfBirth'],
      );
    }
  }

  // Proposers below the programme's referral age require a referral. Motorbike
  // risks have their own configured decline threshold below.
  if (
    age !== null &&
    age < cfg.thresholds.referralProposerAgeUnder &&
    !(String(quoteData.vehicleType || '').toLowerCase().includes('motorbike') ||
      String(quoteData.vehicleType || '').toLowerCase().includes('motorcycle'))
  ) {
    push(
      'yellow',
      'YELLOW.PROPOSER_UNDER_25',
      `Proposer is under ${cfg.thresholds.referralProposerAgeUnder} — requires underwriter referral per programme.`,
      ['dateOfBirth'],
    );
  }

  // 8. Motorcycles: scheme eligibility — all rules are hard no-quote per UW authority
  if (isMotorcycle) {
    // Rider under 25 (main or added) — no quote per UW notes
    if (age !== null && age < cfg.thresholds.declineMotorcycleRiderAgeUnder) {
      push('red', 'RED.MOTORCYCLE_RIDER_UNDER_25', `Main rider is under ${cfg.thresholds.declineMotorcycleRiderAgeUnder} for a motorcycle risk.`, ['dateOfBirth']);
    }
    if (quoteData.hasAdditionalDrivers && youngestDriverAge !== null && youngestDriverAge < cfg.thresholds.declineMotorcycleRiderAgeUnder) {
      push('red', 'RED.MOTORCYCLE_RIDER_UNDER_25_AAD', `A named rider is under ${cfg.thresholds.declineMotorcycleRiderAgeUnder} for a motorcycle risk.`, ['youngestDriverAge']);
    }

    // Motorcycles above the configured engine threshold with no NCD are
    // declined under this programme.
    if (engineSize > cfg.thresholds.declineMotorcycleOverCcRequiresNcdCc && ncdIsNone(quoteData.ncb)) {
      push('red', 'RED.MOTORCYCLE_OVER_200CC_NO_NCD', `Motorcycle over ${cfg.thresholds.declineMotorcycleOverCcRequiresNcdCc}cc with no No Claims Discount evidence.`, ['engineSize', 'ncb']);
    }

    // Motorcycle cover basis is programme-authoritative.
    if (!cfg.motorcycleAllowedCoverRequired.includes(String(quoteData.coverRequired || '').trim())) {
      push('red', 'RED.MOTORCYCLE_NON_COMPREHENSIVE_COVER', 'Motorcycle cover basis is outside the programme scope.', ['coverRequired']);
    }

    // Motorcycle permitted uses are programme-authoritative.
    const motorcycleUse = String(quoteData.vehicleUse || '').trim();
    if (motorcycleUse && !cfg.motorcycleAllowedVehicleUses.includes(motorcycleUse)) {
      push('red', 'RED.MOTORCYCLE_USE_NOT_SDP', 'Motorcycle vehicle use is outside the programme scope.', ['vehicleUse']);
    }

    // Named riders only — open-rider policies are not available on this scheme
    if (quoteData.motorcycleRidersNamed === false) {
      push('red', 'RED.MOTORCYCLE_RIDERS_NOT_NAMED', 'Motorcycle risks require all riders to be named on the policy.', ['motorcycleRidersNamed']);
    }

    // ABY-324 — motorbikes are insured-only (policyholder) or named-rider
    // only. The open "any driver" coverage modes are not available, so a
    // policy carrying one cannot bind and must not auto-quote.
    const motorcycleRestriction = (quoteData as { driverRestriction?: string }).driverRestriction;
    if (cfg.motorcycleDisallowedDriverRestrictions.includes(String(motorcycleRestriction || ''))) {
      push('red', 'RED.MOTORCYCLE_OPEN_DRIVER_NOT_ALLOWED', 'Motorcycle risks must be insured-only or named-rider only — open driver coverage is not available.', ['driverRestriction']);
    }
    if (quoteData.motorcycleRidersNamed === null || quoteData.motorcycleRidersNamed === undefined) {
      push('yellow', 'YELLOW.MOTORCYCLE_RIDERS_NAMED_UNKNOWN', 'Whether motorcycle riders are named has not been confirmed — requires underwriter review.', ['motorcycleRidersNamed']);
    }

  }

  // 9. Seats exceeding the programme maximum.
  const numberOfSeats = toNumberOrNull(quoteData.numberOfSeats);
  if (numberOfSeats !== null && numberOfSeats > cfg.thresholds.referralSeatsOver) {
    push('yellow', 'YELLOW.SEATS_OVER_15', `Vehicle exceeds the programme maximum of ${cfg.thresholds.referralSeatsOver} seats (including driver) — requires underwriter review.`, ['numberOfSeats']);
  }

  // 10. Unsupported Vehicle Classes
  const vehicleTypeRaw = String(quoteData.vehicleType || '').trim().toLowerCase();
  const supported = cfg.supportedVehicleTypeTokens.some((token) => vehicleTypeRaw.includes(token.toLowerCase()));
  if (vehicleTypeRaw && !supported) {
    push('red', 'RED.VEHICLE_CLASS_OUTSIDE_SCHEME', 'Vehicle type is outside scheme classes.', ['vehicleType']);
  }


  // --- Yellow lane (referral) ---

  // 1. Major Conviction within 5 Years
  if (quoteData.hasConvictions && hasMajorConviction) {
    push('yellow', 'YELLOW.MAJOR_CONVICTION', 'Major conviction within last 5 years.', ['hasMajorConvictionLast5Years']);
  }

  // 1a. Serious technical convictions above the programme threshold require referral.
  if (quoteData.hasConvictions && String(quoteData.convictionClass || '') === 'serious_technical') {
    const qdExtra = asRecord(quoteData);
    const seriousCount = Number(qdExtra.seriousTechnicalOffenceCount ?? qdExtra.seriousTechnicalOffencesCount ?? qdExtra.seriousTechnicalConvictionCount ?? 0);
    if (Number.isFinite(seriousCount) && seriousCount >= cfg.thresholds.referralSeriousTechnicalConvictionsAtLeast) {
      push('yellow', 'YELLOW.SERIOUS_TECHNICAL_MULTIPLE', `${cfg.thresholds.referralSeriousTechnicalConvictionsAtLeast} or more serious technical convictions — requires underwriter review.`, ['convictionClass']);
    }
  }

  // 2. Fault claim > 50k (but < 100k which is red)
  if (quoteData.hasClaims && maxFaultClaimCost !== null && maxFaultClaimCost > cfg.thresholds.referralFaultClaimOver) {
    push('yellow', 'YELLOW.FAULT_CLAIM_OVER_50K', `Fault claim over €${cfg.thresholds.referralFaultClaimOver.toLocaleString()}.`, ['maxFaultClaimCostLast5Years']);
  }

  // 3. Claims count >= 2 total under 50k
  if (claimsCount !== null && claimsCount >= cfg.thresholds.referralClaimsCountAtLeast && (claimsTotalCost === null || claimsTotalCost < cfg.thresholds.referralClaimsTotalUnder)) {
    push('yellow', 'YELLOW.CLAIMS_MULTIPLE', `Two or more claims in history.`, ['claimsCountLast5Years']);
  }

  // 4. Added-driver age within the configured referral band.
  if (quoteData.hasAdditionalDrivers && youngestDriverAge !== null && youngestDriverAge >= cfg.thresholds.referralAddedDriverAgeMin && youngestDriverAge <= cfg.thresholds.referralAddedDriverAgeMax) {
    push('yellow', 'YELLOW.AAD_22_24', `Added driver aged ${cfg.thresholds.referralAddedDriverAgeMin}–${cfg.thresholds.referralAddedDriverAgeMax}.`, ['youngestDriverAge']);
  }

  // 5. Value > 80k (but < 250k which is red)
  if (vehicleValue > cfg.thresholds.referralVehicleValueOver) {
    push('yellow', 'YELLOW.VEHICLE_VALUE_OVER_80K', `Vehicle value over €${cfg.thresholds.referralVehicleValueOver.toLocaleString()}.`, ['vehicleValue']);
  }

  if (electricMissingPowerKw) {
    push(
      'yellow',
      'YELLOW.EV_POWER_KW_MISSING',
      'Electric vehicle is missing manufacturer maximum combined power (kW) (ADR-0102) and requires underwriter review before issuance / rerate.',
      ['fuelType', 'electricPowerKw'],
    );
  }

  if (isClassic && vehicleValue > cfg.thresholds.referralClassicVehicleValueOver) {
    push('yellow', 'YELLOW.CLASSIC_VALUE_OVER_60K', `Classic vehicle value exceeds €${cfg.thresholds.referralClassicVehicleValueOver.toLocaleString()} and requires underwriter review.`, ['vehicleValue']);
  }

  if (isClassic && classicIsGenuine !== true) {
    push('yellow', 'YELLOW.CLASSIC_GENUINE_REQUIRED', 'Classic risk must be marked as a genuine classic vehicle.', ['classicIsGenuine']);
  }

  if (isClassic && classicIsSecondaryVehicle !== true) {
    push('yellow', 'YELLOW.CLASSIC_SECONDARY_REQUIRED', 'Classic risk must be marked as a secondary household vehicle.', ['classicIsSecondaryVehicle']);
  }

  // 6. Motorcaravan value > 30k
  if (isMotorcaravan && vehicleValue > cfg.thresholds.referralMotorcaravanValueOver) {
    push('yellow', 'YELLOW.MOTORCARAVAN_OVER_30K', `Motorcaravan value over €${cfg.thresholds.referralMotorcaravanValueOver.toLocaleString()}.`, ['vehicleValue']);
  }

  // 6a. Motorcaravan annual mileage > 30,000 km — the rate table only bands
  // up to "Over 30,000" km/year; above that the risk is non-standard and must
  // be referred for an underwriter to load it manually. The "Over 30,000"
  // band itself represents mileage strictly above 30,000 km/year.
  if (isMotorcaravan) {
    const kmsRaw = String(quoteData.kmsPerYear || '').toLowerCase();
    const kmsOverBand = kmsRaw.includes('over');
    const kmsValue = toNumberOrNull(kmsRaw.replace(/[^0-9]/g, ''));
    if (kmsOverBand || (kmsValue !== null && kmsValue > cfg.thresholds.referralMotorcaravanKmsOver)) {
      push('yellow', 'YELLOW.MOTORCARAVAN_KM_OVER_30K', `Motorcaravan annual mileage over ${cfg.thresholds.referralMotorcaravanKmsOver.toLocaleString()} km requires underwriter review.`, ['kmsPerYear']);
    }
  }

  // 7. Non-standard use, relative to the programme's configured standard uses.
  const vehicleUse = String(quoteData.vehicleUse || '').trim();
  if (vehicleUse && !allowedVehicleUses.has(vehicleUse)) {
    push('yellow', 'YELLOW.USE_OUTSIDE_STANDARD', 'Vehicle use is outside the programme standard-use scope.', ['vehicleUse']);
  }

  // 7a. Modified vehicle — any non-standard modification changes the risk
  // (performance, value, parts availability) beyond the online rating basis,
  // so a modified vehicle is referred for an underwriter to assess the exact
  // modification and load it manually.
  if (quoteData.modified === true) {
    push('yellow', 'YELLOW.VEHICLE_MODIFIED', 'Vehicle is modified and requires underwriter review.', ['modified', 'modificationsDetails']);
  }

  // 8. Discretionary Adjustment Check (Stub - passed data doesn't usually match logic, but placeholder for structure)
  // Logic mostly in calculator, but if we had the adjustment value here, we'd check > 20%

  // --- Green lane eligibility (STP prerequisites) ---
  // If there are no red/yellow triggers, we still only allow STP where core prerequisites are met.

  if (!reasonsDecline.length && !reasonsReferral.length) {
    // STP age threshold is programme-authoritative.
    if (age !== null && age < cfg.thresholds.referralStpAgeUnder) {
      push('yellow', 'YELLOW.STP_AGE_NOT_MET', `Driver age must be at least ${cfg.thresholds.referralStpAgeUnder} for STP.`, ['dateOfBirth']);
    }
    // STP licence threshold is programme-authoritative.
    if (licenseYears !== null && licenseYears <= cfg.thresholds.referralStpLicenceYearsAtMost) {
      push('yellow', 'YELLOW.STP_LICENCE_YEARS_NOT_MET', `Full licence must be held for more than ${cfg.thresholds.referralStpLicenceYearsAtMost} years for STP.`, ['licenseYears']);
    }
  }

  // --- Final decision ---
  if (reasonsDecline.length) {
    return { outcome: 'decline', lane: 'red', reasons: reasonsDecline, triggers, config: cfg };
  }
  if (reasonsReferral.length) {
    const lane = triggers.some((trigger) => trigger.lane === 'red') ? 'red' : 'yellow';
    return { outcome: 'referral', lane, reasons: reasonsReferral, triggers, config: cfg };
  }
  return { outcome: 'accept', lane: 'green', reasons: [], triggers, config: cfg };
}
