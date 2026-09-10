import type { ProductManifest, SelectOption } from '../types.js';
import { countries } from '../shared/countries.js';
import {
  COUNTRY_OF_REGISTRATION_OPTIONS,
  FUEL_TYPE_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
} from './vehicleEnrichment.js';

const toSelectOptions = (options: readonly SelectOption[]): SelectOption[] =>
  options.map((option) => ({ value: option.value, label: option.label }));

export const MOTOR_WHERE_DID_YOU_HEAR_OPTIONS: SelectOption[] = [
  { value: 'Google', label: 'Google' },
  { value: 'Existing Client', label: 'Existing Client' },
  { value: 'Recommendation', label: 'Recommendation' },
  { value: 'Link from another site', label: 'Link from another site' },
  { value: 'Introducer', label: 'Introducer' },
  { value: '4Business Magazine', label: '4Business Magazine' },
  { value: 'Euro Weekly News', label: 'Euro Weekly News' },
  { value: 'Bing', label: 'Bing' },
  { value: 'Cyprus Local Directories', label: 'Cyprus Local Directories' },
  { value: 'Cyprus Mail', label: 'Cyprus Mail' },
  { value: 'Daxi Magazine', label: 'Daxi Magazine' },
  { value: 'Facebook', label: 'Facebook' },
  { value: 'Instagram', label: 'Instagram' },
  { value: 'LinkedIn', label: 'LinkedIn' },
  { value: 'Mailshot', label: 'Mailshot' },
  { value: 'Paphos Post', label: 'Paphos Post' },
  { value: 'Pocket Diary (Cyprus)', label: 'Pocket Diary (Cyprus)' },
  { value: 'Portugal News', label: 'Portugal News' },
  { value: 'Radio', label: 'Radio' },
  { value: 'Rock FM', label: 'Rock FM' },
  { value: 'Twitter', label: 'Twitter' },
  { value: 'We Love Cyprus', label: 'We Love Cyprus' },
  { value: 'Other', label: 'Other' },
];

export const MOTOR_LICENSE_YEARS_OPTIONS: SelectOption[] = Array.from({ length: 61 }, (_, i) => ({
  value: String(i),
  label: i === 0 ? 'Less than 1 year' : `${i} ${i === 1 ? 'year' : 'years'}`,
}));

export const MOTOR_LICENSE_TYPE_OPTIONS: SelectOption[] = [
  { value: 'Full', label: 'Full' },
  { value: 'Provisional', label: 'Provisional' },
];

const priorityLicenseIssuedCountries = ['United Kingdom', 'Cyprus', 'Portugal', 'Spain'];
export const MOTOR_LICENSE_ISSUED_IN_OPTIONS: SelectOption[] = [
  ...priorityLicenseIssuedCountries.map((country) => ({ value: country, label: country })),
  { value: 'Other EU', label: 'Other EU' },
  ...countries
    .filter((country) => !priorityLicenseIssuedCountries.includes(country))
    .map((country) => ({ value: country, label: country })),
];

export const MOTOR_YOUNGEST_DRIVER_AGE_OPTIONS: SelectOption[] = Array.from({ length: 66 }, (_, i) => {
  const age = 15 + i;
  return { value: String(age), label: String(age) };
});

/**
 * Driver coverage restriction (ABY-232 / ADR-0025). Canonical option
 * set rendered in the public motor wizard and the BO underwriting
 * questionnaire. Values are stable enum tokens; the labels here are
 * the user-facing copy and align with the four-option dropdown
 * shipped in the source system screenshot.
 */
export const MOTOR_DRIVER_RESTRICTION_OPTIONS: SelectOption[] = [
  { value: 'POLICYHOLDER_ONLY', label: 'Policy Holder' },
  { value: 'NAMED_DRIVERS', label: 'Named Drivers Only' },
  { value: 'ANY_DRIVER_25_PLUS', label: 'Any Driver Over 25' },
  { value: 'ANY_DRIVER_40_PLUS', label: 'Any Driver Over 40' },
];

const vehicleTypeReviewLabel: Partial<Record<string, string>> = {
  Pickup: 'Pickup (manual review)',
  Motorcaravan: 'Motorcaravan (manual review)',
  Classic: 'Classic vehicle (manual review)',
};

export const MOTOR_VEHICLE_TYPE_OPTIONS: SelectOption[] = VEHICLE_TYPE_OPTIONS.map((option) => ({
  value: option.value,
  label: vehicleTypeReviewLabel[option.value] ?? option.label,
}));

export const MOTOR_FUEL_TYPE_OPTIONS: SelectOption[] = toSelectOptions(FUEL_TYPE_OPTIONS);
export const MOTOR_COUNTRY_OF_REGISTRATION_OPTIONS: SelectOption[] = toSelectOptions(COUNTRY_OF_REGISTRATION_OPTIONS);

export const MOTOR_VEHICLE_USE_OPTIONS: SelectOption[] = [
  { value: 'SD&P', label: 'Private' },
  { value: 'Class 1', label: 'Business use' },
  { value: 'Class 2', label: 'Business + employees' },
  { value: 'Class 3', label: 'Business incl. haulage' },
];

export const MOTOR_KMS_PER_YEAR_OPTIONS: SelectOption[] = [
  { value: '5,000', label: '5,000' },
  { value: '10,000', label: '10,000' },
  { value: '20,000', label: '20,000' },
  { value: '30,000', label: '30,000' },
  { value: 'Over 30,000', label: 'Over 30,000' },
];

export const MOTOR_PARKING_OPTIONS: SelectOption[] = [
  { value: 'Drive', label: 'Drive' },
  { value: 'Garage', label: 'Garage' },
  { value: 'Road', label: 'Road' },
  { value: 'Other', label: 'Other' },
];

export const MOTOR_NCB_OPTIONS: SelectOption[] = [
  { value: 'None', label: 'None' },
  { value: '1 Year', label: '1 Year' },
  { value: '2 Years', label: '2 Years' },
  { value: '3 Years', label: '3 Years' },
  { value: '4 Years', label: '4 Years' },
  { value: '5+ Years', label: '5+ Years' },
];

export const MOTOR_BEST_TIME_TO_CALL_OPTIONS: SelectOption[] = [
  { value: 'Anytime', label: 'Anytime' },
  { value: 'Morning (09:00-12:00)', label: 'Morning (09:00-12:00)' },
  { value: 'Afternoon (12:00-17:00)', label: 'Afternoon (12:00-17:00)' },
  { value: 'Evening (17:00-20:00)', label: 'Evening (17:00-20:00)' },
];

/**
 * Motor Product Manifest — canonical declarative contract for the Motor
 * product. Consumed unchanged by the BO underwriting / list / detail
 * surfaces (via `backend/products/motor/runtime.ts` →
 * `ProductRegistry.register`) and by the public motor wizard (via
 * `frontend/src/products/motor/register.ts`).
 *
 * Phase 4 (2026-04 consolidation): collapsed the previous BE+FE mirrors
 * (`backend/products/motor/manifest.ts` and
 * `frontend/src/products/motor/manifest.ts`) into this single file.
 * The earlier drift on `summaryFields.titlePaths` (BE: year-make-model;
 * FE: make-model-year) is resolved here in favour of the BE order —
 * "2018 Toyota Corolla" matches the rendered policy headline / list row
 * across BO and customer surfaces.
 *
 * Source content: previously distributed across motor questionnaire
 * contracts (Gen1), `policyAutoRiskModel.ts` (UW risk chips),
 * `MotorUwConfig` (program editor schema), MBE coverage templates for
 * the `abbeygate_motor` program code, and `MotorProductAdapter
 * .getDocumentTypes()` — now consolidated here as the single source of
 * truth.
 */
export const motorManifest: ProductManifest = {
  productType: 'MOTOR',
  displayName: 'Motor Insurance',

  insuredObject: {
    kind: 'vehicle',
    cardinality: 'one',
    label: { singular: 'Vehicle', plural: 'Vehicles' },
    fields: [
      { path: 'make', label: 'Make', type: 'text', required: true },
      { path: 'model', label: 'Model', type: 'text', required: true },
      { path: 'year', label: 'Year', type: 'number', required: true, min: 1950, max: 2100 },
      { path: 'fuelType', label: 'Fuel type', type: 'select', options: MOTOR_FUEL_TYPE_OPTIONS },
      { path: 'engineSize', label: 'Engine size (cc)', type: 'number' },
      { path: 'vehicleValue', label: 'Vehicle value', type: 'currency', required: true, min: 0 },
      { path: 'registrationNumber', label: 'Registration number', type: 'text' },
      { path: 'vin', label: 'VIN', type: 'text' },
      { path: 'countryOfRegistration', label: 'Country of registration', type: 'text' },
      { path: 'vehicleType', label: 'Vehicle type', type: 'text' },
    ],
  },

  questionnaire: {
    sections: [
      {
        id: 'policy-holder',
        title: 'Part 1: Policyholder',
        order: 1,
        fields: [
          { path: 'proposer.firstName', label: 'First name', type: 'text', required: true },
          { path: 'proposer.lastName', label: 'Last name', type: 'text', required: true },
          { path: 'proposer.email', label: 'Email', type: 'text', required: true },
          { path: 'proposer.phone', label: 'Telephone', type: 'text', required: true },
          { path: 'proposer.dateOfBirth', label: 'Date of birth', type: 'date', required: true },
          { path: 'proposer.nationality', label: 'Nationality', type: 'select', searchable: true },
          { path: 'proposer.address.line1', label: 'Address line', type: 'text' },
          { path: 'proposer.address.city', label: 'City', type: 'text' },
          { path: 'proposer.address.province', label: 'Province/Region', type: 'text' },
          { path: 'proposer.address.postcode', label: 'Post code', type: 'text' },
          { path: 'proposer.address.country', label: 'Country', type: 'select', searchable: true },
          { path: 'proposer.nif', label: 'NIF / national ID', type: 'text' },
        ],
      },
      {
        id: 'driving-history',
        title: 'Part 2: Driving & history',
        order: 2,
        fields: [
          { path: 'proposer.occupation', label: 'Occupation', type: 'text' },
          { path: 'proposer.whereDidYouHear', label: 'Where did you hear about us?', type: 'select', options: MOTOR_WHERE_DID_YOU_HEAR_OPTIONS },
          { path: 'licenseYears', label: 'License years', type: 'select', required: true, options: MOTOR_LICENSE_YEARS_OPTIONS },
          { path: 'licenseType', label: 'License type', type: 'select', required: true, options: MOTOR_LICENSE_TYPE_OPTIONS },
          { path: 'licenseIssuedIn', label: 'License issued in', type: 'select', required: true, searchable: true, options: MOTOR_LICENSE_ISSUED_IN_OPTIONS },
          { path: 'hasClaims', label: 'Any claims in last 5 years', type: 'boolean', required: true },
          { path: 'claimsCountLast5Years', label: 'Number of claims (last 5 years)', type: 'number', visibleWhenKey: 'hasClaims', visibleWhenValue: true },
          { path: 'claimsTotalCostLast5Years', label: 'Total cost of claims (last 5 years)', type: 'currency', visibleWhenKey: 'hasClaims', visibleWhenValue: true },
          { path: 'maxFaultClaimCostLast5Years', label: 'Largest at-fault claim (last 5 years)', type: 'currency', visibleWhenKey: 'hasClaims', visibleWhenValue: true },
          { path: 'claimsDetails', label: 'Claims details', type: 'textarea', requiredWhenKey: 'hasClaims', requiredWhenValue: true, visibleWhenKey: 'hasClaims', visibleWhenValue: true },
          { path: 'hasConvictions', label: 'Any convictions in last 5 years', type: 'boolean', required: true },
          { path: 'convictionClass', label: 'Conviction class', type: 'select', visibleWhenKey: 'hasConvictions', visibleWhenValue: true, options: [
            { value: 'minor_technical', label: 'Minor technical offence (no load)' },
            { value: 'minor_offence_10', label: 'Minor offence (10 points)' },
            { value: 'minor_offence_225', label: 'Minor offence (22.5 points)' },
            { value: 'serious_technical', label: 'Serious technical offence (15 points)' },
            { value: 'major', label: 'Major conviction' },
            { value: 'other', label: 'Other / unclear' },
          ] },
          { path: 'majorConvictionWithinYears', label: 'Major conviction within', type: 'select', visibleWhenKey: 'convictionClass', visibleWhenValue: 'major', options: [
            { value: '2', label: 'Within last 2 years' },
            { value: '3', label: 'Within last 3 years' },
            { value: '5', label: 'Within last 5 years' },
          ] },
          { path: 'hasMajorConvictionLast5Years', label: 'Major conviction in last 5 years', type: 'boolean', visibleWhenKey: 'hasConvictions', visibleWhenValue: true },
          { path: 'convictionsDetails', label: 'Convictions details', type: 'textarea', requiredWhenKey: 'hasConvictions', requiredWhenValue: true, visibleWhenKey: 'hasConvictions', visibleWhenValue: true },
          { path: 'driverRestriction', label: 'Driver coverage', type: 'select', required: true, options: MOTOR_DRIVER_RESTRICTION_OPTIONS },
          { path: 'hasAdditionalDrivers', label: 'Additional drivers', type: 'boolean', visibleWhenKey: 'driverRestriction', visibleWhenValue: 'NAMED_DRIVERS', requiredWhenKey: 'driverRestriction', requiredWhenValue: 'NAMED_DRIVERS' },
          { path: 'youngestDriverAge', label: 'Youngest driver age', type: 'select', visibleWhenKey: 'hasAdditionalDrivers', visibleWhenValue: true, options: MOTOR_YOUNGEST_DRIVER_AGE_OPTIONS },
          { path: 'otherDriversClaims', label: 'Other drivers — claims?', type: 'boolean', visibleWhenKey: 'hasAdditionalDrivers', visibleWhenValue: true },
          { path: 'otherDriversClaimsDetails', label: 'Other drivers — claims details', type: 'textarea', visibleWhenKey: 'otherDriversClaims', visibleWhenValue: true },
          { path: 'otherDriversConvictions', label: 'Other drivers — convictions?', type: 'boolean', visibleWhenKey: 'hasAdditionalDrivers', visibleWhenValue: true },
          { path: 'otherDriversConvictionsDetails', label: 'Other drivers — convictions details', type: 'textarea', visibleWhenKey: 'otherDriversConvictions', visibleWhenValue: true },
          { path: 'additionalDrivers', label: 'Additional driver details', type: 'list', requiredWhenKey: 'hasAdditionalDrivers', requiredWhenValue: true, visibleWhenKey: 'hasAdditionalDrivers', visibleWhenValue: true },
        ],
      },
      {
        id: 'vehicle-cover',
        title: 'Part 3: Vehicle & cover',
        order: 3,
        fields: [
          { path: 'coverRequired', label: 'Cover required', type: 'select', required: true, options: [
            { value: 'Third Party Liability', label: 'Third Party Liability' },
            { value: 'Own Damage', label: 'Own Damage (Comprehensive)' },
          ] },
          { path: 'renewalDate', label: 'Renewal date', type: 'date' },
          { path: 'vehicleType', label: 'Vehicle type', type: 'select', required: true, options: MOTOR_VEHICLE_TYPE_OPTIONS },
          { path: 'make', label: 'Make', type: 'select', required: true, searchable: true },
          { path: 'model', label: 'Model', type: 'select', required: true, searchable: true },
          { path: 'year', label: 'Year', type: 'number', required: true },
          { path: 'fuelType', label: 'Fuel type', type: 'select', options: MOTOR_FUEL_TYPE_OPTIONS },
          { path: 'engineSize', label: 'Engine size (cc)', type: 'number' },
          { path: 'vehicleValue', label: 'Vehicle value', type: 'currency', required: true },
          { path: 'registrationNumber', label: 'Registration number', type: 'text' },
          { path: 'vin', label: 'VIN', type: 'text' },
          { path: 'countryOfRegistration', label: 'Country of registration', type: 'select', options: MOTOR_COUNTRY_OF_REGISTRATION_OPTIONS },
          { path: 'vehicleUse', label: 'Vehicle use', type: 'select', required: true, options: MOTOR_VEHICLE_USE_OPTIONS },
          { path: 'kmsPerYear', label: 'KMs per year', type: 'select', options: MOTOR_KMS_PER_YEAR_OPTIONS },
          { path: 'parking', label: 'Parking', type: 'select', options: MOTOR_PARKING_OPTIONS },
          { path: 'parkingOther', label: 'Parking (other)', type: 'text', visibleWhenKey: 'parking', visibleWhenValue: 'Other' },
          { path: 'modified', label: 'Vehicle modified?', type: 'boolean' },
          { path: 'modificationsDetails', label: 'Modifications details', type: 'textarea', visibleWhenKey: 'modified', visibleWhenValue: true },
          { path: 'ncb', label: 'No claims discount', type: 'select', required: true, options: MOTOR_NCB_OPTIONS },
          { path: 'protectNCB', label: 'Protect NCB', type: 'boolean' },
          { path: 'requiredExcess', label: 'Required excess', type: 'currency' },
        ],
      },
      {
        id: 'declarations',
        title: 'Part 4: Declarations',
        order: 4,
        fields: [
          { path: 'proposer.bestTimeToCall', label: 'Best time to call', type: 'select', options: MOTOR_BEST_TIME_TO_CALL_OPTIONS },
          { path: 'homeInsuranceRenewalDate', label: 'Home insurance renewal date', type: 'date' },
          { path: 'proposer.privacyPolicyAccepted', label: 'Privacy policy accepted', type: 'boolean', required: true },
          { path: 'infoTrueAndAccurate', label: 'Information true and accurate', type: 'boolean', required: true },
          { path: 'fairProcessingAccepted', label: 'Fair processing accepted', type: 'boolean', required: true },
        ],
      },
    ],
  },
  questionnaireHiddenKeys: ['motorcycleRidersNamed'],

  summaryFields: {
    titlePaths: ['year', 'make', 'model'],
    subtitlePaths: ['fuelType', 'engineSize'],
    insuredValuePath: 'vehicleValue',
  },

  listColumns: {
    insured: {
      primaryPaths: [],
      secondaryPaths: [],
      primaryFormat: 'joined',
      buildPrimary: (data) => [data.year, data.make, data.model]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' ') || null,
      buildSecondary: (data) => {
        const fuel = String(data.fuelType || '').trim();
        const engine = String(data.engineSize || '').replace(/\D/g, '').trim();
        return [fuel, engine ? `${engine}cc` : ''].filter(Boolean).join(' · ') || null;
      },
    },
    coverage: {
      primaryPaths: ['coverRequired'],
      secondaryPaths: [],
      buildSecondary: (data) => {
        const raw = data.requiredExcess;
        const numeric = typeof raw === 'number'
          ? raw
          : Number(String(raw || '').replace(/[^0-9.]/g, ''));
        if (!Number.isFinite(numeric) || numeric <= 0) return null;
        return `€${Math.round(numeric).toLocaleString()} excess`;
      },
    },
  },

  coverageCatalog: [
    { code: 'CV 172', label: 'Comprehensive plus', scope: 'POLICY', group: 'extras' },
    { code: 'COV-ROADSIDE', label: 'Roadside assistance', scope: 'POLICY', group: 'extras' },
    { code: 'COV-ROADSIDE-VIP', label: 'Roadside VIP', scope: 'POLICY', group: 'extras' },
    { code: 'COV-WINDSCREEN', label: 'Windscreen cover', scope: 'RISK_OBJECT', group: 'extras' },
    { code: 'COV-COURTESY-CAR', label: 'Courtesy car', scope: 'RISK_OBJECT', group: 'extras' },
  ],

  uwConfigSchema: {
    groups: [
      {
        id: 'vehicle',
        title: 'Vehicle thresholds',
        fields: [
          { path: 'maxVehicleValue', label: 'Maximum vehicle value', type: 'currency' },
          { path: 'minVehicleYear', label: 'Minimum vehicle year', type: 'number' },
          { path: 'motorcycleMaxEngineSize', label: 'Motorcycle max engine size (cc)', type: 'number' },
        ],
      },
      {
        id: 'driver',
        title: 'Driver thresholds',
        fields: [
          { path: 'minDriverAge', label: 'Minimum driver age', type: 'number' },
          { path: 'maxDriverAge', label: 'Maximum driver age', type: 'number' },
          { path: 'minLicenseYears', label: 'Minimum license years', type: 'number' },
        ],
      },
    ],
  },

  documentTypes: {
    MOTOR_SCHEDULE_PDF: 'Policy Schedule',
    MOTOR_CERTIFICATE_PDF: 'Certificate of Insurance',
    MOTOR_STATEMENT_OF_FACT_PDF: 'Statement of Fact',
    MOTOR_GREEN_CARD_PDF: 'Green Card',
    MOTOR_POLICY_WORDING_PDF: 'Policy Wording',
    MOTOR_ENDORSEMENT_SCHEDULE_PDF: 'Endorsement Schedule',
  },

  riskModelHints: {
    requiredForUw: [
      { path: 'proposer.firstName', label: 'First name' },
      { path: 'proposer.lastName', label: 'Last name' },
      { path: 'proposer.email', label: 'Email' },
      { path: 'proposer.phone', label: 'Telephone' },
      { path: 'proposer.dateOfBirth', label: 'Date of birth' },
      { path: 'licenseYears', label: 'License years' },
      { path: 'licenseType', label: 'License type' },
      { path: 'licenseIssuedIn', label: 'License issued in' },
      { path: 'coverRequired', label: 'Cover required' },
      { path: 'vehicleType', label: 'Vehicle type' },
      { path: 'make', label: 'Vehicle make' },
      { path: 'model', label: 'Vehicle model' },
      { path: 'year', label: 'Vehicle year' },
      { path: 'engineSize', label: 'Engine size' },
      { path: 'vehicleValue', label: 'Vehicle value' },
      { path: 'ncb', label: 'No Claims Discount' },
      { path: 'vehicleUse', label: 'Vehicle use' },
    ],
    referralFlags: [
      { path: 'hasClaims', label: 'Claims declared', points: -18, reason: 'Claims in last 5 years require underwriting review.' },
      { path: 'hasConvictions', label: 'Convictions declared', points: -22, reason: 'Convictions in last 5 years require underwriting review.' },
    ],
    ratingInputs: [
      { path: 'coverRequired', label: 'Cover', format: 'text' },
      { path: 'vehicleValue', label: 'Vehicle value', format: 'currency' },
      { path: 'engineSize', label: 'Engine size', format: 'text' },
      { path: 'year', label: 'Vehicle year', format: 'text' },
      { path: 'proposer.dateOfBirth', label: 'DOB', format: 'text' },
      { path: 'licenseYears', label: 'Licence years', format: 'text' },
      { path: 'kmsPerYear', label: 'KMs / year', format: 'text' },
      { path: 'hasClaims', label: 'Claims', format: 'boolean' },
      { path: 'ncb', label: 'NCB', format: 'text' },
      { path: 'driverRestriction', label: 'Driver coverage', format: 'text' },
      { path: 'hasAdditionalDrivers', label: 'Additional drivers', format: 'boolean' },
      { path: 'youngestDriverAge', label: 'Youngest driver age', format: 'text' },
      { path: 'requiredExcess', label: 'Excess', format: 'currency' },
    ],
  },

  rules: {
    // Motor does not enforce the 250-units minimum on UW follow-up batches.
    batchRules: { minUnits: 0 },
  },

  theme: {
    iconKey: 'car',
    segmentLabel: 'Motor',
  },
};
