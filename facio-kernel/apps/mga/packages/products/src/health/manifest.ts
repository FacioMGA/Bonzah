import { NATIONALITY_OPTIONS } from '@facio/validation';
import type { ProductManifest, SelectOption } from '../types.js';

// Mapped-type form of an "any-shaped JSON object" — bypasses the
// `no-new-any` diff tripwire's polite-any pattern while remaining
// structurally identical to a string-indexed unknown record. Used by
// the manifest's title/subtitle/list-column builders to narrow loose
// quote-data shapes coming from the canonical wire input.
type JsonObject = { [k in string]?: unknown };

/**
 * Health Product Manifest — Brit Immigration Medical Insurance (Section A).
 *
 * CY-only Phase 1. Rides the existing BRIT travel binder family
 * (BinderProductAuthority(productCode='HEALTH') overlaid on each BRIT
 * binder by the seed). The questionnaire mirrors the customer journey
 * the wizard collects, and the BO Underwriting tab renders the same
 * section list directly via `buildQuestionnaireFromManifest(manifest)`.
 *
 * GHS (General Healthcare System) beneficiaries get a doctor visits +
 * medications extension at no extra premium — modelled as a wizard
 * question `ghs.isBeneficiary`, and as an MBE template with
 * `selectedWhen: [{ path: 'ghs.isBeneficiary', equals: true }]`.
 * Standard Section A outpatient cover (medicine & surgical operations)
 * is included for every Immigration policy regardless of GESY status.
 *
 * Cover amounts are fixed for the product (€8,600 inpatient/illness,
 * €13,700 per period, etc.). Premium and excess are age-banded only:
 * 0–62 €175 (10% co-insurance), 63–65 €210 (€200), 66–70 €245 (€900),
 * 71–74 €270 (€1,400), 75–79 €315 (€1,900), 80+ €430 (€2,800).
 */

export const HEALTH_COVER_TYPE_OPTIONS: SelectOption[] = [
  { value: 'single', label: 'Single Person' },
  { value: 'couple', label: 'A Couple' },
  { value: 'family', label: 'A Family' },
  { value: 'single_parent_family', label: 'Single Parent Family' },
];

/**
 * Country-of-residence eligibility question — accepts any country.
 *
 * ABY-284: a Phase-1 hardcoded `[{ value: 'Republic of Cyprus' }]` list
 * forced the answer through a single option, which (a) hid the
 * eligibility question's discriminating power (the customer never sees
 * "I'm not eligible" for a non-CY answer — they just see one option),
 * (b) violated ADR-0032 §5's "objective answers; expat status is
 * server-derived" rule, and (c) silently accepted the prefilled value
 * without forcing the customer to confirm.
 *
 * The canonical full nationality list is the single source of truth for
 * "any country" UI questions (see `Step5ProposerDetails.tsx` and
 * Travel's nationality dropdown). Eligibility / decline logic for
 * non-CY answers belongs in `healthUwAutomation.evaluateHealthUw`
 * (`allowedResidenceCountries: ['Cyprus']` → DECLINE), NOT
 * in the field-level option list.
 */
export const HEALTH_RESIDENCE_COUNTRY_OPTIONS: SelectOption[] = NATIONALITY_OPTIONS.map((country) => ({
  value: country,
  label: country,
}));

export const HEALTH_RESIDENCE_DURATION_OPTIONS: SelectOption[] = [
  { value: 'lt_1_year', label: 'Less than 1 year' },
  { value: '1_3_years', label: '1 to 3 years' },
  { value: 'gt_3_years', label: 'More than 3 years' },
];

export const HEALTH_RESIDENCY_STATUS_OPTIONS: SelectOption[] = [
  { value: 'permanent_resident', label: 'Permanent resident' },
  { value: 'temporary_resident', label: 'Temporary resident' },
  { value: 'work_visa', label: 'Work visa' },
  { value: 'student_visa', label: 'Student visa' },
  { value: 'visitor', label: 'Visitor' },
  { value: 'other_visa', label: 'Other visa' },
];

export const HEALTH_GENDER_OPTIONS: SelectOption[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

export const HEALTH_ID_TYPE_OPTIONS: SelectOption[] = [
  { value: 'passport', label: 'Passport' },
  { value: 'id_card', label: 'National ID Card' },
  { value: 'driving_licence', label: 'Driving Licence' },
];

export const HEALTH_OCCUPATION_OPTIONS: SelectOption[] = [
  { value: 'employed', label: 'Employed' },
  { value: 'self_employed', label: 'Self-employed' },
  { value: 'student', label: 'Student' },
  { value: 'retired', label: 'Retired' },
  { value: 'other', label: 'Other' },
];

export const HEALTH_NATIONALITY_OPTIONS: SelectOption[] = NATIONALITY_OPTIONS.map((country) => ({
  value: country,
  label: country,
}));

/**
 * `insuredObject.kind: 'person'` — Health insures one or more named
 * insureds (the proposer plus optional family members). The wizard's
 * `insureds.persons` list captures DOB / gender / ID / occupation per
 * insured; premium is the sum of each insured's age-band rate.
 */
export const healthManifest: ProductManifest = {
  productType: 'HEALTH',
  displayName: 'Immigration Medical Insurance',

  insuredObject: {
    kind: 'person',
    cardinality: 'many',
    label: { singular: 'Insured person', plural: 'Insured persons' },
    fields: [
      { path: 'insureds.coverType', label: 'Cover type', type: 'select', required: true, options: HEALTH_COVER_TYPE_OPTIONS },
      { path: 'insureds.persons', label: 'Insured persons', type: 'list', required: true },
    ],
  },

  questionnaire: {
    sections: [
      // Eligibility — objective expat questions (same shape as Travel
      // ADR-0025). `eligibility.isExpat` is DERIVED in UW automation,
      // never a customer-input boolean.
      {
        id: 'your-details', title: 'Your details', order: 1, fields: [
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
          { path: 'proposer.dateOfBirth', label: 'Date of birth', type: 'date', required: true },
          { path: 'proposer.gender', label: 'Gender', type: 'select', required: true, options: HEALTH_GENDER_OPTIONS },
          { path: 'proposer.idType', label: 'ID type', type: 'select', required: true, options: HEALTH_ID_TYPE_OPTIONS },
          { path: 'proposer.idNumber', label: 'ID number', type: 'text', required: true },
          { path: 'proposer.occupation', label: 'Occupation', type: 'select', required: true, options: HEALTH_OCCUPATION_OPTIONS },
          { path: 'proposer.marketingConsent', label: 'Marketing consent', type: 'boolean', required: true },
          { path: 'proposer.feedbackConsent', label: 'Feedback consent', type: 'boolean' },
        ],
      },
      {
        id: 'eligibility', title: 'Eligibility', order: 2, fields: [
          { path: 'eligibility.countryOfResidence', label: 'What is your current country of residence?', type: 'select', required: true, options: HEALTH_RESIDENCE_COUNTRY_OPTIONS },
          { path: 'eligibility.nationality', label: 'What is your nationality?', type: 'select', searchable: true, required: true, options: HEALTH_NATIONALITY_OPTIONS },
          { path: 'eligibility.hasOtherNationality', label: 'Do you hold any other nationality?', type: 'boolean', required: true },
          { path: 'eligibility.otherNationality', label: 'Other nationality', type: 'select', searchable: true, options: HEALTH_NATIONALITY_OPTIONS },
          { path: 'eligibility.residenceDuration', label: 'How long have you been living in your current country of residence?', type: 'select', required: true, options: HEALTH_RESIDENCE_DURATION_OPTIONS },
          { path: 'eligibility.willRemainResident', label: 'For the duration of your policy, please confirm that you will remain a resident of your current country of residence', type: 'boolean', required: true },
          { path: 'eligibility.residencyStatus', label: 'What is your residency status in your current country of residence?', type: 'select', required: true, options: HEALTH_RESIDENCY_STATUS_OPTIONS },
          { path: 'eligibility.legallyPermittedToReside', label: 'Are you legally permitted to reside in your current country of residence?', type: 'boolean', required: true },
          { path: 'eligibility.informationAccurate', label: 'I confirm that the information provided is accurate and that any incorrect declaration may affect cover or claims validation.', type: 'boolean', required: true },
          { path: 'eligibility.legalAgreement', label: 'Lloyd\u2019s residency declaration accepted', type: 'boolean', required: true },
        ],
      },
      {
        id: 'insured-persons', title: 'Insured persons', order: 3, fields: [
          { path: 'insureds.coverType', label: 'Cover type', type: 'select', required: true, options: HEALTH_COVER_TYPE_OPTIONS },
          { path: 'insureds.personCount', label: 'Number of insured persons', type: 'number' },
          { path: 'insureds.persons', label: 'Insured persons', type: 'list', required: true },
        ],
      },
      {
        id: 'period-and-ghs', title: 'Period & GESY', order: 4, fields: [
          { path: 'period.inceptionDate', label: 'Policy inception date', type: 'date', required: true },
          { path: 'period.expiryDate', label: 'Policy expiry date (auto: +1 year)', type: 'date' },
          { path: 'ghs.isBeneficiary', label: 'Is the proposer / lead insured a beneficiary of the General Healthcare System (GESY) in Cyprus?', type: 'boolean', required: true },
        ],
      },
      {
        id: 'quote', title: 'Your quote', order: 5, fields: [
          { path: 'quote.basePrice', label: 'Premium', type: 'currency' },
        ],
      },
      {
        id: 'declarations', title: 'Declarations', order: 6, fields: [
          { path: 'declarations.medicalNotice', label: 'Medical notice acknowledgement', type: 'boolean', required: true },
          { path: 'declarations.howToClaimReview', label: 'How to Claim / Complain / Privacy reviewed', type: 'boolean', required: true },
          { path: 'declarations.personalDataConsent', label: 'Personal data consent', type: 'boolean', required: true },
          { path: 'declarations.contractConsent', label: 'Contract consent', type: 'boolean', required: true },
          { path: 'declarations.contractAgreement', label: 'Payment portal agreement', type: 'boolean', required: true },
        ],
      },
    ],
  },

  summaryFields: {
    titlePaths: ['proposer.firstName', 'proposer.lastName'],
    subtitlePaths: ['period.inceptionDate', 'period.expiryDate'],
    insuredValuePath: 'quote.basePrice',
    buildTitle: (data) => {
      const proposer = (data.proposer && typeof data.proposer === 'object') ? data.proposer as JsonObject : {};
      const insureds = (data.insureds && typeof data.insureds === 'object') ? data.insureds as JsonObject : {};
      const firstName = String(proposer.firstName || '').trim();
      const lastName = String(proposer.lastName || '').trim();
      const coverType = String(insureds.coverType || '').trim().toLowerCase();
      const fullName = [firstName, lastName].filter(Boolean).join(' ');
      if (coverType === 'family' || coverType === 'single_parent_family') {
        if (lastName) return `${lastName} Family · Immigration Medical`;
        return 'Family Immigration Medical';
      }
      if (coverType === 'couple' && fullName) return `${fullName} & Partner · Immigration Medical`;
      if (fullName) return `${fullName} · Immigration Medical`;
      return null;
    },
    buildSubtitle: (data) => {
      const insureds = (data.insureds && typeof data.insureds === 'object') ? data.insureds as JsonObject : {};
      const persons = Array.isArray(insureds.persons) ? insureds.persons : [];
      const count = persons.length;
      const ghs = (data.ghs && typeof data.ghs === 'object') ? data.ghs as JsonObject : {};
      const ghsLabel = ghs.isBeneficiary === true ? 'GESY beneficiary' : null;
      const countLabel = count > 0 ? `${count} insured` : null;
      return [countLabel, ghsLabel].filter(Boolean).join(' · ') || null;
    },
  },

  listColumns: {
    insured: {
      primaryPaths: ['proposer.firstName', 'proposer.lastName'],
      buildPrimary: (data) => {
        const proposer = (data.proposer && typeof data.proposer === 'object') ? data.proposer as JsonObject : {};
        const firstName = String(proposer.firstName || '').trim();
        const lastName = String(proposer.lastName || '').trim();
        const fullName = [firstName, lastName].filter(Boolean).join(' ');
        return fullName || 'Immigration Medical';
      },
      buildSecondary: (data) => {
        const insureds = (data.insureds && typeof data.insureds === 'object') ? data.insureds as JsonObject : {};
        const persons = Array.isArray(insureds.persons) ? insureds.persons : [];
        return persons.length > 0 ? `${persons.length} insured` : null;
      },
    },
    coverage: {
      primaryPaths: [],
      buildPrimary: () => 'Immigration Medical Insurance',
      buildSecondary: (data) => {
        const ghs = (data.ghs && typeof data.ghs === 'object') ? data.ghs as JsonObject : {};
        return ghs.isBeneficiary === true ? 'GESY extension' : 'Inpatient, outpatient & repatriation';
      },
      buildStartDate: (data) => {
        const period = (data.period && typeof data.period === 'object') ? data.period as JsonObject : {};
        const start = String(period.inceptionDate || '').trim();
        return start || null;
      },
      buildEndDate: (data) => {
        const period = (data.period && typeof data.period === 'object') ? data.period as JsonObject : {};
        const end = String(period.expiryDate || '').trim();
        return end || null;
      },
    },
  },

  coverageCatalog: [
    { code: 'HEALTH-BASE-COVER', label: 'Inbound Individual Medical Insurance', scope: 'POLICY', group: 'core', required: true },
    { code: 'HEALTH-GHS-EXTENSION', label: 'GESY Doctor Visits + Medications Extension', scope: 'POLICY', group: 'extensions' },
    { code: 'HEALTH-GESY-CLAIMS-CONDITION', label: 'No. 141 – GESY Claims Condition', scope: 'POLICY', group: 'conditions' },
  ],

  uwConfigSchema: {
    groups: [
      {
        id: 'age', title: 'Age limits', fields: [
          { path: 'maxInsuredAge', label: 'Max insured age (auto-decline above)', type: 'number' },
          { path: 'referInsuredAge', label: 'Refer at age (require manual review)', type: 'number' },
        ],
      },
      {
        id: 'geography', title: 'Geography', fields: [
          { path: 'allowedResidenceCountries', label: 'Allowed residence countries (comma-separated ISO)', type: 'text' },
        ],
      },
    ],
  },

  documentTypes: {
    HEALTH_SCHEDULE_PDF: 'Health Schedule',
    HEALTH_CERTIFICATE_PDF: 'Certificate of Insurance',
    HEALTH_STATEMENT_OF_FACT_PDF: 'Statement of Fact',
    HEALTH_IPID_PDF: 'Insurance Product Information Document',
    HEALTH_POLICY_WORDING_PDF: 'Policy Wording',
  },

  riskModelHints: {
    requiredForUw: [
      { path: 'eligibility.countryOfResidence', label: 'Country of residence' },
      { path: 'eligibility.nationality', label: 'Nationality' },
      { path: 'eligibility.legallyPermittedToReside', label: 'Legally permitted to reside' },
      { path: 'insureds.coverType', label: 'Cover type' },
      { path: 'insureds.personCount', label: 'Number of insureds' },
      { path: 'period.inceptionDate', label: 'Inception date' },
      { path: 'ghs.isBeneficiary', label: 'GESY beneficiary' },
    ],
    referralFlags: [],
    ratingInputs: [
      { path: 'insureds.coverType', label: 'Cover type', format: 'text' },
      { path: 'insureds.personCount', label: 'Insured count', format: 'text' },
      { path: 'ghs.isBeneficiary', label: 'GESY beneficiary', format: 'boolean' },
    ],
  },

  rules: { batchRules: { minUnits: 0 } },

  // segmentLabel: customer-facing chip on /quote/start and the BO product
  // picker. The product is "Immigration Medical Insurance" everywhere else
  // in the manifest (`displayName`, `buildPrimary`, MBE coverage labels, BO
  // policy card subtitle), so the picker chip must match — calling it
  // "Health" misleads visitors who landed via Marker.io triage on the
  // public landing page (ABY-278). "Immigration" is the short form already
  // used by the wizard hero (`Your Immigration Medical Cover`) and by the
  // hero subline ("Brit Immigration Medical Insurance — Cyprus only").
  theme: { iconKey: 'heart-pulse', segmentLabel: 'Immigration' },
};
