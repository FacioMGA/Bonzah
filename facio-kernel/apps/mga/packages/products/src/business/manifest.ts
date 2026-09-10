import { NATIONALITY_OPTIONS } from '@facio/validation';
import type { ProductManifest, SelectOption } from '../types.js';

type JsonObject = { [k: string]: unknown };

export const BUSINESS_HEAR_ABOUT_OPTIONS: SelectOption[] = [
  { value: 'google', label: 'Google' },
  { value: 'existing_client', label: 'Existing Client' },
  { value: 'recommendation', label: 'Recommendation' },
  { value: 'introducer', label: 'Introducer' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'mailshot', label: 'Mailshot' },
  { value: 'cyprus_mail', label: 'Cyprus Mail' },
  { value: 'other', label: 'Other' },
];

export const BUSINESS_YES_NO_OPTIONS: SelectOption[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export const BUSINESS_COVER_TIMING_OPTIONS: SelectOption[] = [
  { value: 'asap', label: 'As soon as possible' },
  { value: 'within_7_days', label: 'Within 7 days' },
  { value: 'within_1_month', label: 'Within 1 month' },
  { value: 'checking_prices', label: 'Just checking prices' },
];

export const BUSINESS_PREMISES_STATUS_OPTIONS: SelectOption[] = [
  { value: 'owned', label: 'Owned' },
  { value: 'rented', label: 'Rented' },
];

export const BUSINESS_FIRE_RESPONSE_OPTIONS: SelectOption[] = [
  { value: 'extinguishers', label: 'Extinguishers' },
  { value: 'prepared_fire_hoses', label: 'Prepared fire hoses' },
  { value: 'sprinklers', label: 'Sprinklers' },
  { value: 'connected_automatic_detectors', label: 'Connected automatic detectors' },
  { value: 'permanent_vigilance', label: 'Permanent vigilance' },
  { value: 'other', label: 'Other' },
];

export const BUSINESS_THEFT_PREVENTION_OPTIONS: SelectOption[] = [
  { value: 'solid_wood', label: 'Solid wood' },
  { value: 'metallic', label: 'Metallic' },
  { value: 'iron', label: 'Iron' },
  { value: 'iron_or_steel_blinds', label: 'Iron or steel blinds' },
  { value: 'iron_or_steel_bars', label: 'Iron or steel bars' },
  { value: 'glass', label: 'Glass' },
  { value: 'other', label: 'Other' },
];

export const BUSINESS_NATIONALITY_OPTIONS: SelectOption[] = NATIONALITY_OPTIONS.map((country) => ({
  value: country,
  label: country,
}));

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function selectedCoverageLabels(data: Record<string, unknown>): string {
  const coverage = asRecord(data.coverage);
  const labels: string[] = [];
  if (Number(coverage.buildings || 0) > 0) labels.push('Property');
  if (Number(coverage.stock || 0) > 0) labels.push('Stock');
  if (Number(coverage.equipment || 0) > 0) labels.push('Equipment');
  if (coverage.publicLiability === true || coverage.publicLiability === 'yes') labels.push('Public liability');
  if (coverage.employersLiability === true || coverage.employersLiability === 'yes') labels.push('Employers liability');
  if (coverage.businessInterruption === true || coverage.businessInterruption === 'yes') labels.push('Business interruption');
  if (coverage.legalAssistance === true || coverage.legalAssistance === 'yes') labels.push('Legal assistance');
  return labels.join(' + ') || 'Manual commercial package';
}

export const businessManifest: ProductManifest = {
  productType: 'BUSINESS',
  displayName: 'Business Insurance',

  insuredObject: {
    kind: 'business',
    cardinality: 'one',
    label: { singular: 'Business', plural: 'Businesses' },
    fields: [
      { path: 'business.typeOfBusiness', label: 'Type of business', type: 'text', required: true },
      { path: 'business.premises.address.line1', label: 'Business premises address', type: 'text' },
      { path: 'business.premises.address.city', label: 'City', type: 'text' },
      { path: 'business.premises.address.country', label: 'Country', type: 'text' },
    ],
  },

  questionnaire: {
    sections: [
      {
        id: 'proposer',
        title: 'Details of proposer',
        order: 1,
        fields: [
          { path: 'proposer.firstName', label: 'First name', type: 'text', required: true },
          { path: 'proposer.lastName', label: 'Last name', type: 'text', required: true },
          { path: 'proposer.dateOfBirth', label: 'Date of birth', type: 'date' },
          { path: 'proposer.email', label: 'Email address', type: 'text', required: true },
          { path: 'proposer.phone', label: 'Telephone', type: 'text', required: true },
          { path: 'proposer.nationality', label: 'Nationality', type: 'select', searchable: true, options: BUSINESS_NATIONALITY_OPTIONS },
          { path: 'proposer.idNumber', label: 'Resident ID or passport number', type: 'text' },
          { path: 'proposer.occupation', label: 'Occupation', type: 'text' },
          { path: 'proposer.address.line1', label: 'Address', type: 'text', required: true },
          { path: 'proposer.address.city', label: 'City', type: 'text', required: true },
          { path: 'proposer.address.province', label: 'Province', type: 'text' },
          { path: 'proposer.address.postcode', label: 'Post code', type: 'text' },
          { path: 'proposer.address.country', label: 'Country', type: 'select', searchable: true, required: true },
          { path: 'proposer.hearAboutUs', label: 'Where did you hear about us?', type: 'select', options: BUSINESS_HEAR_ABOUT_OPTIONS },
          { path: 'proposer.marketingConsent', label: 'Marketing consent', type: 'boolean' },
        ],
      },
      {
        id: 'business-details',
        title: 'Insurance details',
        order: 2,
        fields: [
          { path: 'business.typeOfBusiness', label: 'Type of business', type: 'text', required: true },
          { path: 'business.numberOfEmployees', label: 'Number of employees', type: 'number', min: 0, required: true },
          { path: 'business.yearPremisesConstructed', label: 'Year premises constructed', type: 'number' },
          { path: 'business.sizeOfPremisesSqm', label: 'Size of premises (m2)', type: 'number', min: 0 },
          { path: 'business.coverTiming', label: 'When do you require cover?', type: 'select', options: BUSINESS_COVER_TIMING_OPTIONS, required: true },
          { path: 'business.registeredForTax', label: 'Are you registered for tax?', type: 'select', options: BUSINESS_YES_NO_OPTIONS },
          { path: 'business.premisesStatus', label: 'Premises status', type: 'select', options: BUSINESS_PREMISES_STATUS_OPTIONS },
          { path: 'coverage.buildings', label: 'Buildings cover', type: 'currency', min: 0 },
          { path: 'coverage.stock', label: 'Stock cover', type: 'currency', min: 0 },
          { path: 'coverage.equipment', label: 'Equipment cover', type: 'currency', min: 0 },
          { path: 'coverage.publicLiability', label: 'Public liability cover', type: 'select', options: BUSINESS_YES_NO_OPTIONS, required: true },
          { path: 'coverage.publicLiabilityLimit', label: 'Public liability limit', type: 'currency', min: 0, visibleWhenKey: 'coverage.publicLiability', visibleWhenValue: 'yes' },
          { path: 'coverage.employersLiability', label: 'Employers liability', type: 'select', options: BUSINESS_YES_NO_OPTIONS, required: true },
          { path: 'coverage.employersLiabilityLimit', label: 'Employers liability limit', type: 'currency', min: 0, visibleWhenKey: 'coverage.employersLiability', visibleWhenValue: 'yes' },
          { path: 'coverage.businessInterruption', label: 'Business interruption', type: 'select', options: BUSINESS_YES_NO_OPTIONS, required: true },
          { path: 'coverage.businessInterruptionLimit', label: 'Business interruption limit', type: 'currency', min: 0, visibleWhenKey: 'coverage.businessInterruption', visibleWhenValue: 'yes' },
          { path: 'coverage.businessInterruptionIndemnityMonths', label: 'Business interruption indemnity period (months)', type: 'number', min: 0, visibleWhenKey: 'coverage.businessInterruption', visibleWhenValue: 'yes' },
          { path: 'coverage.legalAssistance', label: 'Legal assistance', type: 'select', options: BUSINESS_YES_NO_OPTIONS, required: true },
          { path: 'security.rejasOnWindowsAndDoors', label: 'Do you have rejas on all windows and entrance doors?', type: 'select', options: BUSINESS_YES_NO_OPTIONS, required: true },
          { path: 'security.alarm', label: 'Has the property got an alarm?', type: 'select', options: BUSINESS_YES_NO_OPTIONS, required: true },
          { path: 'security.fireResponseEquipment', label: 'Fire response equipment', type: 'select', options: BUSINESS_FIRE_RESPONSE_OPTIONS, required: true },
          { path: 'security.fireResponseEquipmentOther', label: "If 'Other' please specify", type: 'text', visibleWhenKey: 'security.fireResponseEquipment', visibleWhenValue: 'other' },
          { path: 'security.mainDoor', label: 'Main door', type: 'select', options: BUSINESS_THEFT_PREVENTION_OPTIONS, required: true },
          { path: 'security.mainDoorOther', label: "If 'Other' please specify", type: 'text', visibleWhenKey: 'security.mainDoor', visibleWhenValue: 'other' },
          { path: 'security.secondDoor', label: 'Second door', type: 'select', options: BUSINESS_THEFT_PREVENTION_OPTIONS },
          { path: 'security.secondDoorOther', label: "If 'Other' please specify", type: 'text', visibleWhenKey: 'security.secondDoor', visibleWhenValue: 'other' },
          { path: 'security.windows', label: 'Windows', type: 'select', options: BUSINESS_THEFT_PREVENTION_OPTIONS, required: true },
          { path: 'security.windowsOther', label: "If 'Other' please specify", type: 'text', visibleWhenKey: 'security.windows', visibleWhenValue: 'other' },
          { path: 'security.shopWindow', label: 'Shop window', type: 'select', options: BUSINESS_THEFT_PREVENTION_OPTIONS },
          { path: 'security.shopWindowOther', label: "If 'Other' please specify", type: 'text', visibleWhenKey: 'security.shopWindow', visibleWhenValue: 'other' },
        ],
      },
      {
        id: 'review-submit',
        title: 'Review and submit',
        order: 3,
        fields: [
          { path: 'declarations.informationAccurate', label: 'I confirm the information provided is true and accurate.', type: 'boolean', required: true },
        ],
      },
    ],
  },

  summaryFields: {
    titlePaths: ['business.typeOfBusiness', 'proposer.lastName'],
    subtitlePaths: ['business.numberOfEmployees', 'business.coverTiming'],
    insuredValuePath: 'coverage.buildings',
    buildTitle: (data) => {
      const business = asRecord(data.business);
      const typeOfBusiness = String(business.typeOfBusiness || '').trim();
      return typeOfBusiness ? `${typeOfBusiness} Business Insurance` : 'Business Insurance';
    },
    buildSubtitle: selectedCoverageLabels,
  },

  listColumns: {
    insured: {
      primaryPaths: [],
      buildPrimary: (data) => {
        const business = asRecord(data.business);
        return String(business.typeOfBusiness || '').trim() || 'Business';
      },
      buildSecondary: (data) => {
        const business = asRecord(data.business);
        const employees = Number(business.numberOfEmployees);
        return Number.isFinite(employees) ? `${employees} employees` : null;
      },
    },
    coverage: {
      primaryPaths: [],
      buildPrimary: selectedCoverageLabels,
      buildSecondary: () => 'Manual broker review required',
    },
  },

  coverageCatalog: [
    { code: 'BUSINESS-PROPERTY', label: 'Property cover', scope: 'POLICY', group: 'property' },
    { code: 'BUSINESS-STOCK', label: 'Stock cover', scope: 'POLICY', group: 'property' },
    { code: 'BUSINESS-EQUIPMENT', label: 'Equipment cover', scope: 'POLICY', group: 'property' },
    { code: 'BUSINESS-PUBLIC-LIABILITY', label: 'Public liability', scope: 'POLICY', group: 'liability' },
    { code: 'BUSINESS-EMPLOYERS-LIABILITY', label: 'Employers liability', scope: 'POLICY', group: 'liability' },
    { code: 'BUSINESS-BUSINESS-INTERRUPTION', label: 'Business interruption', scope: 'POLICY', group: 'business-interruption' },
    { code: 'BUSINESS-LEGAL-ASSISTANCE', label: 'Legal assistance', scope: 'POLICY', group: 'extras' },
  ],

  uwConfigSchema: {
    groups: [
      {
        id: 'referral',
        title: 'Manual review',
        fields: [
          { path: 'manualReviewSlaHours', label: 'Manual review SLA hours', type: 'number' },
        ],
      },
    ],
  },

  documentTypes: {
    BUSINESS_QUOTE_REQUEST_PDF: 'Business Quote Request',
    BUSINESS_PROPOSAL_PDF: 'Business Proposal',
  },

  riskModelHints: {
    requiredForUw: [
      { path: 'business.typeOfBusiness', label: 'Type of business' },
      { path: 'business.numberOfEmployees', label: 'Number of employees' },
      { path: 'coverage.publicLiability', label: 'Public liability cover' },
      { path: 'coverage.employersLiability', label: 'Employers liability' },
      { path: 'coverage.businessInterruption', label: 'Business interruption' },
    ],
    referralFlags: [],
    ratingInputs: [
      { path: 'coverage.buildings', label: 'Buildings cover', format: 'currency' },
      { path: 'coverage.stock', label: 'Stock cover', format: 'currency' },
      { path: 'coverage.equipment', label: 'Equipment cover', format: 'currency' },
      { path: 'coverage.publicLiabilityLimit', label: 'Public liability limit', format: 'currency' },
      { path: 'coverage.businessInterruptionLimit', label: 'Business interruption limit', format: 'currency' },
    ],
  },

  rules: { batchRules: { minUnits: 0 } },
  theme: { iconKey: 'briefcase-business', segmentLabel: 'Business' },
};
