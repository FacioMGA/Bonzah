import { describe, expect, it } from 'vitest';
import {
  HEALTH_DECLINE_MESSAGES,
  evaluateHealthUw,
} from '../healthUwAutomation.js';

const VALID_BASE = {
  oldestInsuredAge: 35,
  countryOfResidence: 'Cyprus',
  nationality: 'Angola',
  hasOtherNationality: false,
  willRemainResident: true,
  legallyPermittedToReside: true,
  informationAccurate: true,
};

describe('evaluateHealthUw — Cyprus Immigration Medical eligibility', () => {
  it('accepts an expat resident in Cyprus using the manifest country value', () => {
    const decision = evaluateHealthUw(VALID_BASE);

    expect(decision.lane).toBe('accept');
    expect(decision.isExpat).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  it('declines when nationality matches Cyprus residence (local national cannot buy online)', () => {
    const decision = evaluateHealthUw({
      ...VALID_BASE,
      nationality: 'Cyprus',
    });

    expect(decision.lane).toBe('decline');
    expect(decision.isExpat).toBe(false);
    expect(decision.reasons[0]?.code).toBe('NATIONALITY_EQUALS_RESIDENCE');
    expect(decision.reasons[0]?.message).toBe(HEALTH_DECLINE_MESSAGES.NATIONALITY_EQUALS_RESIDENCE);
  });

  it('declines non-Cyprus residence for the CY-only Phase 1 product', () => {
    const decision = evaluateHealthUw({
      ...VALID_BASE,
      countryOfResidence: 'Albania',
    });

    expect(decision.lane).toBe('decline');
    expect(decision.isExpat).toBe(false);
    expect(decision.reasons[0]?.code).toBe('RESIDENCE_NOT_AUTHORISED');
    expect(decision.reasons[0]?.message).toBe(HEALTH_DECLINE_MESSAGES.RESIDENCE_NOT_AUTHORISED);
  });

  // Approved production requirement (Peter, 2026-07-21): a customer applying
  // for Cyprus Immigration cover will not yet have GESY, so the absence of
  // GESY must NOT prevent a quotation or purchase on the new-business journey.
  // GESY status is an optional free outpatient/repatriation extension only and
  // is deliberately NOT an underwriting input. (Renewals get a separate
  // ruleset, out of scope here.)
  it('does not gate new business on GESY: an expat applicant with no GESY signal is accepted', () => {
    const decision = evaluateHealthUw(VALID_BASE);
    expect(decision.lane).toBe('accept');
  });

  it('exposes no GESY/GHS-based decline code — absence of GESY can never decline new business', () => {
    const declineCodes = Object.keys(HEALTH_DECLINE_MESSAGES);
    expect(declineCodes.some((code) => /GESY|GHS/i.test(code))).toBe(false);
  });

  // ADR-0059 — expat-broker posture applies to Immigration Medical too:
  // same-market nationals are local-market customers; cross-market operating
  // nationals remain expats.
  it('accepts a Portuguese national resident in Cyprus (approved cross-market expat)', () => {
    const decision = evaluateHealthUw({ ...VALID_BASE, nationality: 'Portugal' });
    expect(decision.lane).toBe('accept');
    expect(decision.reasons.some((r) => r.code === 'LOCAL_MARKET_NATIONALITY_REFERRAL')).toBe(false);
  });

  it('accepts a Greek national resident in Cyprus (approved cross-market expat)', () => {
    const decision = evaluateHealthUw({ ...VALID_BASE, nationality: 'Greece' });
    expect(decision.lane).toBe('accept');
    expect(decision.reasons.some((r) => r.code === 'LOCAL_MARKET_NATIONALITY_REFERRAL')).toBe(false);
  });

  it('declines a Cypriot national resident in Cyprus via nationality-equals-residence', () => {
    const decision = evaluateHealthUw({ ...VALID_BASE, nationality: 'Cyprus' });
    expect(decision.lane).toBe('decline');
    expect(decision.reasons.some((r) => r.code === 'NATIONALITY_EQUALS_RESIDENCE')).toBe(true);
  });

  it('does NOT refer a non-local-market expat (Angolan resident in Cyprus accepts)', () => {
    const decision = evaluateHealthUw(VALID_BASE);
    expect(decision.lane).toBe('accept');
    expect(decision.reasons.some((r) => r.code === 'LOCAL_MARKET_NATIONALITY_REFERRAL')).toBe(false);
  });
});
