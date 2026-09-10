/**
 * Travel underwriting automation — implements ADR-0025 objective expat
 * eligibility on top of the existing trip-level UW gates.
 *
 * Decline-code vocabulary is pinned by ADR-0025; the customer-facing
 * messages are Peter's verbatim wording from 2026-05-16 and feed the
 * wizard inline error, the audit log, and the declined-quote email
 * from a single canonical source.
 */

import { matchLocalMarketNationalityReferral, residenceMatchesNationality } from '@facio/products';
import { z } from 'zod';

export interface TravelUwConfig {
  maxTravellerAge: number;
  referTravellerAge: number;
  /**
   * Minimum policyholder age for online self-service bind. An under-age
   * policyholder is REFERRED (not declined): a child can still be covered,
   * but an adult must arrange the policy in their own name offline. Peter +
   * Andy, WhatsApp 2026-06-16.
   */
  minOnlinePolicyholderAge: number;
  excludedDestinations: string[];
  maxTripDurationDays: number;
  disallowMedicalInCountryOfResidence: boolean;
}

export const DEFAULT_TRAVEL_UW_CONFIG: TravelUwConfig = {
  maxTravellerAge: 85,
  referTravellerAge: 80,
  minOnlinePolicyholderAge: 18,
  excludedDestinations: ['Cuba', 'Iran', 'North Korea'],
  maxTripDurationDays: 62,
  disallowMedicalInCountryOfResidence: true,
};

const TravelUwConfigSchema = z.object({
  maxTravellerAge: z.number().finite().nonnegative(),
  referTravellerAge: z.number().finite().nonnegative(),
  minOnlinePolicyholderAge: z.number().finite().nonnegative(),
  excludedDestinations: z.array(z.string().trim().min(1)),
  maxTripDurationDays: z.number().finite().positive(),
  disallowMedicalInCountryOfResidence: z.boolean(),
}).strict();

export function parseTravelUwConfig(value: unknown): TravelUwConfig {
  const parsed = TravelUwConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Travel underwriting configuration is incomplete or invalid: ${parsed.error.issues.map((issue) => issue.path.join('.') || issue.message).join(', ')}`);
  }
  return parsed.data;
}

export type UwLane = 'accept' | 'referral' | 'decline';

export type TravelDeclineCode =
  | 'EXCLUDED_DESTINATION'
  | 'MEDICAL_IN_COUNTRY_OF_RESIDENCE'
  | 'AGE_OVER_MAX'
  | 'NATIONALITY_EQUALS_RESIDENCE'
  | 'OTHER_NATIONALITY_EQUALS_RESIDENCE'
  | 'WILL_NOT_REMAIN_RESIDENT'
  | 'NOT_LEGALLY_RESIDENT'
  | 'INFORMATION_NOT_CONFIRMED';

export type TravelReferralCode =
  | 'AGE_REFERRAL'
  | 'POLICYHOLDER_UNDER_MIN_AGE'
  | 'TRIP_DURATION_EXCEEDED'
  | 'TAX_PROFILE_REFER'
  | 'PRIOR_TRAVEL_CLAIM_OVER_THRESHOLD'
  | 'LOCAL_MARKET_NATIONALITY_REFERRAL';

/**
 * Customer-facing referral copy for an under-age policyholder. Exported so
 * the wizard referral panel, audit log, and any referral email read the same
 * single source (mirrors how TRAVEL_DECLINE_MESSAGES pins decline copy).
 */
export const TRAVEL_POLICYHOLDER_UNDER_MIN_AGE_MESSAGE =
  'The policyholder must be at least 18 to buy online. We can still cover an under-18 traveller, but an adult needs to take out the policy on their behalf — we have referred this so our team can set it up and send you a link to complete it.';

/**
 * Customer-facing referral copy for a declared prior travel claim OVER €500
 * (ADR-0054). A claim of this size cannot be auto-priced — the quote is
 * referred for manual underwriting. Exported so the wizard referral panel,
 * audit log, and any referral email read the same single source.
 */
export const TRAVEL_PRIOR_CLAIM_OVER_THRESHOLD_MESSAGE =
  'Because you have previously claimed more than €500 on travel insurance, we need to review this personally before we can offer a price. We have referred your quote so our team can look at it and get back to you.';

export type TravelUwReasonCode = TravelDeclineCode | TravelReferralCode;

export interface UwDecision {
  lane: UwLane;
  reasons: Array<{ code: TravelUwReasonCode | string; message: string }>;
  /**
   * Derived from the seven objective answers per ADR-0025. When
   * `lane === 'decline'` the value is `false`; on `accept` / `referral`
   * the value is `true` (only expats reach those lanes).
   */
  isExpat: boolean;
}

interface TravelUwInput {
  /**
   * Age of the OLDEST traveller — drives the max-age decline / 80+ referral
   * gates. Named `leadTravellerAge` for historical reasons.
   */
  leadTravellerAge?: number;
  /**
   * Actual age of the policyholder / lead traveller (from leadTravellerDOB).
   * Drives the under-18 online-bind referral. Distinct from `leadTravellerAge`
   * which is the oldest traveller.
   */
  policyholderAge?: number;
  destinations?: string[];
  countryOfResidence?: string;
  tripDurationDays?: number;
  tripType?: 'Single trip' | 'Multi trip' | string;
  /**
   * Objective expat-eligibility inputs (ADR-0025).
   * `nationality` and `otherNationality` are expected to be canonical
   * country names matching `countryOfResidence` for direct comparison.
   */
  nationality?: string;
  hasOtherNationality?: boolean;
  otherNationality?: string;
  willRemainResident?: boolean;
  legallyPermittedToReside?: boolean;
  informationAccurate?: boolean;
  /**
   * Prior travel-claims history (ADR-0054). `over_500` is a referral;
   * `up_to_500` is priced with a loading (handled by the calculator, not a
   * UW gate); absence means no previous claim.
   */
  hasPreviousTravelClaim?: boolean;
  previousTravelClaimBand?: 'up_to_500' | 'over_500';
}

/**
 * Decline-code message map. Sourced verbatim from Peter (Abbeygate)
 * 2026-05-16 — these strings are the canonical customer-facing copy
 * for declined Travel quotes. Wizard, audit logs, and the declined-quote
 * email all read from this single source. ADR-0025 pins them.
 */
export const TRAVEL_DECLINE_MESSAGES: Record<TravelDeclineCode, string> = {
  EXCLUDED_DESTINATION: 'This destination is not covered.',
  MEDICAL_IN_COUNTRY_OF_RESIDENCE: 'No medical cover in country of residence.',
  AGE_OVER_MAX: 'Traveller age exceeds the maximum we can cover.',
  NATIONALITY_EQUALS_RESIDENCE:
    'We can only insure expatriate residents. Based on the answers selected, your nationality matches your country of residence.',
  OTHER_NATIONALITY_EQUALS_RESIDENCE:
    'We can only insure expatriate residents. Based on the answers selected, your nationality matches your country of residence.',
  WILL_NOT_REMAIN_RESIDENT:
    'We can only offer cover where you confirm that you will remain resident in your country of residence for the duration of the policy.',
  NOT_LEGALLY_RESIDENT:
    'We can only offer cover to applicants who are legally resident in their country of residence.',
  INFORMATION_NOT_CONFIRMED:
    'We can only offer cover where the declaration of accuracy is confirmed.',
};

/**
 * Derive `isExpat` from the seven objective inputs. Pure function — no
 * side effects, no UW-config dependence. Exported for tests and BO
 * dashboards that need the same predicate without the full UW evaluation.
 *
 * Uses the canonical `residenceMatchesNationality` helper from
 * `@facio/products` so the residence-vs-nationality comparison is
 * identical here and in the validation profile refinement (e.g.
 * "Republic of Cyprus" === "Cyprus").
 */
export function deriveIsExpat(input: TravelUwInput): boolean {
  if (!input.countryOfResidence) return false;
  if (residenceMatchesNationality(input.countryOfResidence, input.nationality)) return false;
  if (input.hasOtherNationality === true && residenceMatchesNationality(input.countryOfResidence, input.otherNationality)) return false;
  if (input.willRemainResident !== true) return false;
  if (input.legallyPermittedToReside !== true) return false;
  if (input.informationAccurate !== true) return false;
  return true;
}

export function evaluateTravelUw(input: TravelUwInput, config: TravelUwConfig = DEFAULT_TRAVEL_UW_CONFIG): UwDecision {
  const reasons: UwDecision['reasons'] = [];

  // Objective expat-eligibility gates (ADR-0025). These run BEFORE the
  // trip-level checks: a non-expat is declined regardless of trip
  // details. Each branch returns immediately so the customer sees one
  // actionable reason rather than a wall of declines.
  if (input.countryOfResidence && input.nationality && residenceMatchesNationality(input.countryOfResidence, input.nationality)) {
    reasons.push({ code: 'NATIONALITY_EQUALS_RESIDENCE', message: TRAVEL_DECLINE_MESSAGES.NATIONALITY_EQUALS_RESIDENCE });
    return { lane: 'decline', reasons, isExpat: false };
  }
  if (
    input.hasOtherNationality === true &&
    input.countryOfResidence &&
    input.otherNationality &&
    residenceMatchesNationality(input.countryOfResidence, input.otherNationality)
  ) {
    reasons.push({ code: 'OTHER_NATIONALITY_EQUALS_RESIDENCE', message: TRAVEL_DECLINE_MESSAGES.OTHER_NATIONALITY_EQUALS_RESIDENCE });
    return { lane: 'decline', reasons, isExpat: false };
  }
  if (input.willRemainResident === false) {
    reasons.push({ code: 'WILL_NOT_REMAIN_RESIDENT', message: TRAVEL_DECLINE_MESSAGES.WILL_NOT_REMAIN_RESIDENT });
    return { lane: 'decline', reasons, isExpat: false };
  }
  if (input.legallyPermittedToReside === false) {
    reasons.push({ code: 'NOT_LEGALLY_RESIDENT', message: TRAVEL_DECLINE_MESSAGES.NOT_LEGALLY_RESIDENT });
    return { lane: 'decline', reasons, isExpat: false };
  }
  if (input.informationAccurate === false) {
    reasons.push({ code: 'INFORMATION_NOT_CONFIRMED', message: TRAVEL_DECLINE_MESSAGES.INFORMATION_NOT_CONFIRMED });
    return { lane: 'decline', reasons, isExpat: false };
  }

  // Trip-level declines (existing behaviour).
  const destinations = input.destinations || [];
  for (const d of destinations) {
    if (config.excludedDestinations.includes(d)) {
      reasons.push({ code: 'EXCLUDED_DESTINATION', message: `Destination ${d} is not covered` });
      return { lane: 'decline', reasons, isExpat: deriveIsExpat(input) };
    }
  }
  if (config.disallowMedicalInCountryOfResidence && input.countryOfResidence && destinations.includes(input.countryOfResidence)) {
    reasons.push({ code: 'MEDICAL_IN_COUNTRY_OF_RESIDENCE', message: TRAVEL_DECLINE_MESSAGES.MEDICAL_IN_COUNTRY_OF_RESIDENCE });
    return { lane: 'decline', reasons, isExpat: deriveIsExpat(input) };
  }
  const age = Number(input.leadTravellerAge || 0);
  if (age >= config.maxTravellerAge) {
    reasons.push({ code: 'AGE_OVER_MAX', message: `Traveller age ${age} exceeds maximum ${config.maxTravellerAge}` });
    return { lane: 'decline', reasons, isExpat: deriveIsExpat(input) };
  }

  // Referrals
  if (age >= config.referTravellerAge) {
    reasons.push({ code: 'AGE_REFERRAL', message: `Traveller age ${age} requires manual review` });
  }
  // ADR-0059 — Abbeygate is an expat broker: same-market nationals are
  // local-market customers and must be referred before a quote is released.
  // Cross-territory operating nationals remain expats. Canonical matcher
  // lives in @facio/products — do not re-state alias lists or country pairs.
  const localNational =
    matchLocalMarketNationalityReferral(input.nationality, input.countryOfResidence) ??
    (input.hasOtherNationality ? matchLocalMarketNationalityReferral(input.otherNationality, input.countryOfResidence) : null);
  if (localNational) {
    reasons.push({
      code: 'LOCAL_MARKET_NATIONALITY_REFERRAL',
      message: `Proposer of ${localNational.demonym} nationality requires underwriter review before a quote can be released`,
    });
  }
  // Under-age policyholder: refer (never bind online). A child can be covered,
  // but an adult must take out the policy in their own name offline.
  if (input.policyholderAge !== undefined && input.policyholderAge < config.minOnlinePolicyholderAge) {
    reasons.push({ code: 'POLICYHOLDER_UNDER_MIN_AGE', message: TRAVEL_POLICYHOLDER_UNDER_MIN_AGE_MESSAGE });
  }
  if ((input.tripDurationDays || 0) > config.maxTripDurationDays && input.tripType === 'Single trip') {
    reasons.push({ code: 'TRIP_DURATION_EXCEEDED', message: `Single trip over ${config.maxTripDurationDays} days requires manual review` });
  }
  // ADR-0054 — a declared prior travel claim over €500 refers (no auto
  // price). `up_to_500` is NOT a referral: it is priced with a 15% loading
  // in the calculator, so it does not push a reason here.
  if (input.hasPreviousTravelClaim === true && input.previousTravelClaimBand === 'over_500') {
    reasons.push({ code: 'PRIOR_TRAVEL_CLAIM_OVER_THRESHOLD', message: TRAVEL_PRIOR_CLAIM_OVER_THRESHOLD_MESSAGE });
  }

  const isExpat = deriveIsExpat(input);
  if (reasons.length === 0) return { lane: 'accept', reasons: [], isExpat };
  return { lane: 'referral', reasons, isExpat };
}
