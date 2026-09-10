import type { ValidationProfile } from '@facio/validation';
import type { RefinementCtx } from 'zod';
import {
  BUSINESS_COVER_TIMING_OPTIONS,
  BUSINESS_FIRE_RESPONSE_OPTIONS,
  BUSINESS_HEAR_ABOUT_OPTIONS,
  BUSINESS_NATIONALITY_OPTIONS,
  BUSINESS_PREMISES_STATUS_OPTIONS,
  BUSINESS_THEFT_PREVENTION_OPTIONS,
  BUSINESS_YES_NO_OPTIONS,
} from './manifest.js';

function oneOf(options: Array<{ value: string }>): string {
  return `oneOf:${options.map((option) => option.value).join('|')}`;
}

function requireOtherDescription(data: Record<string, unknown>, ctx: RefinementCtx, selectorPath: string, detailPath: string, label: string): void {
  if (String(data[selectorPath] || '') !== 'other') return;
  if (String(data[detailPath] || '').trim()) return;
  ctx.addIssue({ code: 'custom', path: [detailPath], message: `${label} is required when Other is selected` });
}

function requireAtLeastOneCommercialCover(data: Record<string, unknown>, ctx: RefinementCtx): void {
  const amountPaths = ['coverage.buildings', 'coverage.stock', 'coverage.equipment', 'coverage.businessInterruptionLimit'];
  const hasAmount = amountPaths.some((path) => Number(data[path] || 0) > 0);
  const hasSelected = ['coverage.publicLiability', 'coverage.employersLiability', 'coverage.businessInterruption', 'coverage.legalAssistance']
    .some((path) => String(data[path] || '') === 'yes');
  if (hasAmount || hasSelected) return;
  ctx.addIssue({
    code: 'custom',
    path: ['coverage.buildings'],
    message: 'Select at least one business cover or enter a cover amount',
  });
}

export const businessValidationProfile: ValidationProfile = {
  productCode: 'BUSINESS',
  fields: {
    'proposer.firstName': { path: 'proposer.firstName', rule: 'name', required: true, label: 'First name' },
    'proposer.lastName': { path: 'proposer.lastName', rule: 'name', required: true, label: 'Last name' },
    'proposer.dateOfBirth': { path: 'proposer.dateOfBirth', rule: 'isoDate', label: 'Date of birth' },
    'proposer.email': { path: 'proposer.email', rule: 'email', required: true, label: 'Email address' },
    'proposer.phone': { path: 'proposer.phone', rule: 'phoneE164', required: true, label: 'Telephone' },
    'proposer.nationality': { path: 'proposer.nationality', rule: oneOf(BUSINESS_NATIONALITY_OPTIONS), label: 'Nationality' },
    'proposer.idNumber': { path: 'proposer.idNumber', rule: 'nonEmptyString', label: 'Resident ID or passport number' },
    'proposer.occupation': { path: 'proposer.occupation', rule: 'nonEmptyString', label: 'Occupation' },
    'proposer.address.line1': { path: 'proposer.address.line1', rule: 'nonEmptyString', required: true, label: 'Address' },
    'proposer.address.city': { path: 'proposer.address.city', rule: 'name', required: true, label: 'City' },
    'proposer.address.province': { path: 'proposer.address.province', rule: 'nonEmptyString', label: 'Province' },
    'proposer.address.postcode': { path: 'proposer.address.postcode', rule: 'nonEmptyString', label: 'Post code' },
    'proposer.address.country': { path: 'proposer.address.country', rule: 'countryName', required: true, label: 'Country' },
    'proposer.hearAboutUs': { path: 'proposer.hearAboutUs', rule: oneOf(BUSINESS_HEAR_ABOUT_OPTIONS), label: 'Where did you hear about us?' },
    'proposer.marketingConsent': { path: 'proposer.marketingConsent', rule: 'bool', audience: 'customer', label: 'Marketing consent' },

    'business.typeOfBusiness': { path: 'business.typeOfBusiness', rule: 'nonEmptyString', required: true, label: 'Type of business' },
    'business.numberOfEmployees': { path: 'business.numberOfEmployees', rule: 'nonNegativeMoney', required: true, label: 'Number of employees' },
    'business.yearPremisesConstructed': { path: 'business.yearPremisesConstructed', rule: 'nonNegativeMoney', label: 'Year premises constructed' },
    'business.sizeOfPremisesSqm': { path: 'business.sizeOfPremisesSqm', rule: 'nonNegativeMoney', label: 'Size of premises' },
    'business.coverTiming': { path: 'business.coverTiming', rule: oneOf(BUSINESS_COVER_TIMING_OPTIONS), required: true, label: 'When do you require cover?' },
    'business.registeredForTax': { path: 'business.registeredForTax', rule: oneOf(BUSINESS_YES_NO_OPTIONS), label: 'Registered for tax' },
    'business.premisesStatus': { path: 'business.premisesStatus', rule: oneOf(BUSINESS_PREMISES_STATUS_OPTIONS), label: 'Premises status' },

    'coverage.buildings': { path: 'coverage.buildings', rule: 'nonNegativeMoney', label: 'Buildings cover' },
    'coverage.stock': { path: 'coverage.stock', rule: 'nonNegativeMoney', label: 'Stock cover' },
    'coverage.equipment': { path: 'coverage.equipment', rule: 'nonNegativeMoney', label: 'Equipment cover' },
    'coverage.publicLiability': { path: 'coverage.publicLiability', rule: oneOf(BUSINESS_YES_NO_OPTIONS), required: true, label: 'Public liability cover' },
    'coverage.publicLiabilityLimit': { path: 'coverage.publicLiabilityLimit', rule: 'nonNegativeMoney', label: 'Public liability limit' },
    'coverage.employersLiability': { path: 'coverage.employersLiability', rule: oneOf(BUSINESS_YES_NO_OPTIONS), required: true, label: 'Employers liability' },
    'coverage.employersLiabilityLimit': { path: 'coverage.employersLiabilityLimit', rule: 'nonNegativeMoney', label: 'Employers liability limit' },
    'coverage.businessInterruption': { path: 'coverage.businessInterruption', rule: oneOf(BUSINESS_YES_NO_OPTIONS), required: true, label: 'Business interruption' },
    'coverage.businessInterruptionLimit': { path: 'coverage.businessInterruptionLimit', rule: 'nonNegativeMoney', label: 'Business interruption limit' },
    'coverage.businessInterruptionIndemnityMonths': { path: 'coverage.businessInterruptionIndemnityMonths', rule: 'nonNegativeMoney', label: 'Business interruption indemnity period' },
    'coverage.legalAssistance': { path: 'coverage.legalAssistance', rule: oneOf(BUSINESS_YES_NO_OPTIONS), required: true, label: 'Legal assistance' },

    'security.rejasOnWindowsAndDoors': { path: 'security.rejasOnWindowsAndDoors', rule: oneOf(BUSINESS_YES_NO_OPTIONS), required: true, label: 'Rejas on windows and doors' },
    'security.alarm': { path: 'security.alarm', rule: oneOf(BUSINESS_YES_NO_OPTIONS), required: true, label: 'Alarm' },
    'security.fireResponseEquipment': { path: 'security.fireResponseEquipment', rule: oneOf(BUSINESS_FIRE_RESPONSE_OPTIONS), required: true, label: 'Fire response equipment' },
    'security.fireResponseEquipmentOther': { path: 'security.fireResponseEquipmentOther', rule: 'nonEmptyString', label: 'Other fire response equipment' },
    'security.mainDoor': { path: 'security.mainDoor', rule: oneOf(BUSINESS_THEFT_PREVENTION_OPTIONS), required: true, label: 'Main door' },
    'security.mainDoorOther': { path: 'security.mainDoorOther', rule: 'nonEmptyString', label: 'Other main door' },
    'security.secondDoor': { path: 'security.secondDoor', rule: oneOf(BUSINESS_THEFT_PREVENTION_OPTIONS), label: 'Second door' },
    'security.secondDoorOther': { path: 'security.secondDoorOther', rule: 'nonEmptyString', label: 'Other second door' },
    'security.windows': { path: 'security.windows', rule: oneOf(BUSINESS_THEFT_PREVENTION_OPTIONS), required: true, label: 'Windows' },
    'security.windowsOther': { path: 'security.windowsOther', rule: 'nonEmptyString', label: 'Other windows' },
    'security.shopWindow': { path: 'security.shopWindow', rule: oneOf(BUSINESS_THEFT_PREVENTION_OPTIONS), label: 'Shop window' },
    'security.shopWindowOther': { path: 'security.shopWindowOther', rule: 'nonEmptyString', label: 'Other shop window' },

    'declarations.informationAccurate': { path: 'declarations.informationAccurate', rule: 'mustAccept', required: true, label: 'Information accuracy declaration' },
  },
  steps: [
    {
      id: 'proposer',
      fields: [
        'proposer.firstName',
        'proposer.lastName',
        'proposer.dateOfBirth',
        'proposer.email',
        'proposer.phone',
        'proposer.nationality',
        'proposer.idNumber',
        'proposer.occupation',
        'proposer.address.line1',
        'proposer.address.city',
        'proposer.address.province',
        'proposer.address.postcode',
        'proposer.address.country',
        'proposer.hearAboutUs',
        'proposer.marketingConsent',
      ],
    },
    {
      id: 'business-details',
      fields: [
        'business.typeOfBusiness',
        'business.numberOfEmployees',
        'business.yearPremisesConstructed',
        'business.sizeOfPremisesSqm',
        'business.coverTiming',
        'business.registeredForTax',
        'business.premisesStatus',
        'coverage.buildings',
        'coverage.stock',
        'coverage.equipment',
        'coverage.publicLiability',
        'coverage.publicLiabilityLimit',
        'coverage.employersLiability',
        'coverage.employersLiabilityLimit',
        'coverage.businessInterruption',
        'coverage.businessInterruptionLimit',
        'coverage.businessInterruptionIndemnityMonths',
        'coverage.legalAssistance',
        'security.rejasOnWindowsAndDoors',
        'security.alarm',
        'security.fireResponseEquipment',
        'security.fireResponseEquipmentOther',
        'security.mainDoor',
        'security.mainDoorOther',
        'security.secondDoor',
        'security.secondDoorOther',
        'security.windows',
        'security.windowsOther',
        'security.shopWindow',
        'security.shopWindowOther',
      ],
      refinements: [
        requireAtLeastOneCommercialCover,
        (data, ctx) => {
          requireOtherDescription(data, ctx, 'security.fireResponseEquipment', 'security.fireResponseEquipmentOther', 'Fire response details');
          requireOtherDescription(data, ctx, 'security.mainDoor', 'security.mainDoorOther', 'Main door details');
          requireOtherDescription(data, ctx, 'security.secondDoor', 'security.secondDoorOther', 'Second door details');
          requireOtherDescription(data, ctx, 'security.windows', 'security.windowsOther', 'Window details');
          requireOtherDescription(data, ctx, 'security.shopWindow', 'security.shopWindowOther', 'Shop window details');
        },
      ],
    },
    {
      id: 'review-submit',
      fields: ['declarations.informationAccurate'],
    },
  ],
  stages: {
    bind: {
      fields: [
        'proposer.firstName',
        'proposer.lastName',
        'proposer.email',
        'proposer.phone',
        'proposer.address.line1',
        'proposer.address.city',
        'proposer.address.country',
        'business.typeOfBusiness',
        'business.numberOfEmployees',
        'business.coverTiming',
        'coverage.publicLiability',
        'coverage.employersLiability',
        'coverage.businessInterruption',
        'coverage.legalAssistance',
        'security.rejasOnWindowsAndDoors',
        'security.alarm',
        'security.fireResponseEquipment',
        'security.mainDoor',
        'security.windows',
        'declarations.informationAccurate',
      ],
    },
    issuance: {
      fields: [
        'proposer.firstName',
        'proposer.lastName',
        'proposer.email',
        'proposer.phone',
        'business.typeOfBusiness',
        'declarations.informationAccurate',
      ],
    },
  },
};

export type _BusinessValidationRefinementCtx = RefinementCtx;
