import type { TravelQuoteData } from './pricing/travelCalculator.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(v: unknown): UnknownRecord {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as UnknownRecord) : {};
}

/**
 * Product-owned projection from canonical backend quote data to the Travel
 * pricing/UW input shape. Runtime code should consume this rather than
 * casting `unknown` directly.
 */
export function toTravelPricingQuoteData(data: unknown): TravelQuoteData {
  const qd = asRecord(data);
  const eligibility = asRecord(qd.eligibility);
  const travellers = asRecord(qd.travellers);
  const trip = asRecord(qd.trip);
  const quote = asRecord(qd.quote);
  const addons = asRecord(qd.addons);
  const risk = asRecord(qd.risk);
  const additionalTravellerDOBs = Array.isArray(travellers.additionalTravellerDOBs)
    ? travellers.additionalTravellerDOBs.map(String)
    : [];

  return {
    eligibility: {
      countryOfResidence: String(eligibility.countryOfResidence || ''),
      isExpat: Boolean(eligibility.isExpat),
      nationality: String(eligibility.nationality || ''),
      hasOtherNationality: eligibility.hasOtherNationality === true,
      otherNationality: String(eligibility.otherNationality || ''),
      ...(eligibility.residenceDuration ? { residenceDuration: String(eligibility.residenceDuration) as 'lt_1_year' | '1_3_years' | 'gt_3_years' } : {}),
      ...(eligibility.residencyStatus ? { residencyStatus: String(eligibility.residencyStatus) as 'permanent_resident' | 'temporary_resident' | 'work_visa' | 'student_visa' | 'visitor' | 'other_visa' } : {}),
      willRemainResident: eligibility.willRemainResident === true ? true : eligibility.willRemainResident === false ? false : undefined,
      legallyPermittedToReside: eligibility.legallyPermittedToReside === true ? true : eligibility.legallyPermittedToReside === false ? false : undefined,
      informationAccurate: eligibility.informationAccurate === true ? true : eligibility.informationAccurate === false ? false : undefined,
      legalAgreement: eligibility.legalAgreement === true ? true : eligibility.legalAgreement === false ? false : undefined,
    },
    travellers: {
      coverType: String(travellers.coverType || ''),
      travellerCount: travellers.travellerCount !== undefined ? Number(travellers.travellerCount) : undefined,
      leadTravellerDOB: String(travellers.leadTravellerDOB || ''),
      additionalTravellerDOBs,
    },
    trip: {
      planType: String(trip.planType || ''),
      destinations: Array.isArray(trip.destinations) ? trip.destinations.map(String) : [],
      startDate: String(trip.startDate || ''),
      endDate: String(trip.endDate || ''),
    },
    quote: {
      selectedPlan: String(quote.selectedPlan || 'silver'),
      maxTripDays: quote.maxTripDays !== undefined ? Number(quote.maxTripDays) : undefined,
    },
    addons: Object.fromEntries(Object.entries(addons).map(([key, value]) => [key, Boolean(value)])),
    // ADR-0054 prior-claims history. Faithful tri-state projection — the
    // value round-trips exactly; absence stays absent (no silent default),
    // and the calculator treats an absent claim as "no previous claim".
    risk: {
      hasPreviousTravelClaim:
        risk.hasPreviousTravelClaim === true ? true
          : risk.hasPreviousTravelClaim === false ? false
            : undefined,
      ...(risk.previousTravelClaimBand
        ? { previousTravelClaimBand: String(risk.previousTravelClaimBand) as 'up_to_500' | 'over_500' }
        : {}),
    },
  };
}
