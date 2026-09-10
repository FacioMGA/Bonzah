import { NATIONALITY_OPTIONS } from '@facio/validation';
import type { ProductManifest, SelectOption } from '../types.js';
import { TRAVEL_DESTINATION_AREAS } from './destinations.js';

const DESTINATION_AREA_OPTIONS = TRAVEL_DESTINATION_AREAS.map(({ value, label }) => ({ value, label }));
export const TRAVEL_PLAN_TYPE_OPTIONS: SelectOption[] = [
  { value: 'single_trip', label: 'Single Trip' },
  { value: 'annual_multi_trip', label: 'Annual Multi-Trip' },
];
export const TRAVEL_COVER_TYPE_OPTIONS: SelectOption[] = [
  { value: 'single', label: 'Single Person' },
  { value: 'couple', label: 'A Couple' },
  { value: 'family', label: 'A Family' },
  { value: 'single_parent_family', label: 'Single Parent Family' },
];
export const TRAVEL_SELECTED_PLAN_OPTIONS: SelectOption[] = [
  { value: 'silver', label: 'Silver' },
  { value: 'gold', label: 'Gold' },
  { value: 'platinum', label: 'Platinum' },
];

function titleCaseTravelValue(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function travelDestinationLabel(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;
  const label = titleCaseTravelValue(first);
  return label ? `${label} Travel` : 'Travel';
}

function travelCoverTypeLabel(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'family') return 'Family';
  if (raw === 'single_parent_family') return 'Single-parent family';
  if (raw === 'couple') return 'Couple';
  if (raw === 'single') return 'Single traveller';
  return titleCaseTravelValue(value);
}

function inclusiveDaysBetween(startIso: unknown, endIso: unknown): number | null {
  const start = new Date(String(startIso || ''));
  const end = new Date(String(endIso || ''));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.max(1, Math.floor((endUtc - startUtc) / 86_400_000) + 1);
}

function elapsedInclusiveDays(startIso: unknown, endIso: unknown): number {
  const start = new Date(String(startIso || ''));
  if (Number.isNaN(start.getTime())) return 0;
  const today = new Date();
  const end = new Date(String(endIso || ''));
  const effectiveEnd = !Number.isNaN(end.getTime()) && end.getTime() < today.getTime() ? end : today;
  if (effectiveEnd.getTime() < start.getTime()) return 0;
  return inclusiveDaysBetween(start.toISOString(), effectiveEnd.toISOString()) || 0;
}

function travelTripTypeAndDays(data: Record<string, unknown>, singleTripLabel = 'Single trip'): string {
  const trip = (data.trip && typeof data.trip === 'object')
    ? data.trip as Record<string, unknown>
    : {};
  const quote = (data.quote && typeof data.quote === 'object')
    ? data.quote as Record<string, unknown>
    : {};
  const planType = String(trip.planType || '').trim().toLowerCase();
  if (planType === 'annual_multi_trip' || planType === 'annual') {
    const maxTripDays = Number(quote.maxTripDays) || 17;
    const usedDays = Math.min(maxTripDays, elapsedInclusiveDays(trip.startDate, trip.endDate));
    return `Annual · ${usedDays}/${maxTripDays} days used`;
  }
  const tripDays = inclusiveDaysBetween(trip.startDate, trip.endDate);
  return tripDays ? `${singleTripLabel} · ${tripDays} days` : singleTripLabel;
}
/**
 * BRIT-authorised Travel residence list per Peter (2026-05-16).
 * Germany excluded pending written BRIT FOS confirmation.
 *
 * `value` matches what the resolver's `normalizeCountryCode` accepts
 * (canonical English country names). The `label` is the customer-facing
 * display string. "Republic of Cyprus" remains the official Cyprus label
 * for legacy data compatibility; the resolver normalises it.
 */
export const TRAVEL_RESIDENCE_COUNTRY_OPTIONS: SelectOption[] = [
  { value: 'Belgium', label: 'Belgium' },
  { value: 'France', label: 'France' },
  { value: 'Greece', label: 'Greece' },
  { value: 'Italy', label: 'Italy' },
  { value: 'Malta', label: 'Malta' },
  { value: 'Netherlands', label: 'Netherlands' },
  { value: 'Portugal', label: 'Portugal' },
  { value: 'Republic of Cyprus', label: 'Republic of Cyprus' },
  { value: 'Spain', label: 'Spain' },
];

/**
 * Nationality dropdown options for ADR-0025 objective expat eligibility.
 *
 * Per Peter 2026-05-16, the nationality list is NOT limited to the 9
 * authorised residence countries — a British / American / Israeli etc.
 * national resident in (e.g.) Cyprus is a normal expat pass case. The
 * dropdown is sourced from the canonical full country list owned by
 * `@facio/validation`'s Nationality contract — same allowed values as
 * `proposer.nationality` (Motor/Home), reused at `eligibility.nationality`
 * for the residence-vs-nationality comparison.
 */
export const TRAVEL_NATIONALITY_OPTIONS: SelectOption[] = NATIONALITY_OPTIONS.map((country) => ({
  value: country,
  label: country,
}));

export const TRAVEL_RESIDENCE_DURATION_OPTIONS: SelectOption[] = [
  { value: 'lt_1_year', label: 'Less than 1 year' },
  { value: '1_3_years', label: '1 to 3 years' },
  { value: 'gt_3_years', label: 'More than 3 years' },
];

export const TRAVEL_RESIDENCY_STATUS_OPTIONS: SelectOption[] = [
  { value: 'permanent_resident', label: 'Permanent resident' },
  { value: 'temporary_resident', label: 'Temporary resident' },
  { value: 'work_visa', label: 'Work visa' },
  { value: 'student_visa', label: 'Student visa' },
  { value: 'visitor', label: 'Visitor' },
  { value: 'other_visa', label: 'Other visa' },
];

export const TRAVEL_ID_TYPE_OPTIONS: SelectOption[] = [
  { value: 'passport', label: 'Passport' },
  { value: 'id_card', label: 'National ID Card' },
  { value: 'driving_licence', label: 'Driving Licence' },
];

/**
 * Prior travel-claim bands (ADR-0054). Asked only when the customer
 * confirms a previous travel-insurance claim. `up_to_500` drives the 15%
 * premium loading; `over_500` sends the quote to referral (no auto price).
 * The band is a self-declared radio — no numeric boundary logic.
 */
export const TRAVEL_PREVIOUS_CLAIM_BAND_OPTIONS: SelectOption[] = [
  { value: 'up_to_500', label: 'Up to \u20AC500' },
  { value: 'over_500', label: 'Over \u20AC500' },
];

/**
 * Travel Product Manifest — single source of truth.
 *
 * Phase 4 (2026-04 consolidation): adopted the BE manifest as canonical
 * (it carried the complete `policy-holder` section, which the FE mirror
 * had emptied out, and the post-Bug-#2 declaration paths + `Trip type`
 * label fix). Deleted `frontend/src/products/travel/manifest.ts`. The
 * `trip.destinations` options come from the now-shared
 * `@facio/products` country list (relocated from
 * `frontend/src/shared/data/countries.ts`).
 */
export const travelManifest: ProductManifest = {
  productType: 'TRAVEL',
  displayName: 'Travel Insurance',

  insuredObject: {
    kind: 'trip',
    cardinality: 'one',
    label: { singular: 'Trip', plural: 'Trips' },
    fields: [
      { path: 'trip.planType', label: 'Trip type', type: 'select', required: true,
        options: TRAVEL_PLAN_TYPE_OPTIONS },
      { path: 'trip.destinations', label: 'Destinations', type: 'multiselect', required: true, options: DESTINATION_AREA_OPTIONS },
      { path: 'trip.startDate', label: 'Start date', type: 'date', required: true },
      { path: 'trip.endDate', label: 'End date', type: 'date', required: true },
      { path: 'travellers.coverType', label: 'Cover type', type: 'select', required: true,
        options: TRAVEL_COVER_TYPE_OPTIONS },
      { path: 'travellers.travellerCount', label: 'Number of travellers', type: 'number' },
      { path: 'travellers.leadTravellerDOB', label: 'Lead traveller DOB', type: 'date', required: true },
      { path: 'travellers.additionalTravellerDOBs', label: 'Additional traveller DOBs', type: 'date' },
    ],
  },

  questionnaire: {
    sections: [
      // Eligibility — objective expat questions per ADR-0025 (Peter
      // 2026-05-16). `eligibility.isExpat` is INTENTIONALLY omitted from
      // the questionnaire: it is now a derived UW outcome computed in
      // `travelUwAutomation.ts` from the seven objective answers, never
      // a customer-input boolean.
      { id: 'eligibility', title: 'Eligibility', order: 1, fields: [
        { path: 'eligibility.countryOfResidence', label: 'What is your current country of residence?', type: 'select', required: true, options: TRAVEL_RESIDENCE_COUNTRY_OPTIONS },
        { path: 'eligibility.nationality', label: 'What is your nationality?', type: 'select', searchable: true, required: true, options: TRAVEL_NATIONALITY_OPTIONS },
        { path: 'eligibility.hasOtherNationality', label: 'Do you hold any other nationality?', type: 'boolean', required: true },
        { path: 'eligibility.otherNationality', label: 'Other nationality', type: 'select', searchable: true, options: TRAVEL_NATIONALITY_OPTIONS },
        { path: 'eligibility.residenceDuration', label: 'How long have you been living in your current country of residence?', type: 'select', required: true, options: TRAVEL_RESIDENCE_DURATION_OPTIONS },
        { path: 'eligibility.willRemainResident', label: 'For the duration of your policy, please confirm that you will remain a resident of your current country of residence', type: 'boolean', required: true },
        { path: 'eligibility.residencyStatus', label: 'What is your residency status in your current country of residence?', type: 'select', required: true, options: TRAVEL_RESIDENCY_STATUS_OPTIONS },
        { path: 'eligibility.legallyPermittedToReside', label: 'Are you legally permitted to reside in your current country of residence?', type: 'boolean', required: true },
        { path: 'eligibility.informationAccurate', label: 'I confirm that the information provided is accurate and that any incorrect declaration may affect cover or claims validation.', type: 'boolean', required: true },
        { path: 'eligibility.legalAgreement', label: 'Lloyd\u2019s residency declaration accepted', type: 'boolean', required: true },
      ] },
      { id: 'travellers', title: 'Travellers', order: 2, fields: [
        { path: 'travellers.coverType', label: 'Cover type', type: 'select', required: true,
          options: TRAVEL_COVER_TYPE_OPTIONS },
        { path: 'travellers.travellerCount', label: 'Number of travellers', type: 'number' },
        { path: 'travellers.leadTravellerDOB', label: 'Lead traveller DOB', type: 'date', required: true },
        { path: 'travellers.additionalTravellerDOBs', label: 'Additional traveller DOBs', type: 'date' },
      ] },
      { id: 'trip-details', title: 'Trip details', order: 3, fields: [
        { path: 'trip.planType', label: 'Trip type', type: 'select', required: true,
          options: TRAVEL_PLAN_TYPE_OPTIONS },
        { path: 'trip.destinations', label: 'Destinations', type: 'multiselect', required: true, options: DESTINATION_AREA_OPTIONS },
        { path: 'trip.startDate', label: 'Start date', type: 'date', required: true },
        { path: 'trip.endDate', label: 'End date', type: 'date', required: true },
        // Prior travel-claims history (ADR-0054). Band is conditional —
        // only answered when hasPreviousTravelClaim is true (required-when
        // enforced by travelValidationProfile, not a manifest `required`).
        { path: 'risk.hasPreviousTravelClaim', label: 'Have you previously claimed on a travel insurance policy?', type: 'boolean', required: true },
        { path: 'risk.previousTravelClaimBand', label: 'How much did you claim in total?', type: 'select', options: TRAVEL_PREVIOUS_CLAIM_BAND_OPTIONS },
      ] },
      { id: 'quote', title: 'Choose plan', order: 4, fields: [
        { path: 'quote.selectedPlan', label: 'Plan', type: 'select', required: true,
          options: TRAVEL_SELECTED_PLAN_OPTIONS },
      ] },
      { id: 'options', title: 'Options', order: 5, fields: [
        { path: 'addons.winterSports', label: 'Winter sports', type: 'boolean' },
        { path: 'addons.businessCover', label: 'Business cover', type: 'boolean' },
        { path: 'addons.golfCover', label: 'Golf cover', type: 'boolean' },
        { path: 'addons.terrorism', label: 'Terrorism', type: 'boolean' },
        { path: 'addons.sportsEquipment', label: 'Sports equipment', type: 'boolean' },
        { path: 'addons.wedding', label: 'Wedding', type: 'boolean' },
        { path: 'addons.gadget', label: 'Gadget', type: 'boolean' },
      ] },
      { id: 'policy-holder', title: 'Your details', order: 6, fields: [
        { path: 'proposer.firstName', label: 'First name', type: 'text', required: true },
        { path: 'proposer.lastName', label: 'Last name', type: 'text', required: true },
        { path: 'proposer.email', label: 'Email', type: 'text', required: true },
        { path: 'proposer.confirmEmail', label: 'Confirm email', type: 'text' },
        { path: 'proposer.phone', label: 'Phone', type: 'text', required: true },
        { path: 'proposer.address.line1', label: 'Address', type: 'text', required: true },
        { path: 'proposer.address.line2', label: 'Address line 2', type: 'text' },
        { path: 'proposer.address.city', label: 'City', type: 'text', required: true },
        { path: 'proposer.address.postcode', label: 'Post code', type: 'text' },
        { path: 'proposer.address.country', label: 'Country', type: 'select', searchable: true, required: true },
        { path: 'proposer.dateOfBirth', label: 'Date of birth', type: 'date' },
        { path: 'proposer.idType', label: 'ID type', type: 'select',
          options: TRAVEL_ID_TYPE_OPTIONS },
        { path: 'proposer.idNumber', label: 'ID number', type: 'text' },
        { path: 'travellers.additionalTravellers', label: 'Additional traveller details', type: 'list' },
        // Nationality is intentionally NOT collected for TRAVEL — the
        // canonical Nationality contract declares TRAVEL has
        // `collected: false`. The wizard, profile, and manifest agree.
        // The consistency guard fails CI if any of the three drift.
        { path: 'proposer.nif', label: 'NIF / Tax ID', type: 'text' },
        { path: 'proposer.marketingConsent', label: 'Marketing consent', type: 'boolean', required: true },
        { path: 'proposer.feedbackConsent', label: 'Feedback consent', type: 'boolean' },
      ] },
      // Declaration paths and order match the Lloyd's-approved
      // `Step6DetailsAndDeclarations` wizard step + `travelValidationProfile`.
      // Keep these three sources in lock-step — every save/issue path is
      // validated against these exact field names.
      { id: 'declarations', title: 'Declarations', order: 7, fields: [
        { path: 'declarations.medicalNotice', label: 'Medical notice acknowledgement', type: 'boolean', required: true },
        { path: 'declarations.howToClaimReview', label: 'How to Claim / Complain / Privacy reviewed', type: 'boolean', required: true },
        { path: 'declarations.personalDataConsent', label: 'Personal data consent', type: 'boolean', required: true },
        { path: 'declarations.contractConsent', label: 'Contract consent', type: 'boolean', required: true },
        { path: 'declarations.contractAgreement', label: 'Payment portal agreement', type: 'boolean', required: true },
      ] },
    ],
  },

  summaryFields: {
    titlePaths: ['trip.destinations'],
    subtitlePaths: ['trip.startDate', 'trip.endDate'],
    insuredValuePath: 'quote.basePrice',
    buildTitle: (data) => {
      const read = (p: string): unknown => {
        const segs = p.split('.');
        let cur: unknown = data;
        for (const s of segs) {
          if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
          cur = (cur as Record<string, unknown>)[s];
        }
        return cur;
      };
      const asText = (v: unknown): string => {
        if (typeof v === 'string') return v.trim();
        if (typeof v === 'number' && Number.isFinite(v)) return String(v);
        if (v && typeof v === 'object') {
          const rec = v as Record<string, unknown>;
          const candidate = rec.label ?? rec.value ?? rec.name;
          return typeof candidate === 'string' ? candidate.trim() : '';
        }
        return '';
      };
      const joinList = (v: unknown, sep = ', '): string => {
        if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(sep);
        return asText(v);
      };
      const planType = asText(read('trip.planType')).toLowerCase();
      const firstName = asText(read('proposer.firstName'));
      const lastName = asText(read('proposer.lastName'));
      const coverType = asText(read('travellers.coverType')).toLowerCase();
      if (planType === 'annual_multi_trip') {
        const planLabel = 'Annual Plan';
        if (coverType === 'family' || coverType === 'single_parent_family') {
          if (lastName) return `${lastName} Family · ${planLabel}`;
          if (firstName) return `${firstName} Family · ${planLabel}`;
          return 'Annual family plan';
        }
        if (coverType === 'couple') {
          const name = [firstName, lastName].filter(Boolean).join(' ').trim();
          if (name) return `${name} & Partner · ${planLabel}`;
          return planLabel;
        }
        const name = [firstName, lastName].filter(Boolean).join(' ').trim();
        if (name) return `${name} · ${planLabel}`;
        return planLabel;
      }
      const destinations = joinList(read('trip.destinations'));
      const start = asText(read('trip.startDate'));
      const end = asText(read('trip.endDate'));
      const days = (() => {
        if (!start || !end) return 0;
        const s = Date.parse(start);
        const e = Date.parse(end);
        if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0;
        return Math.max(1, Math.round((e - s) / 86_400_000) + 1);
      })();
      if (days > 0 && destinations) return `${days}-day trip to ${destinations}`;
      if (destinations) return `Trip to ${destinations}`;
      return null;
    },
    buildSubtitle: (data) => {
      const read = (p: string): unknown => {
        const segs = p.split('.');
        let cur: unknown = data;
        for (const s of segs) {
          if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
          cur = (cur as Record<string, unknown>)[s];
        }
        return cur;
      };
      const asText = (v: unknown): string => {
        if (typeof v === 'string') return v.trim();
        if (typeof v === 'number' && Number.isFinite(v)) return String(v);
        if (v && typeof v === 'object') {
          const rec = v as Record<string, unknown>;
          const candidate = rec.label ?? rec.value ?? rec.name;
          return typeof candidate === 'string' ? candidate.trim() : '';
        }
        return '';
      };
      const coverTypeRaw = asText(read('travellers.coverType')).toLowerCase();
      const coverType =
        coverTypeRaw === 'family' ? 'Family'
          : coverTypeRaw === 'single_parent_family' ? 'Single-parent family'
            : coverTypeRaw === 'couple' ? 'Couple'
              : coverTypeRaw === 'single' ? 'Single traveller'
                : '';
      const planTypeRaw = asText(read('trip.planType')).toLowerCase();
      const planType =
        planTypeRaw === 'annual_multi_trip' ? 'Annual Multi-Trip'
          : planTypeRaw === 'single_trip' ? 'Single Trip'
            : '';
      if (planType && coverType) return `${planType} · ${coverType}`;
      return planType || coverType || null;
    },
  },

  listColumns: {
    insured: {
      primaryPaths: [],
      secondaryPaths: [],
      buildPrimary: (data) => {
        const trip = (data.trip && typeof data.trip === 'object')
          ? data.trip as Record<string, unknown>
          : {};
        return travelDestinationLabel(trip.destinations);
      },
      buildSecondary: (data) => {
        const travellers = (data.travellers && typeof data.travellers === 'object')
          ? data.travellers as Record<string, unknown>
          : {};
        const coverType = travelCoverTypeLabel(travellers.coverType);
        const tripTypeAndDays = travelTripTypeAndDays(data);
        return [coverType, tripTypeAndDays].filter(Boolean).join(' · ') || null;
      },
    },
    coverage: {
      primaryPaths: [],
      buildPrimary: (data) => {
        const quote = (data.quote && typeof data.quote === 'object')
          ? data.quote as Record<string, unknown>
          : {};
        return titleCaseTravelValue(quote.selectedPlan) || 'Travel insurance';
      },
      buildSecondary: (data) => {
        return travelTripTypeAndDays(data, 'Single Trip');
      },
      buildStartDate: (data) => {
        const trip = (data.trip && typeof data.trip === 'object')
          ? data.trip as Record<string, unknown>
          : {};
        const start = String(trip.startDate || '').trim();
        return start || null;
      },
      buildEndDate: (data) => {
        const trip = (data.trip && typeof data.trip === 'object')
          ? data.trip as Record<string, unknown>
          : {};
        const end = String(trip.endDate || '').trim();
        return end || null;
      },
    },
  },

  coverageCatalog: [
    { code: 'TRAVEL-WINTER-SPORTS', label: 'Winter sports', scope: 'POLICY', group: 'addons' },
    { code: 'TRAVEL-BUSINESS-COVER', label: 'Business cover', scope: 'POLICY', group: 'addons' },
    { code: 'TRAVEL-GOLF-COVER', label: 'Golf cover', scope: 'POLICY', group: 'addons' },
    { code: 'TRAVEL-TERRORISM', label: 'Terrorism', scope: 'POLICY', group: 'addons' },
    { code: 'TRAVEL-SPORTS-EQUIPMENT', label: 'Sports equipment', scope: 'POLICY', group: 'addons' },
    { code: 'TRAVEL-WEDDING', label: 'Wedding', scope: 'POLICY', group: 'addons' },
    { code: 'TRAVEL-GADGET', label: 'Gadget', scope: 'POLICY', group: 'addons' },
  ],

  uwConfigSchema: {
    groups: [
      { id: 'age', title: 'Age limits', fields: [
        { path: 'maxTravellerAge', label: 'Max traveller age (auto-decline above)', type: 'number' },
        { path: 'referTravellerAge', label: 'Refer at age (require manual review)', type: 'number' },
      ] },
      { id: 'geography', title: 'Geography', fields: [
        { path: 'excludedDestinations', label: 'Excluded destinations (comma-separated)', type: 'text' },
      ] },
      { id: 'duration', title: 'Duration', fields: [
        { path: 'maxTripDurationDays', label: 'Max single-trip duration (days)', type: 'number' },
      ] },
    ],
  },

  documentTypes: {
    TRAVEL_SCHEDULE_PDF: 'Travel Schedule',
    TRAVEL_CERTIFICATE_PDF: 'Travel Certificate',
    TRAVEL_STATEMENT_OF_FACT_PDF: 'Statement of Fact',
    TRAVEL_IPID_PDF: 'Insurance Product Information Document',
    TRAVEL_POLICY_WORDING_PDF: 'Policy Wording',
    TRAVEL_MEDICAL_CARD_PDF: 'Medical Assistance Card',
  },

  riskModelHints: {
    requiredForUw: [
      { path: 'eligibility.countryOfResidence', label: 'Country of residence' },
      { path: 'travellers.leadTravellerDOB', label: 'Lead traveller DOB' },
      { path: 'travellers.travellerCount', label: 'Number of travellers' },
      { path: 'travellers.additionalTravellerDOBs', label: 'Additional traveller DOBs' },
      { path: 'trip.planType', label: 'Trip type' },
      { path: 'trip.destinations', label: 'Destinations' },
      { path: 'trip.startDate', label: 'Start date' },
      { path: 'trip.endDate', label: 'End date' },
      { path: 'quote.selectedPlan', label: 'Selected plan' },
      { path: 'risk.hasPreviousTravelClaim', label: 'Previous travel claim' },
    ],
    referralFlags: [],
    ratingInputs: [
      { path: 'quote.selectedPlan', label: 'Plan', format: 'text' },
      { path: 'trip.planType', label: 'Trip type', format: 'text' },
      { path: 'trip.destinations', label: 'Destinations', format: 'text' },
      { path: 'travellers.coverType', label: 'Cover type', format: 'text' },
      { path: 'travellers.leadTravellerDOB', label: 'Lead traveller DOB', format: 'text' },
      { path: 'travellers.travellerCount', label: 'Number of travellers', format: 'text' },
      { path: 'risk.hasPreviousTravelClaim', label: 'Previous travel claim', format: 'text' },
      { path: 'risk.previousTravelClaimBand', label: 'Previous claim amount', format: 'text' },
    ],
  },

  rules: { batchRules: { minUnits: 0 } },

  theme: { iconKey: 'plane', segmentLabel: 'Travel' },
};
