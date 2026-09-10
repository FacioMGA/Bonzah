import type { QuoteData } from '../../../platform/types/autoInsurance.js';
import { matchLocalMarketNationalityReferral } from '@facio/products';
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

export const DEFAULT_MOTOR_UW_CONFIG: MotorUwConfig = {
  allowedRiskCountries: ['Cyprus', 'Portugal', 'Spain'],
  allowedVehicleUses: ['Private', 'SD&P', 'Class 1'],
  referralFlags: {
    referElectricVehicles: true,
    referHybridVehicles: true,
    referMotorcycle: true,
    referMotorcaravan: true,
  },
  thresholds: {
    declineVehicleValueOver: 250_000,
    declineGarageTotalValueOver: 250_000,
    declineClaimsCountOver5Years: 3,
    declineFaultClaimOver: 100_000,
    declineLicenceYearsUnder: 1,
    declineAddedDriverAgeUnder: 21,
    declineMotorcycleRiderAgeUnder: 25,
    declineMotorcycleOverCcRequiresNcdCc: 200,

    referralVehicleValueOver: 80_000,
    referralFaultClaimOver: 50_000,
    referralClaimsCountAtLeast: 2,
    referralClaimsTotalUnder: 50_000,
    referralAddedDriverAgeMin: 22,
    referralAddedDriverAgeMax: 24,
    referralMotorcaravanValueOver: 30_000,
    referralMotorcaravanKmsOver: 30_000,
  },
};

function mergeUwConfig(override?: Partial<MotorUwConfig>): MotorUwConfig {
  if (!override) return DEFAULT_MOTOR_UW_CONFIG;
  return {
    allowedRiskCountries: Array.isArray(override.allowedRiskCountries) ? override.allowedRiskCountries : DEFAULT_MOTOR_UW_CONFIG.allowedRiskCountries,
    allowedVehicleUses: Array.isArray(override.allowedVehicleUses) ? override.allowedVehicleUses : DEFAULT_MOTOR_UW_CONFIG.allowedVehicleUses,
    referralFlags: {
      ...DEFAULT_MOTOR_UW_CONFIG.referralFlags,
      ...(override.referralFlags || {}),
    },
    thresholds: {
      ...DEFAULT_MOTOR_UW_CONFIG.thresholds,
      ...(override.thresholds || {}),
    },
  };
}

/**
 * Motor Scheme underwriting automation (authoritative initial config).
 *
 * IMPORTANT: If a required input for a rule is missing, we default to REFERRAL
 * rather than silently quoting. That keeps automation safe.
 */
export function evaluateMotorUwAutomation(quoteData: QuoteData, configOverride?: Partial<MotorUwConfig>): UwAutomationDecision {
  const reasonsDecline: string[] = [];
  const reasonsReferral: string[] = [];
  const triggers: UwTrigger[] = [];

  const push = (lane: UwTriggerLane, ruleId: string, message: string, fields: string[], bucket?: UwReasonBucket) => {
    triggers.push({ lane, ruleId, message, fields });
    const target = bucket || (lane === 'red' ? 'decline' : 'referral');
    if (target === 'decline') reasonsDecline.push(message);
    else reasonsReferral.push(message);
  };

  const cfg = mergeUwConfig(configOverride);
  const allowedRiskCountries = new Set(cfg.allowedRiskCountries);
  const allowedVehicleUses = new Set(cfg.allowedVehicleUses);

  const age = getAge(quoteData.proposer?.dateOfBirth ?? '', quoteData.renewalDate);
  const licenseYears = toNumberOrNull(quoteData.licenseYears);
  const youngestDriverAge = toNumberOrNull(quoteData.youngestDriverAge);
  const engineSize = toNumberOrNull(quoteData.engineSize) ?? 0;
  const vehicleValue = toNumberOrNull(quoteData.vehicleValue) ?? 0;
  // ADR-0016: Electric vehicles use the canonical `batteryKWh` field.
  // Records lacking it (legacy stored EV rows that pre-date PR 4) are
  // referred to UW so kWh can be sourced from the customer / CarDog
  // before rerate or renewal.
  const fuelType = String(quoteData.fuelType || '').trim();
  const isElectric = fuelType === 'Electric';
  const isHybrid = fuelType === 'Hybrid';
  const batteryKWh = toNumberOrNull(quoteData.batteryKWh);
  const electricMissingBatteryKWh = isElectric && (batteryKWh === null || batteryKWh <= 0);

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
      'Electric vehicle requires referral to Peter Sheppard or Andrew Francis before any quotation is issued.',
      ['fuelType'],
    );
  }

  if (cfg.referralFlags.referHybridVehicles && isHybrid) {
    push(
      'yellow',
      'YELLOW.HYBRID_REFERRAL',
      'Hybrid vehicle requires referral to Peter Sheppard or Andrew Francis before any quotation is issued.',
      ['fuelType'],
    );
  }

  if (cfg.referralFlags.referMotorcycle && isMotorcycle) {
    push(
      'yellow',
      'YELLOW.MOTORCYCLE_REFERRAL',
      'Motorcycle risk requires referral to Peter Sheppard or Andrew Francis before any quotation is issued.',
      ['vehicleType'],
    );
  }

  if (cfg.referralFlags.referMotorcaravan && isMotorcaravan) {
    push(
      'yellow',
      'YELLOW.MOTORCARAVAN_REFERRAL',
      'Motorhome or motorcaravan risk requires referral to Peter Sheppard or Andrew Francis before any quotation is issued.',
      ['vehicleType'],
    );
  }

  // --- Red lane (auto-decline / no quote) ---

  // 1. Risks outside Cyprus/Portugal/Spain
  if (riskCountry && !allowedRiskCountries.has(riskCountry)) {
    push('red', 'RED.COUNTRY_NOT_ALLOWED', 'Risk country is outside Cyprus, Portugal, or Spain.', ['country', 'countryOfRegistration', 'vehicleLocation']);
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

  // Proposer under 25 — scheme requires referral (no online auto-quote).
  // Motorbike risks have their own under-25 decline rule below.
  if (
    age !== null &&
    age < 25 &&
    !(String(quoteData.vehicleType || '').toLowerCase().includes('motorbike') ||
      String(quoteData.vehicleType || '').toLowerCase().includes('motorcycle'))
  ) {
    push(
      'yellow',
      'YELLOW.PROPOSER_UNDER_25',
      'Proposer is under 25 — requires underwriter referral per scheme.',
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

    // Motorcycles over 200cc with no NCD — no quote per UW notes
    if (engineSize > cfg.thresholds.declineMotorcycleOverCcRequiresNcdCc && ncdIsNone(quoteData.ncb)) {
      push('red', 'RED.MOTORCYCLE_OVER_200CC_NO_NCD', `Motorcycle over ${cfg.thresholds.declineMotorcycleOverCcRequiresNcdCc}cc with no No Claims Discount evidence.`, ['engineSize', 'ncb']);
    }

    // Only comprehensive cover available for motorcycles — no quote otherwise
    if (String(quoteData.coverRequired || '').trim() !== 'Comprehensive') {
      push('red', 'RED.MOTORCYCLE_NON_COMPREHENSIVE_COVER', 'Motorcycle risks are only available on a Comprehensive basis on this scheme.', ['coverRequired']);
    }

    // ABY-323 — motorbikes are Social, Domestic & Pleasure only. Business
    // and haulage classes (Class 1/2/3) are not available on the scheme.
    // The canonical SD&P value and its legacy "Private" label are both the
    // private class and are accepted.
    const motorcycleUse = String(quoteData.vehicleUse || '').trim();
    if (motorcycleUse && motorcycleUse !== 'SD&P' && motorcycleUse !== 'Private') {
      push('red', 'RED.MOTORCYCLE_USE_NOT_SDP', 'Motorcycle risks are only available for Social, Domestic & Pleasure use on this scheme.', ['vehicleUse']);
    }

    // Named riders only — open-rider policies are not available on this scheme
    if (quoteData.motorcycleRidersNamed === false) {
      push('red', 'RED.MOTORCYCLE_RIDERS_NOT_NAMED', 'Motorcycle risks require all riders to be named on the policy.', ['motorcycleRidersNamed']);
    }

    // ABY-324 — motorbikes are insured-only (policyholder) or named-rider
    // only. The open "any driver" coverage modes are not available, so a
    // policy carrying one cannot bind and must not auto-quote.
    const motorcycleRestriction = (quoteData as { driverRestriction?: string }).driverRestriction;
    if (motorcycleRestriction === 'ANY_DRIVER_25_PLUS' || motorcycleRestriction === 'ANY_DRIVER_40_PLUS') {
      push('red', 'RED.MOTORCYCLE_OPEN_DRIVER_NOT_ALLOWED', 'Motorcycle risks must be insured-only or named-rider only — open driver coverage is not available.', ['driverRestriction']);
    }
    if (quoteData.motorcycleRidersNamed === null || quoteData.motorcycleRidersNamed === undefined) {
      push('yellow', 'YELLOW.MOTORCYCLE_RIDERS_NAMED_UNKNOWN', 'Whether motorcycle riders are named has not been confirmed — requires underwriter review.', ['motorcycleRidersNamed']);
    }

  }

  // 9. Seats exceeding scheme maximum (15 inc. driver)
  const numberOfSeats = toNumberOrNull(quoteData.numberOfSeats);
  if (numberOfSeats !== null && numberOfSeats > 15) {
    push('yellow', 'YELLOW.SEATS_OVER_15', 'Vehicle exceeds the scheme maximum of 15 seats (including driver) — requires underwriter review.', ['numberOfSeats']);
  }

  // 10. Unsupported Vehicle Classes
  const vehicleTypeRaw = String(quoteData.vehicleType || '').trim().toLowerCase();
  const supported =
    vehicleTypeRaw.includes('car') ||
    vehicleTypeRaw.includes('4x4') ||
    vehicleTypeRaw.includes('mpv') ||
    vehicleTypeRaw.includes('motorbike') ||
    vehicleTypeRaw.includes('motorcycle') ||
    vehicleTypeRaw.includes('van') ||
    vehicleTypeRaw.includes('pickup') ||
    isMotorcaravanType(vehicleTypeRaw) ||
    vehicleTypeRaw.includes('classic');
  if (vehicleTypeRaw && !supported) {
    push('red', 'RED.VEHICLE_CLASS_OUTSIDE_SCHEME', 'Vehicle type is outside scheme classes.', ['vehicleType']);
  }


  // --- Yellow lane (referral) ---

  // 1. Major Conviction within 5 Years
  if (quoteData.hasConvictions && hasMajorConviction) {
    push('yellow', 'YELLOW.MAJOR_CONVICTION', 'Major conviction within last 5 years.', ['hasMajorConvictionLast5Years']);
  }

  // 1a. Two or more serious technical convictions — refer per rating guide (no written authority for a higher load)
  if (quoteData.hasConvictions && String(quoteData.convictionClass || '') === 'serious_technical') {
    const qdExtra = asRecord(quoteData);
    const seriousCount = Number(qdExtra.seriousTechnicalOffenceCount ?? qdExtra.seriousTechnicalOffencesCount ?? qdExtra.seriousTechnicalConvictionCount ?? 0);
    if (Number.isFinite(seriousCount) && seriousCount >= 2) {
      push('yellow', 'YELLOW.SERIOUS_TECHNICAL_MULTIPLE', 'Two or more serious technical convictions — requires underwriter review.', ['convictionClass']);
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

  // 4. Added drivers 22-24
  if (quoteData.hasAdditionalDrivers && youngestDriverAge !== null && youngestDriverAge >= cfg.thresholds.referralAddedDriverAgeMin && youngestDriverAge <= cfg.thresholds.referralAddedDriverAgeMax) {
    push('yellow', 'YELLOW.AAD_22_24', `Added driver aged ${cfg.thresholds.referralAddedDriverAgeMin}–${cfg.thresholds.referralAddedDriverAgeMax}.`, ['youngestDriverAge']);
  }

  // 5. Value > 80k (but < 250k which is red)
  if (vehicleValue > cfg.thresholds.referralVehicleValueOver) {
    push('yellow', 'YELLOW.VEHICLE_VALUE_OVER_80K', `Vehicle value over €${cfg.thresholds.referralVehicleValueOver.toLocaleString()}.`, ['vehicleValue']);
  }

  if (electricMissingBatteryKWh) {
    push(
      'yellow',
      'YELLOW.EV_BATTERY_KWH_MISSING',
      'Electric vehicle is missing the canonical batteryKWh field (ADR-0016) and requires underwriter review before issuance / rerate.',
      ['fuelType', 'batteryKWh'],
    );
  }

  if (isClassic && vehicleValue > 60_000) {
    push('yellow', 'YELLOW.CLASSIC_VALUE_OVER_60K', 'Classic vehicle value exceeds €60,000 and requires underwriter review.', ['vehicleValue']);
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

  // 7. Non-standard Use
  // "Use limited to Private / SD&P / Class 1" -> Others refer
  const vehicleUse = String(quoteData.vehicleUse || '').trim();
  if (vehicleUse && !allowedVehicleUses.has(vehicleUse)) {
    push('yellow', 'YELLOW.USE_OUTSIDE_STANDARD', 'Vehicle use is outside standard Private/SD&P/Class 1.', ['vehicleUse']);
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
    // STP Age Check (30+)
    if (age !== null && age < 30) {
      push('yellow', 'YELLOW.STP_AGE_NOT_MET', 'Driver age must be at least 30 for STP.', ['dateOfBirth']);
    }
    // STP Licence Check (>2 years)
    if (licenseYears !== null && licenseYears <= 2) {
      push('yellow', 'YELLOW.STP_LICENCE_YEARS_NOT_MET', 'Full licence must be held >2 years for STP.', ['licenseYears']);
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

