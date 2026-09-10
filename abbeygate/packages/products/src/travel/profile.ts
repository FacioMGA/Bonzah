/**
 * Travel validation profile — single source of truth.
 *
 * Phase 4 (2026-04 consolidation): adopted the BE profile as canonical
 * (it carried the post-Bug-#2 fix) and deleted
 * `frontend/src/products/travel/validation/profile.ts`. Both sides now
 * consume this profile from `@facio/products`.
 *
 * Declarative, like Home. Travel has 8 wizard steps, but only a handful
 * actually collect user data — the plan picker + declarations steps are
 * mostly about selection rather than free-form input.
 *
 * Steps 6 (Your Details) and 7 (Declarations) are merged into a single
 * Lloyd's-approved step — `your-details` — that validates both proposer
 * contact information and all five declaration checkboxes together.
 *
 * Phase 2.5 — canonical data cutover (Apr 2026).
 *   The `travelCanonicalShape` preprocess that lifted root-level legacy
 *   proposer aliases into `proposer.*` was deleted. After the
 *   `20260427153132_canonicalize_travel_proposer` Prisma migration, every
 *   stored TRAVEL row uses the nested shape, and the HTTP boundary
 *   (`uwRouter.findLegacyTravelRootKey`) rejects any patch that tries to
 *   reintroduce root-level aliases with `400 INVALID_BODY`. This profile
 *   therefore validates the canonical shape only — there is no
 *   coercion/normalization in the runtime path.
 */

import type { RefinementFn, ValidationProfile } from '@facio/validation';
import {
  TRAVEL_COVER_TYPE_OPTIONS,
  TRAVEL_PLAN_TYPE_OPTIONS,
  TRAVEL_PREVIOUS_CLAIM_BAND_OPTIONS,
  TRAVEL_RESIDENCE_COUNTRY_OPTIONS,
  TRAVEL_RESIDENCE_DURATION_OPTIONS,
  TRAVEL_RESIDENCY_STATUS_OPTIONS,
  TRAVEL_SELECTED_PLAN_OPTIONS,
} from './manifest.js';
import { isTravelAnnualEndDateWithinOneYear } from './dates.js';
import { residenceMatchesNationality } from './eligibility.js';

/**
 * ADR-0025 customer-facing decline copy. Wizard refinements emit these
 * exact strings so the wizard inline error, the audit log, and the
 * declined-quote email all share one canonical message per gate.
 */
const TRAVEL_ELIGIBILITY_DECLINE_MESSAGES = {
  NATIONALITY_EQUALS_RESIDENCE:
    'We can only insure expatriate residents. Based on the answers selected, your nationality matches your country of residence.',
  WILL_NOT_REMAIN_RESIDENT:
    'We can only offer cover where you confirm that you will remain resident in your country of residence for the duration of the policy.',
  NOT_LEGALLY_RESIDENT:
    'We can only offer cover to applicants who are legally resident in their country of residence.',
  INFORMATION_NOT_CONFIRMED:
    'We can only offer cover where the declaration of accuracy is confirmed.',
} as const;

function oneOf(options: Array<{ value: string }>): string {
  return `oneOf:${options.map((option) => option.value).join('|')}`;
}

function parseDateOnlyLocal(raw: string): Date | null {
  const match = String(raw || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return new Date(year, month - 1, day);
}

function requiredTravellerCount(coverTypeRaw: string, rawCount: unknown): number {
  const coverType = String(coverTypeRaw || '').trim();
  if (coverType === 'couple') return 2;
  if (coverType === 'family' || coverType === 'single_parent_family') {
    const requested = Number(rawCount);
    return Number.isFinite(requested) && requested >= 3 ? Math.floor(requested) : 3;
  }
  return 1;
}

function isValidDob(raw: unknown): boolean {
  const value = String(raw || '').trim();
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function validateTravellerDobSet(
  data: Record<string, unknown>,
  ctx: { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void },
): void {
  const coverType = String(data['travellers.coverType'] || '');
  const travellerCount = requiredTravellerCount(coverType, data['travellers.travellerCount']);
  const additionalDobCount = Math.max(0, travellerCount - 1);
  const raw = data['travellers.additionalTravellerDOBs'];
  const additional = Array.isArray(raw) ? raw : [];
  if (travellerCount > 1 && additional.length < additionalDobCount) {
    ctx.addIssue({
      code: 'custom',
      path: ['travellers.additionalTravellerDOBs'],
      message: `Please enter date of birth for all ${travellerCount} travellers`,
    });
  }
  for (let i = 0; i < additionalDobCount; i += 1) {
    if (!isValidDob(additional[i])) {
      ctx.addIssue({
        code: 'custom',
        path: ['travellers.additionalTravellerDOBs', String(i)],
        message: `Please enter date of birth for traveller ${i + 2}`,
      });
    }
  }
}

function validateAdditionalTravellerDetails(
  raw: unknown,
  requiredCount: number,
  ctx: { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void },
): void {
  const rows = Array.isArray(raw) ? raw : [];
  if (requiredCount > 0 && rows.length < requiredCount) {
    ctx.addIssue({
      code: 'custom',
      path: ['travellers.additionalTravellers'],
      message: 'Please complete details for every additional traveller',
    });
  }
  for (let i = 0; i < requiredCount; i += 1) {
    const row = rows[i] && typeof rows[i] === 'object' ? rows[i] as Record<string, unknown> : {};
    if (!String(row.firstName || '').trim()) {
      ctx.addIssue({ code: 'custom', path: ['travellers.additionalTravellers', String(i), 'firstName'], message: `Please enter traveller ${i + 2} first name` });
    }
    if (!String(row.lastName || '').trim()) {
      ctx.addIssue({ code: 'custom', path: ['travellers.additionalTravellers', String(i), 'lastName'], message: `Please enter traveller ${i + 2} last name` });
    }
    if (!String(row.idType || '').trim()) {
      ctx.addIssue({ code: 'custom', path: ['travellers.additionalTravellers', String(i), 'idType'], message: `Please select traveller ${i + 2} ID proof` });
    }
    if (!String(row.idNumber || '').trim()) {
      ctx.addIssue({ code: 'custom', path: ['travellers.additionalTravellers', String(i), 'idNumber'], message: `Please enter traveller ${i + 2} ID number` });
    }
  }
}

/**
 * Prior travel-claim band is required-when-yes (ADR-0054). When the
 * customer confirms a previous travel claim, the band drives the rating
 * decision (15% load) or referral (over €500) — so a missing band is a
 * hard validation failure, never a silent default (`no-defensive-fallbacks`).
 */
const validatePriorTravelClaimBand: RefinementFn = (data, ctx) => {
  if (data['risk.hasPreviousTravelClaim'] !== true) return;
  const band = String(data['risk.previousTravelClaimBand'] || '').trim();
  if (!band) {
    ctx.addIssue({
      code: 'custom',
      path: ['risk.previousTravelClaimBand'],
      message: 'Please tell us how much you claimed in total.',
    });
  }
};

const validateTripDetails: RefinementFn = (data, ctx) => {
  const start = String(data['trip.startDate'] || '');
  const end = String(data['trip.endDate'] || '');
  if (!start || !end) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = parseDateOnlyLocal(start);
  if (!startDate) return;
  startDate.setHours(0, 0, 0, 0);
  if (startDate < today) {
    ctx.addIssue({
      code: 'custom',
      path: ['trip.startDate'],
      message: 'Trip start date must be today or later',
    });
  }
  if (new Date(end) < new Date(start)) {
    ctx.addIssue({
      code: 'custom',
      path: ['trip.endDate'],
      message: 'Trip end date must be after the start date',
    });
  }
  const planType = String(data['trip.planType'] || '');
  if (planType === 'annual_multi_trip' && !isTravelAnnualEndDateWithinOneYear(start, end)) {
    ctx.addIssue({
      code: 'custom',
      path: ['trip.endDate'],
      message: 'Annual policy end date must be within one year of the start date',
    });
  }
};

export const travelValidationProfile: ValidationProfile = {
  productCode: 'TRAVEL',
  fields: {
    // Step 1: Eligibility — objective expat questions per ADR-0025.
    'eligibility.countryOfResidence': {
      path: 'eligibility.countryOfResidence',
      // Pipe-separated allowed values match the manifest's select options exactly.
      rule: oneOf(TRAVEL_RESIDENCE_COUNTRY_OPTIONS),
      required: true,
      label: 'Country of residence',
    },
    /**
     * `isExpat` is preserved on the canonical shape for BDX/audit but,
     * per ADR-0025, is a DERIVED outcome of the seven objective answers
     * below — not a customer-input boolean. The wizard step does NOT
     * include it; UW automation writes it into the quote record.
     */
    'eligibility.isExpat': {
      path: 'eligibility.isExpat',
      rule: 'bool',
      label: 'Expatriate (derived)',
    },
    'eligibility.nationality': {
      path: 'eligibility.nationality',
      rule: 'countryName',
      required: true,
      label: 'Nationality',
    },
    'eligibility.hasOtherNationality': {
      path: 'eligibility.hasOtherNationality',
      rule: 'bool',
      required: true,
      label: 'Hold any other nationality?',
    },
    'eligibility.otherNationality': {
      path: 'eligibility.otherNationality',
      rule: 'countryName',
      label: 'Other nationality',
    },
    'eligibility.residenceDuration': {
      path: 'eligibility.residenceDuration',
      rule: oneOf(TRAVEL_RESIDENCE_DURATION_OPTIONS),
      required: true,
      label: 'How long have you been living in your current country of residence?',
    },
    'eligibility.willRemainResident': {
      path: 'eligibility.willRemainResident',
      rule: 'bool',
      required: true,
      label: 'Will you remain a resident for the duration of the policy?',
    },
    'eligibility.residencyStatus': {
      path: 'eligibility.residencyStatus',
      rule: oneOf(TRAVEL_RESIDENCY_STATUS_OPTIONS),
      required: true,
      label: 'Residency status in country of residence',
    },
    'eligibility.legallyPermittedToReside': {
      path: 'eligibility.legallyPermittedToReside',
      rule: 'bool',
      required: true,
      label: 'Are you legally permitted to reside in your country of residence?',
    },
    /**
     * Rule is `bool` (not `mustAccept`) so the cross-field refinement's
     * verbatim Peter-approved message wins over the generic "You must
     * accept to continue" — the runner deduplicates by path with first
     * issue winning, so atomic-rule failures would otherwise preempt
     * the canonical decline copy.
     *
     * `required: true` still gates "field must be present"; the
     * refinement gates "field must be true".
     */
    'eligibility.informationAccurate': {
      path: 'eligibility.informationAccurate',
      rule: 'bool',
      required: true,
      label: 'Information accurate declaration',
    },
    // Existing Lloyd's 6-month / English-language declaration. Sits
    // alongside `eligibility.informationAccurate`; both must be accepted.
    'eligibility.legalAgreement': {
      path: 'eligibility.legalAgreement',
      rule: 'mustAccept',
      required: true,
      label: 'Lloyd\'s residency declaration accepted',
    },

    // Step 2: Travellers
    'travellers.coverType': {
      path: 'travellers.coverType',
      rule: oneOf(TRAVEL_COVER_TYPE_OPTIONS),
      required: true,
      label: 'Cover type',
    },
    'travellers.leadTravellerDOB': {
      path: 'travellers.leadTravellerDOB',
      rule: 'dob:0-100',
      required: true,
      label: 'Lead traveller DOB',
    },
    'travellers.travellerCount': {
      path: 'travellers.travellerCount',
      label: 'Number of travellers',
    },
    'travellers.additionalTravellerDOBs': {
      path: 'travellers.additionalTravellerDOBs',
      label: 'Additional traveller dates of birth',
    },
    'travellers.additionalTravellers': {
      path: 'travellers.additionalTravellers',
      label: 'Additional traveller details',
    },

    // Step 3: Trip
    'trip.planType': { path: 'trip.planType', rule: oneOf(TRAVEL_PLAN_TYPE_OPTIONS), required: true, label: 'Plan type' },
    'trip.destinations': { path: 'trip.destinations', rule: 'nonEmptyStringArray', required: true, label: 'Destinations' },
    'trip.startDate': { path: 'trip.startDate', rule: 'isoDate', required: true, label: 'Trip start date' },
    'trip.endDate': { path: 'trip.endDate', rule: 'isoDate', required: true, label: 'Trip end date' },

    // Prior travel-claims history (ADR-0054). The boolean is always
    // required; the band is conditionally required-when-yes via the
    // `validatePriorTravelClaimBand` refinement on the trip step + stages.
    'risk.hasPreviousTravelClaim': {
      path: 'risk.hasPreviousTravelClaim',
      rule: 'bool',
      required: true,
      label: 'Previously claimed on travel insurance?',
    },
    'risk.previousTravelClaimBand': {
      path: 'risk.previousTravelClaimBand',
      rule: oneOf(TRAVEL_PREVIOUS_CLAIM_BAND_OPTIONS),
      label: 'Previous travel claim amount',
    },

    // Step 4: Plan selection (Plan picker)
    'quote.selectedPlan': {
      path: 'quote.selectedPlan',
      rule: oneOf(TRAVEL_SELECTED_PLAN_OPTIONS),
      required: true,
      label: 'Plan',
    },

    // Step 6: Policy holder
    'proposer.firstName': { path: 'proposer.firstName', rule: 'name', required: true, label: 'First name' },
    'proposer.lastName': { path: 'proposer.lastName', rule: 'name', required: true, label: 'Last name' },
    'proposer.email': { path: 'proposer.email', rule: 'email', required: true, label: 'Email' },
    'proposer.confirmEmail': { path: 'proposer.confirmEmail', rule: 'email', label: 'Confirm email' },
    'proposer.phone': { path: 'proposer.phone', rule: 'phoneE164', required: true, label: 'Phone' },
    'proposer.idType': { path: 'proposer.idType', rule: 'nonEmptyString', label: 'ID type' },
    'proposer.idNumber': { path: 'proposer.idNumber', rule: 'nonEmptyString', label: 'ID number' },
    'proposer.address.line1': { path: 'proposer.address.line1', rule: 'nonEmptyString', required: true, label: 'Address' },
    'proposer.address.city': { path: 'proposer.address.city', rule: 'name', required: true, label: 'City' },
    'proposer.address.country': {
      path: 'proposer.address.country',
      rule: 'countryName',
      required: true,
      label: 'Country',
    },
    'proposer.marketingConsent': {
      path: 'proposer.marketingConsent',
      rule: 'bool',
      required: true,
      audience: 'customer',
      label: 'Marketing consent',
    },
    'proposer.feedbackConsent': {
      path: 'proposer.feedbackConsent',
      rule: 'bool',
      audience: 'customer',
      label: 'Feedback consent',
    },

    // Step 7: Declarations (merged into your-details step from Lloyd's-approved Step 6)
    'declarations.medicalNotice': {
      path: 'declarations.medicalNotice',
      rule: 'mustAccept',
      required: true,
      label: 'Medical notice acknowledgement',
    },
    'declarations.howToClaimReview': {
      path: 'declarations.howToClaimReview',
      rule: 'mustAccept',
      required: true,
      label: 'How to Claim / Complain / Privacy reviewed',
    },
    'declarations.personalDataConsent': {
      path: 'declarations.personalDataConsent',
      rule: 'mustAccept',
      required: true,
      label: 'Personal data consent',
    },
    'declarations.contractConsent': {
      path: 'declarations.contractConsent',
      rule: 'mustAccept',
      required: true,
      label: 'Contract consent',
    },
    'declarations.contractAgreement': {
      path: 'declarations.contractAgreement',
      rule: 'mustAccept',
      required: true,
      label: 'Payment portal agreement',
    },
  },
  steps: [
    {
      id: 'eligibility',
      fields: [
        'eligibility.countryOfResidence',
        'eligibility.nationality',
        'eligibility.hasOtherNationality',
        'eligibility.otherNationality',
        'eligibility.residenceDuration',
        'eligibility.willRemainResident',
        'eligibility.residencyStatus',
        'eligibility.legallyPermittedToReside',
        'eligibility.informationAccurate',
        'eligibility.legalAgreement',
      ],
      refinements: [
        (data, ctx) => {
          // ADR-0025 objective expat-eligibility cross-field gates.
          // Each emits the verbatim Peter-approved decline message at the
          // path of the answer that triggered it, so the wizard error
          // summary points the customer at the field they need to amend.
          const country = data['eligibility.countryOfResidence'];
          const nationality = data['eligibility.nationality'];
          if (residenceMatchesNationality(country, nationality)) {
            ctx.addIssue({
              code: 'custom',
              path: ['eligibility.nationality'],
              message: TRAVEL_ELIGIBILITY_DECLINE_MESSAGES.NATIONALITY_EQUALS_RESIDENCE,
            });
          }

          const hasOther = data['eligibility.hasOtherNationality'] === true;
          const otherNationality = data['eligibility.otherNationality'];
          if (hasOther && !String(otherNationality || '').trim()) {
            ctx.addIssue({
              code: 'custom',
              path: ['eligibility.otherNationality'],
              message: 'Please enter your other nationality.',
            });
          }
          if (hasOther && residenceMatchesNationality(country, otherNationality)) {
            ctx.addIssue({
              code: 'custom',
              path: ['eligibility.otherNationality'],
              message: TRAVEL_ELIGIBILITY_DECLINE_MESSAGES.NATIONALITY_EQUALS_RESIDENCE,
            });
          }

          if (data['eligibility.willRemainResident'] === false) {
            ctx.addIssue({
              code: 'custom',
              path: ['eligibility.willRemainResident'],
              message: TRAVEL_ELIGIBILITY_DECLINE_MESSAGES.WILL_NOT_REMAIN_RESIDENT,
            });
          }

          if (data['eligibility.legallyPermittedToReside'] === false) {
            ctx.addIssue({
              code: 'custom',
              path: ['eligibility.legallyPermittedToReside'],
              message: TRAVEL_ELIGIBILITY_DECLINE_MESSAGES.NOT_LEGALLY_RESIDENT,
            });
          }

          if (data['eligibility.informationAccurate'] === false) {
            ctx.addIssue({
              code: 'custom',
              path: ['eligibility.informationAccurate'],
              message: TRAVEL_ELIGIBILITY_DECLINE_MESSAGES.INFORMATION_NOT_CONFIRMED,
            });
          }
        },
      ],
    },
    {
      id: 'travellers',
      fields: ['travellers.coverType', 'travellers.travellerCount', 'travellers.leadTravellerDOB', 'travellers.additionalTravellerDOBs'],
      refinements: [validateTravellerDobSet],
    },
    {
      id: 'trip',
      fields: [
        'proposer.firstName',
        'proposer.lastName',
        'proposer.email',
        'proposer.phone',
        'trip.planType',
        'trip.destinations',
        'trip.startDate',
        'trip.endDate',
        'risk.hasPreviousTravelClaim',
        'risk.previousTravelClaimBand',
      ],
      refinements: [
        validatePriorTravelClaimBand,
        validateTripDetails,
      ],
    },
    {
      id: 'plans',
      fields: ['quote.selectedPlan'],
    },
    {
      id: 'options',
      fields: [],
    },
    {
      // Merged step: Your Details + all Declarations in the Lloyd's-approved order.
      id: 'your-details',
      fields: [
        'proposer.firstName',
        'proposer.lastName',
        'proposer.email',
        'proposer.confirmEmail',
        'proposer.phone',
        'proposer.address.line1',
        'proposer.address.city',
        'proposer.address.country',
        'proposer.marketingConsent',
        'proposer.feedbackConsent',
        'travellers.additionalTravellers',
        'declarations.medicalNotice',
        'declarations.howToClaimReview',
        'declarations.personalDataConsent',
        'declarations.contractConsent',
        'declarations.contractAgreement',
      ],
      // Phase 6j (2026-04-28): the email-match cross-field rule moved
      // from inline JSX (Step6DetailsAndDeclarations.tsx, deleted) to
      // here so the canonical Travel profile owns every your-details
      // validation rule.
      refinements: [
        (data, ctx, extras) => {
          const email = String(data['proposer.email'] || '').trim().toLowerCase();
          const confirmEmail = String(data['proposer.confirmEmail'] || '').trim().toLowerCase();
          if (email && confirmEmail && email !== confirmEmail) {
            ctx.addIssue({
              code: 'custom',
              path: ['proposer.confirmEmail'],
              message: 'Email addresses do not match',
            });
          }
          const travellers = extras.raw && typeof extras.raw === 'object'
            ? (extras.raw as { travellers?: Record<string, unknown> }).travellers || {}
            : {};
          const coverType = String(travellers.coverType || data['travellers.coverType'] || '');
          const count = requiredTravellerCount(coverType, travellers.travellerCount ?? data['travellers.travellerCount']);
          validateAdditionalTravellerDetails(travellers.additionalTravellers, Math.max(0, count - 1), ctx);
        },
      ],
    },
    {
      id: 'payment',
      fields: [],
    },
  ],
  stages: {
    quote: {
      fields: [
        'eligibility.countryOfResidence',
        'eligibility.nationality',
        'eligibility.hasOtherNationality',
        'eligibility.residenceDuration',
        'eligibility.willRemainResident',
        'eligibility.residencyStatus',
        'eligibility.legallyPermittedToReside',
        'eligibility.informationAccurate',
        'eligibility.legalAgreement',
        'proposer.firstName',
        'proposer.lastName',
        'proposer.email',
        'proposer.phone',
        'travellers.coverType',
        'travellers.travellerCount',
        'travellers.leadTravellerDOB',
        'travellers.additionalTravellerDOBs',
        'trip.planType',
        'trip.destinations',
        'trip.startDate',
        'trip.endDate',
        'risk.hasPreviousTravelClaim',
        'risk.previousTravelClaimBand',
      ],
      refinements: [validateTravellerDobSet, validatePriorTravelClaimBand, validateTripDetails],
    },
    bind: {
      fields: [
        'eligibility.countryOfResidence',
        'eligibility.nationality',
        'eligibility.hasOtherNationality',
        'eligibility.residenceDuration',
        'eligibility.willRemainResident',
        'eligibility.residencyStatus',
        'eligibility.legallyPermittedToReside',
        'eligibility.informationAccurate',
        'eligibility.legalAgreement',
        'proposer.firstName',
        'proposer.lastName',
        'proposer.email',
        'proposer.phone',
        'proposer.address.line1',
        'proposer.address.city',
        'proposer.address.country',
        'travellers.coverType',
        'travellers.travellerCount',
        'travellers.leadTravellerDOB',
        'travellers.additionalTravellerDOBs',
        'travellers.additionalTravellers',
        'trip.planType',
        'trip.destinations',
        'trip.startDate',
        'trip.endDate',
        'risk.hasPreviousTravelClaim',
        'risk.previousTravelClaimBand',
        'quote.selectedPlan',
        'declarations.medicalNotice',
        'declarations.howToClaimReview',
        'declarations.personalDataConsent',
        'declarations.contractConsent',
        'declarations.contractAgreement',
      ],
      refinements: [validatePriorTravelClaimBand],
    },
    issuance: {
      fields: [
        'eligibility.countryOfResidence',
        'eligibility.nationality',
        'eligibility.hasOtherNationality',
        'eligibility.residenceDuration',
        'eligibility.willRemainResident',
        'eligibility.residencyStatus',
        'eligibility.legallyPermittedToReside',
        'eligibility.informationAccurate',
        'eligibility.legalAgreement',
        'proposer.firstName',
        'proposer.lastName',
        'proposer.email',
        'proposer.phone',
        'proposer.address.line1',
        'proposer.address.city',
        'proposer.address.country',
        'travellers.coverType',
        'travellers.travellerCount',
        'travellers.leadTravellerDOB',
        'travellers.additionalTravellerDOBs',
        'travellers.additionalTravellers',
        'trip.planType',
        'trip.destinations',
        'trip.startDate',
        'trip.endDate',
        'risk.hasPreviousTravelClaim',
        'risk.previousTravelClaimBand',
        'quote.selectedPlan',
        'declarations.medicalNotice',
        'declarations.howToClaimReview',
        'declarations.personalDataConsent',
        'declarations.contractConsent',
        'declarations.contractAgreement',
      ],
      refinements: [
        validatePriorTravelClaimBand,
        (data, ctx, extras) => {
          validateTravellerDobSet(data, ctx);
          const travellers = extras.raw && typeof extras.raw === 'object'
            ? (extras.raw as { travellers?: Record<string, unknown> }).travellers || {}
            : {};
          const coverType = String(travellers.coverType || data['travellers.coverType'] || '');
          const count = requiredTravellerCount(coverType, travellers.travellerCount ?? data['travellers.travellerCount']);
          validateAdditionalTravellerDetails(travellers.additionalTravellers, Math.max(0, count - 1), ctx);
        },
      ],
    },
  },
};
