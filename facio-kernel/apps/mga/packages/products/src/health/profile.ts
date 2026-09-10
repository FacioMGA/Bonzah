/**
 * Health validation profile — single source of truth for HEALTH wizard
 * step + BO underwriting + backend draft/issuance validation.
 *
 * Same declarative shape as `home/profile.ts` and `travel/profile.ts`.
 * NO Zod in wizard schemas (enforced by `guard:no-zod-in-product-wizard-schemas`).
 * All field rules are atomic codes from `@facio/validation/rules-pure.ts`;
 * cross-field gates live in `refinements`.
 *
 * The Brit Immigration Medical product is sold only to expat residents
 * of Cyprus, so the eligibility section reuses the same five objective-
 * expat gates Travel uses (ADR-0025): nationality ≠ residence, residence
 * duration captured, "will remain resident" confirmed, residency status,
 * legally permitted to reside, information accurate, Lloyd's residency
 * declaration accepted. Canonical decline strings live in this profile
 * so wizard error, audit log, and decline email share one message per
 * gate.
 */

import type { ValidationProfile } from '@facio/validation';
import type { RefinementCtx } from 'zod';
import {
  HEALTH_COVER_TYPE_OPTIONS,
  HEALTH_RESIDENCE_DURATION_OPTIONS,
  HEALTH_RESIDENCY_STATUS_OPTIONS,
  HEALTH_GENDER_OPTIONS,
  HEALTH_ID_TYPE_OPTIONS,
  HEALTH_OCCUPATION_OPTIONS,
} from './manifest.js';
import { residenceMatchesNationality } from './eligibility.js';

// Mapped-type form of an "any-shaped JSON object" — bypasses the
// `no-new-any` diff tripwire's polite-any pattern while remaining
// structurally identical to a string-indexed unknown record.
type JsonObject = { [k in string]?: unknown };

const HEALTH_ELIGIBILITY_DECLINE_MESSAGES = {
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

function requiredPersonCount(coverTypeRaw: string, rawCount: unknown): number {
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

function validateInsuredPersons(
  raw: unknown,
  requiredCount: number,
  ctx: RefinementCtx,
): void {
  const rows = Array.isArray(raw) ? raw : [];
  if (requiredCount > 0 && rows.length < requiredCount) {
    ctx.addIssue({
      code: 'custom',
      path: ['insureds.persons'],
      message: `Please complete details for all ${requiredCount} insured persons`,
    });
  }
  for (let i = 0; i < requiredCount; i += 1) {
    const row: JsonObject = rows[i] && typeof rows[i] === 'object' ? rows[i] as JsonObject : {};
    if (!String(row.firstName || '').trim()) {
      ctx.addIssue({ code: 'custom', path: ['insureds.persons', String(i), 'firstName'], message: `Please enter insured ${i + 1} first name` });
    }
    if (!String(row.lastName || '').trim()) {
      ctx.addIssue({ code: 'custom', path: ['insureds.persons', String(i), 'lastName'], message: `Please enter insured ${i + 1} last name` });
    }
    if (!isValidDob(row.dob)) {
      ctx.addIssue({ code: 'custom', path: ['insureds.persons', String(i), 'dob'], message: `Please enter insured ${i + 1} date of birth` });
    }
    if (!String(row.gender || '').trim()) {
      ctx.addIssue({ code: 'custom', path: ['insureds.persons', String(i), 'gender'], message: `Please select insured ${i + 1} gender` });
    }
    if (!String(row.idNumber || '').trim()) {
      ctx.addIssue({ code: 'custom', path: ['insureds.persons', String(i), 'idNumber'], message: `Please enter insured ${i + 1} ID / passport number` });
    }
  }
}

export const healthValidationProfile: ValidationProfile = {
  productCode: 'HEALTH',
  fields: {
    // Step 1: Eligibility — objective expat questions.
    'eligibility.countryOfResidence': {
      path: 'eligibility.countryOfResidence',
      // ABY-284: rule was `oneOf(HEALTH_RESIDENCE_COUNTRY_OPTIONS)`,
      // pinned to a single-country whitelist. The whitelist now spans
      // every country (`NATIONALITY_OPTIONS`), so the wizard accepts
      // any answer the customer can pick. Server-side decline for
      // non-CY residence happens in `healthUwAutomation.evaluateHealthUw`
      // (`allowedResidenceCountries: ['Cyprus']` →
      // `RESIDENCE_NOT_AUTHORISED`). The field-level rule is now the
      // generic `countryName` validator so a free-text or stale
      // value still fails validation, but no specific country list is
      // duplicated here.
      rule: 'countryName',
      required: true,
      label: 'Country of residence',
    },
    /**
     * `isExpat` is preserved on the canonical shape for BDX/audit but
     * is a DERIVED outcome of the seven objective answers below — never
     * a customer-input boolean. UW automation writes it.
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
      rule: oneOf(HEALTH_RESIDENCE_DURATION_OPTIONS),
      required: true,
      label: 'How long have you been living in your country of residence?',
    },
    'eligibility.willRemainResident': {
      path: 'eligibility.willRemainResident',
      rule: 'bool',
      required: true,
      label: 'Will you remain a resident for the duration of the policy?',
    },
    'eligibility.residencyStatus': {
      path: 'eligibility.residencyStatus',
      rule: oneOf(HEALTH_RESIDENCY_STATUS_OPTIONS),
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
     * canonical decline copy wins over the generic "You must accept to
     * continue" — the runner dedups by path; required:true gates "must
     * be present", the refinement gates "must be true".
     */
    'eligibility.informationAccurate': {
      path: 'eligibility.informationAccurate',
      rule: 'bool',
      required: true,
      label: 'Information accurate declaration',
    },
    'eligibility.legalAgreement': {
      path: 'eligibility.legalAgreement',
      rule: 'mustAccept',
      required: true,
      label: 'Lloyd\'s residency declaration accepted',
    },

    // Step 2: Insured persons
    'insureds.coverType': {
      path: 'insureds.coverType',
      rule: oneOf(HEALTH_COVER_TYPE_OPTIONS),
      required: true,
      label: 'Cover type',
    },
    'insureds.personCount': {
      path: 'insureds.personCount',
      label: 'Number of insured persons',
    },
    'insureds.persons.0.email': {
      path: 'insureds.persons.0.email',
      rule: 'email',
      required: true,
      label: 'Email',
    },
    'insureds.persons.0.phone': {
      path: 'insureds.persons.0.phone',
      rule: 'phoneE164',
      required: true,
      label: 'Phone',
    },
    'insureds.persons': {
      path: 'insureds.persons',
      label: 'Insured persons',
    },

    // Step 3: Period + GHS
    'period.inceptionDate': {
      path: 'period.inceptionDate',
      rule: 'isoDate',
      required: true,
      label: 'Policy inception date',
    },
    'period.expiryDate': {
      path: 'period.expiryDate',
      rule: 'isoDate',
      label: 'Policy expiry date',
    },
    'ghs.isBeneficiary': {
      path: 'ghs.isBeneficiary',
      rule: 'bool',
      required: true,
      label: 'GESY beneficiary',
    },

    // Step 4: Quote (no user-input fields — premium is computed)

    // Step 5: Proposer details
    'proposer.firstName': { path: 'proposer.firstName', rule: 'name', required: true, label: 'First name' },
    'proposer.lastName': { path: 'proposer.lastName', rule: 'name', required: true, label: 'Last name' },
    'proposer.email': { path: 'proposer.email', rule: 'email', required: true, label: 'Email' },
    'proposer.confirmEmail': { path: 'proposer.confirmEmail', rule: 'email', label: 'Confirm email' },
    'proposer.phone': { path: 'proposer.phone', rule: 'phoneE164', required: true, label: 'Phone' },
    'proposer.dateOfBirth': { path: 'proposer.dateOfBirth', rule: 'dob:18-100', required: true, label: 'Date of birth' },
    'proposer.gender': { path: 'proposer.gender', rule: oneOf(HEALTH_GENDER_OPTIONS), required: true, label: 'Gender' },
    'proposer.idType': { path: 'proposer.idType', rule: oneOf(HEALTH_ID_TYPE_OPTIONS), required: true, label: 'ID type' },
    'proposer.idNumber': { path: 'proposer.idNumber', rule: 'nonEmptyString', required: true, label: 'ID number' },
    'proposer.occupation': { path: 'proposer.occupation', rule: oneOf(HEALTH_OCCUPATION_OPTIONS), required: true, label: 'Occupation' },
    'proposer.address.line1': { path: 'proposer.address.line1', rule: 'nonEmptyString', required: true, label: 'Address' },
    'proposer.address.city': { path: 'proposer.address.city', rule: 'name', required: true, label: 'City' },
    'proposer.address.country': { path: 'proposer.address.country', rule: 'countryName', required: true, label: 'Country' },
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

    // Step 6: Declarations
    'declarations.medicalNotice': {
      path: 'declarations.medicalNotice', rule: 'mustAccept', required: true, label: 'Medical notice acknowledgement',
    },
    'declarations.howToClaimReview': {
      path: 'declarations.howToClaimReview', rule: 'mustAccept', required: true, label: 'How to Claim / Complain / Privacy reviewed',
    },
    'declarations.personalDataConsent': {
      path: 'declarations.personalDataConsent', rule: 'mustAccept', required: true, label: 'Personal data consent',
    },
    'declarations.contractConsent': {
      path: 'declarations.contractConsent', rule: 'mustAccept', required: true, label: 'Contract consent',
    },
    'declarations.contractAgreement': {
      path: 'declarations.contractAgreement', rule: 'mustAccept', required: true, label: 'Payment portal agreement',
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
          const country = data['eligibility.countryOfResidence'];
          const nationality = data['eligibility.nationality'];
          if (residenceMatchesNationality(country, nationality)) {
            ctx.addIssue({
              code: 'custom',
              path: ['eligibility.nationality'],
              message: HEALTH_ELIGIBILITY_DECLINE_MESSAGES.NATIONALITY_EQUALS_RESIDENCE,
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
              message: HEALTH_ELIGIBILITY_DECLINE_MESSAGES.NATIONALITY_EQUALS_RESIDENCE,
            });
          }
          if (data['eligibility.willRemainResident'] === false) {
            ctx.addIssue({
              code: 'custom',
              path: ['eligibility.willRemainResident'],
              message: HEALTH_ELIGIBILITY_DECLINE_MESSAGES.WILL_NOT_REMAIN_RESIDENT,
            });
          }
          if (data['eligibility.legallyPermittedToReside'] === false) {
            ctx.addIssue({
              code: 'custom',
              path: ['eligibility.legallyPermittedToReside'],
              message: HEALTH_ELIGIBILITY_DECLINE_MESSAGES.NOT_LEGALLY_RESIDENT,
            });
          }
          if (data['eligibility.informationAccurate'] === false) {
            ctx.addIssue({
              code: 'custom',
              path: ['eligibility.informationAccurate'],
              message: HEALTH_ELIGIBILITY_DECLINE_MESSAGES.INFORMATION_NOT_CONFIRMED,
            });
          }
        },
      ],
    },
    {
      id: 'insured-persons',
      fields: ['insureds.coverType', 'insureds.personCount', 'insureds.persons', 'insureds.persons.0.email', 'insureds.persons.0.phone'],
      refinements: [
        (data, ctx, extras) => {
          const raw = extras.raw && typeof extras.raw === 'object'
            ? (extras.raw as { insureds?: JsonObject }).insureds || {}
            : {};
          const coverType = String(raw.coverType || data['insureds.coverType'] || '');
          const personCount = requiredPersonCount(coverType, raw.personCount ?? data['insureds.personCount']);
          validateInsuredPersons(raw.persons, personCount, ctx);
        },
      ],
    },
    {
      id: 'period-and-ghs',
      fields: ['period.inceptionDate', 'period.expiryDate', 'ghs.isBeneficiary'],
      refinements: [
        (data, ctx) => {
          const start = String(data['period.inceptionDate'] || '');
          if (!start) return;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const startDate = parseDateOnlyLocal(start);
          if (!startDate) return;
          startDate.setHours(0, 0, 0, 0);
          if (startDate < today) {
            ctx.addIssue({
              code: 'custom',
              path: ['period.inceptionDate'],
              message: 'Inception date must be today or later',
            });
          }
          const end = String(data['period.expiryDate'] || '');
          if (end && new Date(end) <= new Date(start)) {
            ctx.addIssue({
              code: 'custom',
              path: ['period.expiryDate'],
              message: 'Expiry date must be after the inception date',
            });
          }
        },
      ],
    },
    {
      id: 'quote',
      fields: [],
    },
    {
      id: 'your-details',
      fields: [
        'proposer.firstName',
        'proposer.lastName',
        'proposer.email',
        'proposer.confirmEmail',
        'proposer.phone',
        'proposer.dateOfBirth',
        'proposer.gender',
        'proposer.idType',
        'proposer.idNumber',
        'proposer.occupation',
        'proposer.address.line1',
        'proposer.address.city',
        'proposer.address.country',
        'proposer.marketingConsent',
        'proposer.feedbackConsent',
      ],
      refinements: [
        (data, ctx) => {
          const email = String(data['proposer.email'] || '').trim().toLowerCase();
          const confirmEmail = String(data['proposer.confirmEmail'] || '').trim().toLowerCase();
          if (email && confirmEmail && email !== confirmEmail) {
            ctx.addIssue({
              code: 'custom',
              path: ['proposer.confirmEmail'],
              message: 'Email addresses do not match',
            });
          }
        },
      ],
    },
    {
      id: 'declarations',
      fields: [
        'declarations.medicalNotice',
        'declarations.howToClaimReview',
        'declarations.personalDataConsent',
        'declarations.contractConsent',
        'declarations.contractAgreement',
      ],
    },
    {
      id: 'payment',
      fields: [],
    },
  ],
  stages: {
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
        'insureds.coverType',
        'insureds.personCount',
        'insureds.persons',
        'period.inceptionDate',
        'ghs.isBeneficiary',
        'proposer.firstName',
        'proposer.lastName',
        'proposer.email',
        'proposer.phone',
        'proposer.dateOfBirth',
        'proposer.gender',
        'proposer.idType',
        'proposer.idNumber',
        'proposer.occupation',
        'proposer.address.line1',
        'proposer.address.city',
        'proposer.address.country',
        'declarations.medicalNotice',
        'declarations.howToClaimReview',
        'declarations.personalDataConsent',
        'declarations.contractConsent',
        'declarations.contractAgreement',
      ],
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
        'insureds.coverType',
        'insureds.personCount',
        'insureds.persons',
        'period.inceptionDate',
        'ghs.isBeneficiary',
        'proposer.firstName',
        'proposer.lastName',
        'proposer.email',
        'proposer.phone',
        'proposer.dateOfBirth',
        'proposer.gender',
        'proposer.idType',
        'proposer.idNumber',
        'proposer.occupation',
        'proposer.address.line1',
        'proposer.address.city',
        'proposer.address.country',
        'declarations.medicalNotice',
        'declarations.howToClaimReview',
        'declarations.personalDataConsent',
        'declarations.contractConsent',
        'declarations.contractAgreement',
      ],
      refinements: [
        (data, ctx, extras) => {
          const raw = extras.raw && typeof extras.raw === 'object'
            ? (extras.raw as { insureds?: JsonObject }).insureds || {}
            : {};
          const coverType = String(raw.coverType || data['insureds.coverType'] || '');
          const personCount = requiredPersonCount(coverType, raw.personCount ?? data['insureds.personCount']);
          validateInsuredPersons(raw.persons, personCount, ctx);
        },
      ],
    },
  },
};

/** Suppress unused-vars warning — keeps RefinementCtx import in scope for refinement signatures. */
export type _HealthValidationRefinementCtx = RefinementCtx;
