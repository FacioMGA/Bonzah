/**
 * Health underwriting automation.
 *
 * The Brit Immigration Medical product is sold only to expat residents
 * of Cyprus. Same objective-expat eligibility model Travel uses
 * (ADR-0025): five decline codes, three referral codes, derived
 * `isExpat` flag. Decline-code messages are the canonical customer-
 * facing strings shared with `healthValidationProfile`'s refinements
 * so wizard inline error, audit log and decline email all point at
 * the same text.
 *
 * Phase 1 caps insureds at 85 years old (refer at 80) — same defaults
 * as Travel. Peter to confirm — the values are configurable via
 * `HealthUwConfig` and surfaced in the manifest's `uwConfigSchema`.
 *
 * GESY (approved production requirement, Peter 2026-07-21): a Cyprus
 * Immigration new-business applicant will not yet have GESY, so absence of
 * GESY must NOT block a quotation or purchase. GESY beneficiary status
 * (`ghs.isBeneficiary`) is therefore intentionally NOT an input here and must
 * never become a decline/referral gate — making it a requirement would block
 * all new Immigration sales. Renewals will carry a separate ruleset, agreed
 * separately, and must not affect this new-business journey.
 */

import { matchLocalMarketNationalityReferral, residenceMatchesNationality } from '@facio/products';
import { z } from 'zod';

export interface HealthUwConfig {
  maxInsuredAge: number;
  referInsuredAge: number;
  allowedResidenceCountries: string[];
}

export const DEFAULT_HEALTH_UW_CONFIG: HealthUwConfig = {
  maxInsuredAge: 85,
  referInsuredAge: 80,
  allowedResidenceCountries: ['Cyprus'],
};

const HealthUwConfigSchema = z.object({
  maxInsuredAge: z.number().finite().nonnegative(),
  referInsuredAge: z.number().finite().nonnegative(),
  allowedResidenceCountries: z.array(z.string().trim().min(1)).min(1),
}).strict();

export function parseHealthUwConfig(value: unknown): HealthUwConfig {
  const parsed = HealthUwConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Health underwriting configuration is incomplete or invalid: ${parsed.error.issues.map((issue) => issue.path.join('.') || issue.message).join(', ')}`);
  }
  return parsed.data;
}

export type UwLane = 'accept' | 'referral' | 'decline';

export type HealthDeclineCode =
  | 'RESIDENCE_NOT_AUTHORISED'
  | 'AGE_OVER_MAX'
  | 'NATIONALITY_EQUALS_RESIDENCE'
  | 'OTHER_NATIONALITY_EQUALS_RESIDENCE'
  | 'WILL_NOT_REMAIN_RESIDENT'
  | 'NOT_LEGALLY_RESIDENT'
  | 'INFORMATION_NOT_CONFIRMED';

export type HealthReferralCode = 'AGE_REFERRAL' | 'LOCAL_MARKET_NATIONALITY_REFERRAL';

export type HealthUwReasonCode = HealthDeclineCode | HealthReferralCode;

export interface HealthUwDecision {
  lane: UwLane;
  reasons: Array<{ code: HealthUwReasonCode | string; message: string }>;
  isExpat: boolean;
}

export interface HealthUwInput {
  oldestInsuredAge?: number;
  countryOfResidence?: string;
  nationality?: string;
  hasOtherNationality?: boolean;
  otherNationality?: string;
  willRemainResident?: boolean;
  legallyPermittedToReside?: boolean;
  informationAccurate?: boolean;
}

export const HEALTH_DECLINE_MESSAGES: Record<HealthDeclineCode, string> = {
  RESIDENCE_NOT_AUTHORISED:
    'We can only offer Cyprus Immigration Medical cover for residents of the Republic of Cyprus.',
  AGE_OVER_MAX: 'Insured age exceeds the maximum we can cover.',
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

export function evaluateHealthUw(input: HealthUwInput, config: HealthUwConfig = DEFAULT_HEALTH_UW_CONFIG): HealthUwDecision {
  const reasons: HealthUwDecision['reasons'] = [];
  const residence = String(input.countryOfResidence || '').trim();
  const nationality = String(input.nationality || '').trim();
  const otherNationality = String(input.otherNationality || '').trim();
  const hasOther = input.hasOtherNationality === true;

  // CY-only Phase 1.
  if (residence && !config.allowedResidenceCountries.includes(residence)) {
    reasons.push({ code: 'RESIDENCE_NOT_AUTHORISED', message: HEALTH_DECLINE_MESSAGES.RESIDENCE_NOT_AUTHORISED });
  }

  // ADR-0025 objective expat gates.
  if (residence && nationality && residenceMatchesNationality(residence, nationality)) {
    reasons.push({ code: 'NATIONALITY_EQUALS_RESIDENCE', message: HEALTH_DECLINE_MESSAGES.NATIONALITY_EQUALS_RESIDENCE });
  }
  if (hasOther && residence && otherNationality && residenceMatchesNationality(residence, otherNationality)) {
    reasons.push({ code: 'OTHER_NATIONALITY_EQUALS_RESIDENCE', message: HEALTH_DECLINE_MESSAGES.OTHER_NATIONALITY_EQUALS_RESIDENCE });
  }
  if (input.willRemainResident === false) {
    reasons.push({ code: 'WILL_NOT_REMAIN_RESIDENT', message: HEALTH_DECLINE_MESSAGES.WILL_NOT_REMAIN_RESIDENT });
  }
  if (input.legallyPermittedToReside === false) {
    reasons.push({ code: 'NOT_LEGALLY_RESIDENT', message: HEALTH_DECLINE_MESSAGES.NOT_LEGALLY_RESIDENT });
  }
  if (input.informationAccurate === false) {
    reasons.push({ code: 'INFORMATION_NOT_CONFIRMED', message: HEALTH_DECLINE_MESSAGES.INFORMATION_NOT_CONFIRMED });
  }

  const age = Number(input.oldestInsuredAge);
  if (Number.isFinite(age) && age > config.maxInsuredAge) {
    reasons.push({ code: 'AGE_OVER_MAX', message: HEALTH_DECLINE_MESSAGES.AGE_OVER_MAX });
  }

  if (reasons.length > 0) {
    return { lane: 'decline', reasons, isExpat: false };
  }

  const referralReasons: HealthUwDecision['reasons'] = [];
  if (Number.isFinite(age) && age >= config.referInsuredAge) {
    referralReasons.push({
      code: 'AGE_REFERRAL',
      message: `Insured age ${age} requires manual underwriter review (refer at ${config.referInsuredAge}).`,
    });
  }
  // ADR-0059 — expat-broker posture: same-market nationals are outside
  // online appetite and must be referred. Cross-territory operating
  // nationals remain expats. Canonical matcher lives in @facio/products —
  // do not re-state alias lists or country pairs.
  const localNational =
    matchLocalMarketNationalityReferral(nationality, residence) ??
    (hasOther ? matchLocalMarketNationalityReferral(otherNationality, residence) : null);
  if (localNational) {
    referralReasons.push({
      code: 'LOCAL_MARKET_NATIONALITY_REFERRAL',
      message: `Insured of ${localNational.demonym} nationality requires underwriter review before a quote can be released`,
    });
  }
  if (referralReasons.length > 0) {
    return { lane: 'referral', reasons: referralReasons, isExpat: true };
  }

  return { lane: 'accept', reasons: [], isExpat: true };
}
