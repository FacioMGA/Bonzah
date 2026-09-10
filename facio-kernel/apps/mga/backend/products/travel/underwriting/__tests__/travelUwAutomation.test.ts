import { describe, expect, it } from 'vitest';
import {
  TRAVEL_DECLINE_MESSAGES,
  TRAVEL_POLICYHOLDER_UNDER_MIN_AGE_MESSAGE,
  TRAVEL_PRIOR_CLAIM_OVER_THRESHOLD_MESSAGE,
  deriveIsExpat,
  evaluateTravelUw,
} from '../travelUwAutomation.js';

/**
 * ADR-0025 objective expat eligibility tests.
 *
 * Each decline-code test asserts the verbatim Peter-approved customer
 * message — drift in `TRAVEL_DECLINE_MESSAGES` flips these tests, which
 * is the intended behaviour: the messages ARE the contract surface for
 * downstream consumers (wizard inline error, audit log, declined-quote
 * email).
 */

const VALID_BASE = {
  leadTravellerAge: 35,
  destinations: ['Spain'],
  countryOfResidence: 'Republic of Cyprus',
  tripDurationDays: 7,
  tripType: 'Single trip' as const,
  nationality: 'United Kingdom',
  hasOtherNationality: false,
  willRemainResident: true,
  legallyPermittedToReside: true,
  informationAccurate: true,
};

describe('evaluateTravelUw — objective expat eligibility', () => {
  it('accepts a British national resident in Cyprus (canonical pass case)', () => {
    const decision = evaluateTravelUw(VALID_BASE);
    expect(decision.lane).toBe('accept');
    expect(decision.isExpat).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  it('declines NATIONALITY_EQUALS_RESIDENCE with verbatim Peter message', () => {
    const decision = evaluateTravelUw({
      ...VALID_BASE,
      nationality: 'Cyprus',
    });
    expect(decision.lane).toBe('decline');
    expect(decision.isExpat).toBe(false);
    expect(decision.reasons[0]?.code).toBe('NATIONALITY_EQUALS_RESIDENCE');
    expect(decision.reasons[0]?.message).toBe(TRAVEL_DECLINE_MESSAGES.NATIONALITY_EQUALS_RESIDENCE);
    expect(decision.reasons[0]?.message).toContain('expatriate residents');
  });

  it('declines Portuguese nationals resident in Portugal (PT territory local national)', () => {
    const decision = evaluateTravelUw({
      ...VALID_BASE,
      countryOfResidence: 'Portugal',
      nationality: 'Portugal',
    });
    expect(decision.lane).toBe('decline');
    expect(decision.reasons[0]?.code).toBe('NATIONALITY_EQUALS_RESIDENCE');
  });

  it('treats nationality comparison case-insensitively', () => {
    const decision = evaluateTravelUw({
      ...VALID_BASE,
      countryOfResidence: 'Republic of Cyprus',
      nationality: 'republic of cyprus',
    });
    expect(decision.lane).toBe('decline');
    expect(decision.reasons[0]?.code).toBe('NATIONALITY_EQUALS_RESIDENCE');
  });

  it('declines OTHER_NATIONALITY_EQUALS_RESIDENCE when second nationality matches residence', () => {
    const decision = evaluateTravelUw({
      ...VALID_BASE,
      countryOfResidence: 'Italy',
      nationality: 'United Kingdom',
      hasOtherNationality: true,
      otherNationality: 'Italy',
    });
    expect(decision.lane).toBe('decline');
    expect(decision.reasons[0]?.code).toBe('OTHER_NATIONALITY_EQUALS_RESIDENCE');
    expect(decision.reasons[0]?.message).toBe(TRAVEL_DECLINE_MESSAGES.OTHER_NATIONALITY_EQUALS_RESIDENCE);
  });

  it('declines WILL_NOT_REMAIN_RESIDENT with verbatim Peter message', () => {
    const decision = evaluateTravelUw({
      ...VALID_BASE,
      willRemainResident: false,
    });
    expect(decision.lane).toBe('decline');
    expect(decision.reasons[0]?.code).toBe('WILL_NOT_REMAIN_RESIDENT');
    expect(decision.reasons[0]?.message).toBe(TRAVEL_DECLINE_MESSAGES.WILL_NOT_REMAIN_RESIDENT);
    expect(decision.reasons[0]?.message).toContain('remain resident');
  });

  it('declines NOT_LEGALLY_RESIDENT with verbatim Peter message', () => {
    const decision = evaluateTravelUw({
      ...VALID_BASE,
      legallyPermittedToReside: false,
    });
    expect(decision.lane).toBe('decline');
    expect(decision.reasons[0]?.code).toBe('NOT_LEGALLY_RESIDENT');
    expect(decision.reasons[0]?.message).toBe(TRAVEL_DECLINE_MESSAGES.NOT_LEGALLY_RESIDENT);
    expect(decision.reasons[0]?.message).toContain('legally resident');
  });

  it('declines INFORMATION_NOT_CONFIRMED with verbatim Peter message', () => {
    const decision = evaluateTravelUw({
      ...VALID_BASE,
      informationAccurate: false,
    });
    expect(decision.lane).toBe('decline');
    expect(decision.reasons[0]?.code).toBe('INFORMATION_NOT_CONFIRMED');
    expect(decision.reasons[0]?.message).toBe(TRAVEL_DECLINE_MESSAGES.INFORMATION_NOT_CONFIRMED);
  });

  it('does NOT gate on residence duration (Peter 2026-05-16)', () => {
    // Per Peter's directive: residence duration is captured for audit
    // only, never gated. A short-duration visitor with all other gates
    // satisfied is accepted; this test pins the negative behaviour.
    const decision = evaluateTravelUw({
      ...VALID_BASE,
      // No duration / status fields — they are not part of TravelUwInput.
    });
    expect(decision.lane).toBe('accept');
    expect(decision.isExpat).toBe(true);
  });
});

describe('evaluateTravelUw — under-18 policyholder online-bind referral (Peter + Andy 2026-06-16)', () => {
  it('refers (not declines) when the policyholder is under 18', () => {
    const decision = evaluateTravelUw({ ...VALID_BASE, policyholderAge: 11 });
    expect(decision.lane).toBe('referral');
    const reason = decision.reasons.find((r) => r.code === 'POLICYHOLDER_UNDER_MIN_AGE');
    expect(reason).toBeDefined();
    expect(reason?.message).toBe(TRAVEL_POLICYHOLDER_UNDER_MIN_AGE_MESSAGE);
  });

  it('accepts when the policyholder is exactly 18 (minimum online age is inclusive)', () => {
    const decision = evaluateTravelUw({ ...VALID_BASE, policyholderAge: 18 });
    expect(decision.lane).toBe('accept');
    expect(decision.reasons).toEqual([]);
  });

  it('still refers an under-18 policyholder even when an adult is travelling (lead-only, not masked by oldest)', () => {
    // leadTravellerAge (oldest) is an adult; policyholderAge (lead) is a child.
    const decision = evaluateTravelUw({ ...VALID_BASE, leadTravellerAge: 40, policyholderAge: 11 });
    expect(decision.lane).toBe('referral');
    expect(decision.reasons.some((r) => r.code === 'POLICYHOLDER_UNDER_MIN_AGE')).toBe(true);
  });

  it('declines (does not refer) when the oldest traveller is over the max age, even with an under-18 policyholder', () => {
    const decision = evaluateTravelUw({ ...VALID_BASE, leadTravellerAge: 90, policyholderAge: 11 });
    expect(decision.lane).toBe('decline');
    expect(decision.reasons[0]?.code).toBe('AGE_OVER_MAX');
  });

  it('does not trigger the under-18 referral when policyholderAge is absent', () => {
    const decision = evaluateTravelUw(VALID_BASE);
    expect(decision.reasons.some((r) => r.code === 'POLICYHOLDER_UNDER_MIN_AGE')).toBe(false);
  });
});

describe('evaluateTravelUw — prior travel-claims history (ADR-0054)', () => {
  it('refers with verbatim copy when a prior claim OVER €500 is declared', () => {
    const decision = evaluateTravelUw({
      ...VALID_BASE,
      hasPreviousTravelClaim: true,
      previousTravelClaimBand: 'over_500',
    });
    expect(decision.lane).toBe('referral');
    const reason = decision.reasons.find((r) => r.code === 'PRIOR_TRAVEL_CLAIM_OVER_THRESHOLD');
    expect(reason).toBeDefined();
    expect(reason?.message).toBe(TRAVEL_PRIOR_CLAIM_OVER_THRESHOLD_MESSAGE);
  });

  it('does NOT refer for a prior claim UP TO €500 (that band is priced with a loading, not a UW gate)', () => {
    const decision = evaluateTravelUw({
      ...VALID_BASE,
      hasPreviousTravelClaim: true,
      previousTravelClaimBand: 'up_to_500',
    });
    expect(decision.lane).toBe('accept');
    expect(decision.reasons.some((r) => r.code === 'PRIOR_TRAVEL_CLAIM_OVER_THRESHOLD')).toBe(false);
  });

  it('does NOT refer when no previous claim is declared', () => {
    const decision = evaluateTravelUw({ ...VALID_BASE, hasPreviousTravelClaim: false });
    expect(decision.lane).toBe('accept');
    expect(decision.reasons.some((r) => r.code === 'PRIOR_TRAVEL_CLAIM_OVER_THRESHOLD')).toBe(false);
  });

  it('does NOT refer on band alone when hasPreviousTravelClaim is not true (fail-closed to no gate)', () => {
    const decision = evaluateTravelUw({
      ...VALID_BASE,
      previousTravelClaimBand: 'over_500',
    });
    expect(decision.reasons.some((r) => r.code === 'PRIOR_TRAVEL_CLAIM_OVER_THRESHOLD')).toBe(false);
  });
});

describe('evaluateTravelUw — local-market nationality referral (ADR-0059)', () => {
  it('accepts operating-territory nationals who are expats outside their local market', () => {
    const decision = evaluateTravelUw({
      ...VALID_BASE,
      countryOfResidence: 'France',
      destinations: ['Spain'],
      nationality: 'Cyprus',
    });
    expect(decision.lane).toBe('accept');
    expect(decision.reasons.some((r) => r.code === 'LOCAL_MARKET_NATIONALITY_REFERRAL')).toBe(false);
  });

  it('refers on a same-market SECOND nationality even when the primary is not', () => {
    const decision = evaluateTravelUw({
      ...VALID_BASE,
      countryOfResidence: 'Portugal',
      destinations: ['France'],
      nationality: 'United Kingdom',
      hasOtherNationality: true,
      otherNationality: 'PT',
    });
    expect(decision.lane).toBe('referral');
    expect(decision.reasons.some((r) => r.code === 'LOCAL_MARKET_NATIONALITY_REFERRAL')).toBe(true);
  });

  it('does NOT refer approved CY/PT/GR cross-market expats', () => {
    const portugueseInCyprus = evaluateTravelUw({
      ...VALID_BASE,
      countryOfResidence: 'Cyprus',
      nationality: 'Portugal',
    });
    expect(portugueseInCyprus.lane).toBe('accept');
    expect(portugueseInCyprus.reasons.some((r) => r.code === 'LOCAL_MARKET_NATIONALITY_REFERRAL')).toBe(false);

    const cypriotInPortugal = evaluateTravelUw({
      ...VALID_BASE,
      countryOfResidence: 'Portugal',
      nationality: 'Cyprus',
    });
    expect(cypriotInPortugal.lane).toBe('accept');
    expect(cypriotInPortugal.reasons.some((r) => r.code === 'LOCAL_MARKET_NATIONALITY_REFERRAL')).toBe(false);

    const greekInCyprus = evaluateTravelUw({
      ...VALID_BASE,
      countryOfResidence: 'Republic of Cyprus',
      nationality: 'Greece',
    });
    expect(greekInCyprus.lane).toBe('accept');
    expect(greekInCyprus.reasons.some((r) => r.code === 'LOCAL_MARKET_NATIONALITY_REFERRAL')).toBe(false);
  });

  it('does NOT refer a non-local-market national (British expat accepts)', () => {
    const decision = evaluateTravelUw(VALID_BASE);
    expect(decision.lane).toBe('accept');
    expect(decision.reasons.some((r) => r.code === 'LOCAL_MARKET_NATIONALITY_REFERRAL')).toBe(false);
  });
});

describe('deriveIsExpat — pure predicate', () => {
  it('returns true for the canonical British-in-Cyprus case', () => {
    expect(deriveIsExpat(VALID_BASE)).toBe(true);
  });

  it.each([
    ['nationality matches residence', { ...VALID_BASE, nationality: 'Republic of Cyprus' }],
    ['other nationality matches residence', { ...VALID_BASE, hasOtherNationality: true, otherNationality: 'Republic of Cyprus' }],
    ['willRemainResident false', { ...VALID_BASE, willRemainResident: false }],
    ['legallyPermittedToReside false', { ...VALID_BASE, legallyPermittedToReside: false }],
    ['informationAccurate false', { ...VALID_BASE, informationAccurate: false }],
    ['no countryOfResidence', { ...VALID_BASE, countryOfResidence: '' }],
  ])('returns false when %s', (_label, input) => {
    expect(deriveIsExpat(input)).toBe(false);
  });
});
