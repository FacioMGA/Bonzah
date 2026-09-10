/**
 * Travel validation profile — declaration alignment + canonical-shape pinning.
 *
 * History:
 *   - Bug #2A: travel manifest + validation profile referenced declaration
 *     paths the wizard had already migrated away from. The canonical
 *     declaration set is the Lloyd's-approved five-checkbox group:
 *     `declarations.medicalNotice`, `declarations.howToClaimReview`,
 *     `declarations.personalDataConsent`, `declarations.contractConsent`,
 *     `declarations.contractAgreement`.
 *
 *   - Bug #2B (Phase 2.5 cutover): older drafts persisted policyholder
 *     details at the ROOT of the quote (`firstName`, `email`, `telephone`,
 *     …). The pre-cutover fix added a `travelCanonicalShape` Zod
 *     preprocess that lifted root aliases into `proposer.*` before
 *     validation ran. Phase 2.5 deleted that preprocess. Data
 *     canonicalization now happens once, at write time:
 *
 *       1. Prisma migration `20260427153132_canonicalize_travel_proposer`
 *          rewrote every TRAVEL row to the nested shape.
 *       2. The HTTP boundary (`uwRouter` → `findLegacyTravelRootKey`)
 *          rejects any patch that tries to reintroduce a root-level
 *          proposer alias with `400 INVALID_BODY`.
 *
 *     The runner therefore validates the canonical (nested) shape only.
 *     If a row ever shows up with root-level proposer data, the friendly
 *     "please enter …" required errors are the correct underwriter
 *     signal — the data is genuinely missing under the canonical path
 *     and must be re-entered or backfilled.
 *
 * These tests pin both the declaration-path alignment and the
 * post-cutover validation contract.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValidationRegistry, validateForContext } from '@facio/validation/backend';
import { travelValidationProfile } from '../profile.js';

beforeEach(() => {
  ValidationRegistry.register(travelValidationProfile);
});

afterEach(() => {
  ValidationRegistry._resetForTests();
});

const FIVE_DECLARATIONS = {
  medicalNotice: true,
  howToClaimReview: true,
  personalDataConsent: true,
  contractConsent: true,
  contractAgreement: true,
} as const;

const VALID_TRIP = {
  planType: 'single_trip',
  destinations: ['europe'],
  startDate: '2026-08-01',
  endDate: '2026-08-08',
} as const;

const VALID_ELIGIBILITY = {
  countryOfResidence: 'Portugal',
  // ADR-0025 objective expat-eligibility inputs — replace the old
  // self-declared `isExpat` boolean. A British national resident in
  // Portugal is the canonical pass case.
  nationality: 'United Kingdom',
  hasOtherNationality: false,
  residenceDuration: '1_3_years',
  willRemainResident: true,
  residencyStatus: 'permanent_resident',
  legallyPermittedToReside: true,
  informationAccurate: true,
  legalAgreement: true,
} as const;

const VALID_TRAVELLERS = {
  coverType: 'single',
  leadTravellerDOB: '1985-05-15',
} as const;

const VALID_QUOTE = { selectedPlan: 'silver' } as const;

// ADR-0054: no previous travel claim → no loading, no referral. Included in
// bind/issuance payloads because `risk.hasPreviousTravelClaim` is required.
const VALID_RISK = { hasPreviousTravelClaim: false } as const;

const VALID_PROPOSER = {
  firstName: 'Uriel',
  lastName: 'Aharoni',
  email: 'uriel@example.com',
  phone: '+972502440556',
  address: { line1: '1 Main St', city: 'Lisbon', country: 'Portugal' },
} as const;

function isoDateOffset(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function rateableTrip() {
  return {
    ...VALID_TRIP,
    startDate: isoDateOffset(1),
    endDate: isoDateOffset(8),
  };
}

describe('Travel validation profile — canonical shape only (Phase 2.5)', () => {
  it('canonical nested proposer shape passes issuance', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'stage', id: 'issuance' },
      actor: 'server',
      data: {
        eligibility: VALID_ELIGIBILITY,
        travellers: VALID_TRAVELLERS,
        trip: VALID_TRIP,
        quote: VALID_QUOTE,
        risk: VALID_RISK,
        proposer: { ...VALID_PROPOSER, marketingConsent: true, feedbackConsent: false },
        declarations: FIVE_DECLARATIONS,
      },
    });
    expect(errors).toEqual({});
  });

  it('legacy root-level proposer shape is no longer lifted; required errors fire', () => {
    // Phase 2.5 explicitly REJECTS the legacy alias shape. Pre-cutover this
    // exact payload silently lifted into the canonical shape and passed.
    // The runner now sees `proposer.firstName` etc. as missing and emits
    // the friendly required messages — this is the contract.
    const legacyShape = {
      firstName: 'Uriel',
      lastName: 'Aharoni',
      email: 'uriel@example.com',
      telephone: '+972502440556',
      dateOfBirth: '1987-04-18',
      eligibility: VALID_ELIGIBILITY,
      travellers: VALID_TRAVELLERS,
      trip: VALID_TRIP,
      quote: VALID_QUOTE,
      proposer: {
        address: VALID_PROPOSER.address,
      },
      declarations: FIVE_DECLARATIONS,
    };

    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'stage', id: 'issuance' },
      actor: 'server',
      data: legacyShape,
    });

    expect(errors['proposer.firstName']).toBeDefined();
    expect(errors['proposer.lastName']).toBeDefined();
    expect(errors['proposer.email']).toBeDefined();
    expect(errors['proposer.phone']).toBeDefined();
  });

  it('emits friendly errors when neither root nor nested value is present', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'stage', id: 'issuance' },
      actor: 'server',
      data: {
        eligibility: VALID_ELIGIBILITY,
        travellers: VALID_TRAVELLERS,
        trip: VALID_TRIP,
        quote: VALID_QUOTE,
        proposer: {},
        declarations: FIVE_DECLARATIONS,
      },
    });
    expect(errors['proposer.firstName']).toMatch(/at least 2 characters|enter/i);
    expect(errors['proposer.email']).toMatch(/email/i);
    expect(errors['proposer.phone']).toBeDefined();
  });
});

describe('Travel validation profile — contact required before quote', () => {
  it('requires proposer name, email, and phone on the trip step before plans are shown', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'wizardStep', id: 'trip' },
      actor: 'customer',
      data: {
        proposer: {},
        trip: rateableTrip(),
        risk: VALID_RISK,
      },
    });

    expect(errors['proposer.firstName']).toBeDefined();
    expect(errors['proposer.lastName']).toBeDefined();
    expect(errors['proposer.email']).toBeDefined();
    expect(errors['proposer.phone']).toBeDefined();
  });

  it('requires contact details in the server quote-rating stage', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'stage', id: 'quote' },
      actor: 'server',
      data: {
        eligibility: VALID_ELIGIBILITY,
        travellers: VALID_TRAVELLERS,
        trip: rateableTrip(),
        risk: VALID_RISK,
      },
    });

    expect(errors['proposer.firstName']).toBeDefined();
    expect(errors['proposer.lastName']).toBeDefined();
    expect(errors['proposer.email']).toBeDefined();
    expect(errors['proposer.phone']).toBeDefined();
  });

  it('rates with contact details before plan selection, address, or declarations are collected', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'stage', id: 'quote' },
      actor: 'server',
      data: {
        eligibility: VALID_ELIGIBILITY,
        travellers: VALID_TRAVELLERS,
        trip: rateableTrip(),
        risk: VALID_RISK,
        proposer: {
          firstName: VALID_PROPOSER.firstName,
          lastName: VALID_PROPOSER.lastName,
          email: VALID_PROPOSER.email,
          phone: VALID_PROPOSER.phone,
        },
      },
    });

    expect(errors).toEqual({});
  });
});

describe('Travel validation profile — traveller DOB/details set', () => {
  it('requires a DOB for every traveller covered by couple/family cover', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'wizardStep', id: 'travellers' },
      actor: 'customer',
      data: {
        travellers: {
          coverType: 'couple',
          travellerCount: 2,
          leadTravellerDOB: '1985-05-15',
          additionalTravellerDOBs: [],
        },
      },
    });

    expect(errors['travellers.additionalTravellerDOBs']).toMatch(/all 2 travellers/i);
  });

  it('accepts family traveller DOBs when the count matches', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'wizardStep', id: 'travellers' },
      actor: 'customer',
      data: {
        travellers: {
          coverType: 'family',
          travellerCount: 3,
          leadTravellerDOB: '1985-05-15',
          additionalTravellerDOBs: ['2012-01-01', '2014-01-01'],
        },
      },
    });

    expect(errors).toEqual({});
  });

  it('requires additional traveller identity details before payment', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'wizardStep', id: 'your-details' },
      actor: 'customer',
      data: {
        eligibility: VALID_ELIGIBILITY,
        travellers: {
          coverType: 'couple',
          travellerCount: 2,
          leadTravellerDOB: '1985-05-15',
          additionalTravellerDOBs: ['1988-06-20'],
          additionalTravellers: [{ firstName: '', lastName: '', idType: '', idNumber: '' }],
        },
        trip: VALID_TRIP,
        quote: VALID_QUOTE,
        proposer: { ...VALID_PROPOSER, marketingConsent: true, feedbackConsent: false },
        declarations: FIVE_DECLARATIONS,
      },
    });

    expect(errors['travellers.additionalTravellers']).toMatch(/traveller|first name|ID proof/i);
  });
});

describe('Travel validation profile — declarations alignment (Bug #2A)', () => {
  it('uses the same declaration paths the wizard writes', () => {
    const wizardWrittenPaths = [
      'declarations.medicalNotice',
      'declarations.howToClaimReview',
      'declarations.personalDataConsent',
      'declarations.contractConsent',
      'declarations.contractAgreement',
    ];
    for (const path of wizardWrittenPaths) {
      expect(travelValidationProfile.fields[path]).toBeDefined();
    }
    const dropped = [
      'declarations.agreedToTermsConditions',
      'declarations.medicalConditionsNotice',
      'declarations.confirmedNotPreviouslyClaimed',
      'declarations.acknowledgedFraudWarning',
      'declarations.confirmedHealthDeclaration',
    ];
    for (const path of dropped) {
      expect(travelValidationProfile.fields[path]).toBeUndefined();
    }
  });

  it('issuance passes when the five Lloyd-approved declarations are accepted', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'stage', id: 'issuance' },
      actor: 'server',
      data: {
        eligibility: VALID_ELIGIBILITY,
        travellers: VALID_TRAVELLERS,
        trip: VALID_TRIP,
        quote: VALID_QUOTE,
        risk: VALID_RISK,
        proposer: VALID_PROPOSER,
        declarations: FIVE_DECLARATIONS,
      },
    });
    expect(errors).toEqual({});
  });

  it('issuance flags any unaccepted declaration with a friendly message', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'stage', id: 'issuance' },
      actor: 'server',
      data: {
        eligibility: VALID_ELIGIBILITY,
        travellers: VALID_TRAVELLERS,
        trip: VALID_TRIP,
        quote: VALID_QUOTE,
        proposer: VALID_PROPOSER,
        declarations: { ...FIVE_DECLARATIONS, contractConsent: false },
      },
    });
    expect(errors['declarations.contractConsent']).toMatch(/accept/i);
    expect(errors['declarations.medicalNotice']).toBeUndefined();
  });

  it('rejects non-canonical select labels and legacy values', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'stage', id: 'issuance' },
      actor: 'server',
      data: {
        eligibility: VALID_ELIGIBILITY,
        travellers: { ...VALID_TRAVELLERS, coverType: 'Single Person' },
        trip: { ...VALID_TRIP, planType: 'single' },
        quote: { selectedPlan: 'Silver' },
        proposer: VALID_PROPOSER,
        declarations: FIVE_DECLARATIONS,
      },
    });

    expect(errors['travellers.coverType']).toMatch(/select one of/i);
    expect(errors['trip.planType']).toMatch(/select one of/i);
    expect(errors['quote.selectedPlan']).toMatch(/select one of/i);
  });
});

describe('Travel validation profile — annual policy period', () => {
  it('rejects trip start dates in the past', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'wizardStep', id: 'trip' },
      actor: 'customer',
      data: {
        trip: {
          ...VALID_TRIP,
          startDate: isoDateOffset(-1),
          endDate: isoDateOffset(7),
        },
        risk: VALID_RISK,
      },
    });

    expect(errors['trip.startDate']).toMatch(/today or later/i);
  });

  it('accepts a trip starting today', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'wizardStep', id: 'trip' },
      actor: 'customer',
      data: {
        trip: {
          ...VALID_TRIP,
          startDate: isoDateOffset(0),
          endDate: isoDateOffset(7),
        },
        risk: VALID_RISK,
      },
    });

    expect(errors['trip.startDate']).toBeUndefined();
  });

  it('rejects annual multi-trip end dates beyond one year from the start date', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'wizardStep', id: 'trip' },
      actor: 'customer',
      data: {
        trip: {
          ...VALID_TRIP,
          planType: 'annual_multi_trip',
          startDate: '2026-06-01',
          endDate: '2027-06-01',
        },
        risk: VALID_RISK,
      },
    });

    expect(errors['trip.endDate']).toMatch(/within one year/i);
  });

  it('accepts the canonical annual multi-trip end date', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'wizardStep', id: 'trip' },
      actor: 'customer',
      data: {
        trip: {
          ...VALID_TRIP,
          planType: 'annual_multi_trip',
          startDate: '2026-06-01',
          endDate: '2027-05-31',
        },
        risk: VALID_RISK,
      },
    });

    expect(errors['trip.endDate']).toBeUndefined();
  });
});

describe('Travel validation profile — prior-claims question (ADR-0054)', () => {
  const TRIP_TODAY = {
    ...VALID_TRIP,
    startDate: isoDateOffset(1),
    endDate: isoDateOffset(8),
  } as const;

  it('requires the claim band when a previous travel claim is declared (no silent default)', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'wizardStep', id: 'trip' },
      actor: 'customer',
      data: {
        trip: TRIP_TODAY,
        risk: { hasPreviousTravelClaim: true },
      },
    });
    expect(errors['risk.previousTravelClaimBand']).toBeDefined();
  });

  it('accepts hasPreviousTravelClaim = true with a valid band', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'wizardStep', id: 'trip' },
      actor: 'customer',
      data: {
        trip: TRIP_TODAY,
        risk: { hasPreviousTravelClaim: true, previousTravelClaimBand: 'over_500' },
      },
    });
    expect(errors['risk.hasPreviousTravelClaim']).toBeUndefined();
    expect(errors['risk.previousTravelClaimBand']).toBeUndefined();
  });

  it('does not require a band when no previous claim is declared', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'wizardStep', id: 'trip' },
      actor: 'customer',
      data: {
        trip: TRIP_TODAY,
        risk: { hasPreviousTravelClaim: false },
      },
    });
    expect(errors['risk.previousTravelClaimBand']).toBeUndefined();
  });

  it('rejects an unknown band value', () => {
    const errors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'wizardStep', id: 'trip' },
      actor: 'customer',
      data: {
        trip: TRIP_TODAY,
        risk: { hasPreviousTravelClaim: true, previousTravelClaimBand: 'up_to_1000' },
      },
    });
    expect(errors['risk.previousTravelClaimBand']).toMatch(/select one of/i);
  });
});

describe('Travel validation profile — objective expat eligibility (ADR-0025)', () => {
  function eligibilityErrors(eligibility: Record<string, unknown>) {
    return validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'wizardStep', id: 'eligibility' },
      actor: 'customer',
      data: { eligibility },
    });
  }

  const VALID_ELIGIBILITY_INPUT = {
    countryOfResidence: 'Portugal',
    nationality: 'United Kingdom',
    hasOtherNationality: false,
    residenceDuration: '1_3_years',
    willRemainResident: true,
    residencyStatus: 'permanent_resident',
    legallyPermittedToReside: true,
    informationAccurate: true,
    legalAgreement: true,
  } as const;

  it('passes a complete British-in-Portugal eligibility set', () => {
    const errors = eligibilityErrors({ ...VALID_ELIGIBILITY_INPUT });
    expect(errors).toEqual({});
  });

  it('fails NATIONALITY_EQUALS_RESIDENCE with verbatim Peter message', () => {
    const errors = eligibilityErrors({ ...VALID_ELIGIBILITY_INPUT, nationality: 'Portugal' });
    expect(errors['eligibility.nationality']).toMatch(/We can only insure expatriate residents/);
    expect(errors['eligibility.nationality']).toContain('your nationality matches your country of residence');
  });

  it('fails OTHER_NATIONALITY_EQUALS_RESIDENCE when second nationality matches residence', () => {
    const errors = eligibilityErrors({
      ...VALID_ELIGIBILITY_INPUT,
      hasOtherNationality: true,
      otherNationality: 'Portugal',
    });
    expect(errors['eligibility.otherNationality']).toMatch(/We can only insure expatriate residents/);
  });

  it('requires otherNationality when hasOtherNationality is true', () => {
    const errors = eligibilityErrors({
      ...VALID_ELIGIBILITY_INPUT,
      hasOtherNationality: true,
      // otherNationality intentionally omitted
    });
    expect(errors['eligibility.otherNationality']).toMatch(/Please enter your other nationality/);
  });

  it('fails WILL_NOT_REMAIN_RESIDENT with verbatim Peter message', () => {
    const errors = eligibilityErrors({ ...VALID_ELIGIBILITY_INPUT, willRemainResident: false });
    expect(errors['eligibility.willRemainResident']).toMatch(/remain resident.*duration of the policy/);
  });

  it('fails NOT_LEGALLY_RESIDENT with verbatim Peter message', () => {
    const errors = eligibilityErrors({ ...VALID_ELIGIBILITY_INPUT, legallyPermittedToReside: false });
    expect(errors['eligibility.legallyPermittedToReside']).toMatch(/legally resident/);
  });

  it('fails INFORMATION_NOT_CONFIRMED with verbatim Peter message', () => {
    const errors = eligibilityErrors({ ...VALID_ELIGIBILITY_INPUT, informationAccurate: false });
    expect(errors['eligibility.informationAccurate']).toMatch(/declaration of accuracy is confirmed/);
  });

  it('does NOT gate on residence duration regardless of value (Peter 2026-05-16)', () => {
    for (const duration of ['lt_1_year', '1_3_years', 'gt_3_years']) {
      const errors = eligibilityErrors({ ...VALID_ELIGIBILITY_INPUT, residenceDuration: duration });
      expect(errors['eligibility.residenceDuration'], `duration=${duration}`).toBeUndefined();
    }
  });

  it('does NOT gate on residency status regardless of value', () => {
    for (const status of ['permanent_resident', 'temporary_resident', 'work_visa', 'student_visa', 'visitor', 'other_visa']) {
      const errors = eligibilityErrors({ ...VALID_ELIGIBILITY_INPUT, residencyStatus: status });
      expect(errors['eligibility.residencyStatus'], `status=${status}`).toBeUndefined();
    }
  });

  it('does not ask the customer for `eligibility.isExpat` (derived UW outcome)', () => {
    // Profile keeps the field for canonical-shape persistence, but it
    // must NOT be in the wizard `eligibility` step's field list.
    const eligibilityStep = travelValidationProfile.steps.find((s) => s.id === 'eligibility');
    expect(eligibilityStep?.fields).not.toContain('eligibility.isExpat');
    expect(travelValidationProfile.fields['eligibility.isExpat']).toBeDefined();
    expect(travelValidationProfile.fields['eligibility.isExpat'].required).not.toBe(true);
  });
});
