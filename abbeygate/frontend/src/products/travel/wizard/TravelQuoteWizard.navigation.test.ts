import { describe, expect, it } from 'vitest';
import {
  TRAVEL_WIZARD_STEPS_REQUIRING_RATE,
  buildTravelRateInputFingerprint,
  canContinueTravelWizardStep,
  formatTravelAddonCoverLabel,
  hasTravelQuoteContactErrors,
  isTravelRateResponseCurrent,
} from './TravelQuoteWizard';
import { TRAVEL_ADDONS } from './travelAddons';

describe('canContinueTravelWizardStep', () => {
  it('blocks the plans step until a quoted plan is selected', () => {
    expect(canContinueTravelWizardStep({ currentStep: 3, quoteStatus: 'QUOTED', selectedPlan: '' })).toBe(false);
    expect(canContinueTravelWizardStep({ currentStep: 3, quoteStatus: 'QUOTED', selectedPlan: 'silver' })).toBe(true);
  });

  it('blocks terminal quote outcomes and payment step', () => {
    expect(canContinueTravelWizardStep({ currentStep: 3, quoteStatus: 'REFERRAL', selectedPlan: 'silver' })).toBe(false);
    expect(canContinueTravelWizardStep({ currentStep: 3, quoteStatus: 'DECLINED', selectedPlan: 'silver' })).toBe(false);
    expect(canContinueTravelWizardStep({ currentStep: 6, quoteStatus: 'QUOTED', selectedPlan: 'silver' })).toBe(false);
  });
});

describe('hasTravelQuoteContactErrors', () => {
  it('detects pre-quote contact blockers so stale plan-step sessions can be routed back', () => {
    expect(hasTravelQuoteContactErrors({ 'proposer.email': 'Email is required' })).toBe(true);
    expect(hasTravelQuoteContactErrors({ 'quote.selectedPlan': 'Plan is required' })).toBe(false);
  });
});

describe('buildTravelRateInputFingerprint', () => {
  const ratedValues = {
    eligibility: {
      countryOfResidence: 'Greece',
      nationality: 'Greece',
      hasOtherNationality: false,
      willRemainResident: true,
      legallyPermittedToReside: true,
      informationAccurate: true,
    },
    travellers: {
      coverType: 'single',
      travellerCount: 1,
      leadTravellerDOB: '1988-01-01',
    },
    trip: {
      planType: 'single_trip',
      destinations: ['Spain'],
      startDate: '2026-09-01',
      endDate: '2026-09-08',
    },
    quote: {
      selectedPlan: 'silver',
    },
    proposer: {
      firstName: 'Old',
    },
  };

  it('changes when eligibility changes so stale referral quote responses are invalidated', () => {
    const before = buildTravelRateInputFingerprint(ratedValues);
    const after = buildTravelRateInputFingerprint({
      ...ratedValues,
      eligibility: {
        ...ratedValues.eligibility,
        countryOfResidence: 'Republic of Cyprus',
      },
    });
    expect(after).not.toBe(before);
  });

  it('does not change for contact-only edits that do not affect rating', () => {
    const before = buildTravelRateInputFingerprint(ratedValues);
    const after = buildTravelRateInputFingerprint({
      ...ratedValues,
      proposer: {
        firstName: 'New',
      },
    });
    expect(after).toBe(before);
  });

  it('rejects an async rate response when the form changed after submission', () => {
    const submitted = buildTravelRateInputFingerprint(ratedValues);
    expect(isTravelRateResponseCurrent(submitted, ratedValues)).toBe(true);
    expect(isTravelRateResponseCurrent(submitted, {
      ...ratedValues,
      eligibility: {
        ...ratedValues.eligibility,
        nationality: 'United Kingdom',
      },
    })).toBe(false);
  });
});

describe('formatTravelAddonCoverLabel (ABY-261)', () => {
  it('does not duplicate "cover" when the source label already contains it', () => {
    expect(formatTravelAddonCoverLabel('Business Cover')).toBe('Business Cover');
    expect(formatTravelAddonCoverLabel('Golf Cover')).toBe('Golf Cover');
    expect(formatTravelAddonCoverLabel('business cover')).toBe('business cover');
  });

  it('appends " cover" to labels that do not already carry it', () => {
    expect(formatTravelAddonCoverLabel('Gadget')).toBe('Gadget cover');
    expect(formatTravelAddonCoverLabel('Wedding')).toBe('Wedding cover');
    expect(formatTravelAddonCoverLabel('Winter Sports')).toBe('Winter Sports cover');
    expect(formatTravelAddonCoverLabel('Terrorism')).toBe('Terrorism cover');
    expect(formatTravelAddonCoverLabel('Sports / Cycle Equipment')).toBe('Sports / Cycle Equipment cover');
  });

  it('never produces "<label> cover" on any canonical TRAVEL_ADDONS entry that already contains "Cover"', () => {
    for (const addon of TRAVEL_ADDONS) {
      const formatted = formatTravelAddonCoverLabel(addon.label);
      const coverOccurrences = (formatted.match(/\bcover\b/gi) || []).length;
      expect(coverOccurrences, `addon ${addon.key} (${addon.label}) -> ${formatted}`).toBe(1);
    }
  });

  it('falls back to "cover" for an empty label rather than producing " cover"', () => {
    expect(formatTravelAddonCoverLabel('')).toBe('cover');
    expect(formatTravelAddonCoverLabel('   ')).toBe('cover');
  });
});

describe('TRAVEL_WIZARD_STEPS_REQUIRING_RATE (ABY-261)', () => {
  it('triggers a navigation re-rate only on the plan-selection transitions (2→3, 3→4)', () => {
    // Step 2→3 produces the first quote so the plan picker has something
    // to render; Step 3→4 re-rates once the plan tier is locked in so
    // `addonPrices` reflect the tier the customer chose.
    expect(TRAVEL_WIZARD_STEPS_REQUIRING_RATE.has(2)).toBe(true);
    expect(TRAVEL_WIZARD_STEPS_REQUIRING_RATE.has(3)).toBe(true);
  });

  it('does NOT re-rate on the addons step transition — addon-driven rates run live via the `addonsKey` watcher', () => {
    expect(TRAVEL_WIZARD_STEPS_REQUIRING_RATE.has(4)).toBe(false);
    expect(TRAVEL_WIZARD_STEPS_REQUIRING_RATE.has(5)).toBe(false);
  });

  it('does NOT trigger a re-rate on the your-trip or payment steps', () => {
    expect(TRAVEL_WIZARD_STEPS_REQUIRING_RATE.has(1)).toBe(false);
    expect(TRAVEL_WIZARD_STEPS_REQUIRING_RATE.has(6)).toBe(false);
  });
});
