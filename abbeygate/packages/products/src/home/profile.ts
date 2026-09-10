/**
 * Home validation profile — canonical, declarative end-to-end.
 *
 * Every field in the Home wizard has a contract in the shared rule
 * library; the runner (`@facio/validation`) builds the Zod schema per
 * step.
 *
 * Phase 4 (2026-04 consolidation): adopted the FE profile as canonical
 * and deleted `backend/products/home/validation/profile.ts`. The BE
 * mirror had been stripped of the wizard's `security.*`, `usage.*`,
 * `eligibility.confirmation`, and `policy.startDate` fields plus the
 * matching `security` / `acceptance` steps — that left wizard steps
 * 5 (Security) and 7 (Acceptance) silently unvalidated on direct
 * BE-only writes. The FE definition is the complete one and is now
 * shared by both sides via `@facio/products`.
 *
 * Why declarative (unlike Motor): Home was scaffolded with no Zod
 * schema, so there is no `Step1Schema` legacy to preserve. Declarative
 * profiles are the pattern for every new product.
 *
 * Every field belongs to exactly one wizard step. Optional fields omit
 * `required: true`. Cross-field rules (postcode-by-country, sums-
 * insured non-zero, etc.) live in `refinements`.
 */

import type { RefinementFn, ValidationProfile } from '@facio/validation';
import type { RefinementCtx } from 'zod';
import {
  HOME_INCREASED_EXCESS_OPTIONS,
  HOME_NO_CLAIMS_DISCOUNT_LABEL,
  HOME_NO_CLAIMS_DISCOUNT_VALID_OPTIONS,
  HOME_PREVIOUS_CLAIMS_OPTIONS,
  HOME_PROPERTY_TYPE_OPTIONS,
  HOME_YEAR_BUILT_OPTIONS,
  HOME_YES_NO_OPTIONS,
} from './manifest.js';

function oneOf(options: Array<{ value: string }>): string {
  return `oneOf:${options.map((option) => option.value).join('|')}`;
}

function parseDateOnlyLocal(raw: string): Date | null {
  const match = String(raw || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return new Date(year, month - 1, day);
}

type HomeBdxAssertionCarrier = {
  bdxImportAssertions?: {
    profile?: unknown;
  };
};

function hasHistoricalBdxImportAssertion(raw: unknown): boolean {
  const data = raw && typeof raw === 'object' ? (raw as HomeBdxAssertionCarrier) : {};
  const assertion = data.bdxImportAssertions && typeof data.bdxImportAssertions === 'object'
    ? data.bdxImportAssertions
    : {};
  return String(assertion.profile || '').startsWith('BDX_HISTORICAL_HOME_');
}

function requirePolicyStartTodayOrLater(
  data: Parameters<RefinementFn>[0],
  ctx: RefinementCtx,
  extras?: { raw: unknown },
): void {
  if (hasHistoricalBdxImportAssertion(extras?.raw)) return;
  const raw = String(data['policy.startDate'] || '').trim();
  if (!raw) return;
  const selected = parseDateOnlyLocal(raw);
  if (!selected) return;
  selected.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (selected < today) {
    ctx.addIssue({
      code: 'custom',
      path: ['policy.startDate'],
      message: 'Policy start date must be today or later',
    });
  }
}

function requireHomeSumInsured(data: Record<string, unknown>, ctx: RefinementCtx): void {
  const buildings = Number(data['coverage.buildings'] || 0);
  const contents = Number(data['coverage.contents'] || 0);
  if (buildings > 0 || contents > 0) return;
  ctx.addIssue({
    code: 'custom',
    path: ['coverage.buildings'],
    message: 'Missing home buildings or contents sum insured',
  });
}

/**
 * ABY-328 — the declared High Risk Items sum (`coverage.allRiskJewellery`,
 * surfaced in the wizard as "High Risk Items") may not exceed 20% of the
 * total contents sum insured. The coverage fields are not part of the
 * sums-insured step's flat field set, so we read the nested canonical
 * `raw` data (same pattern as {@link hasSpecifiedHighRiskItems}).
 */
const HIGH_RISK_CONTENTS_CAP_RATIO = 0.2;
function requireHighRiskItemsWithinContentsCap(
  _data: Record<string, unknown>,
  ctx: RefinementCtx,
  extras: { raw: unknown },
): void {
  if (hasHistoricalBdxImportAssertion(extras.raw)) return;
  const raw = extras.raw && typeof extras.raw === 'object' ? (extras.raw as Record<string, unknown>) : {};
  const coverage = raw.coverage && typeof raw.coverage === 'object' ? (raw.coverage as Record<string, unknown>) : {};
  const contents = Number(coverage.contents || 0);
  const highRiskItems = Number(coverage.allRiskJewellery || 0);
  if (!(contents > 0) || !(highRiskItems > 0)) return;
  const cap = contents * HIGH_RISK_CONTENTS_CAP_RATIO;
  // Small epsilon so an exact 20% (e.g. 2000 of 10000) is accepted despite
  // float arithmetic.
  if (highRiskItems > cap + 0.005) {
    ctx.addIssue({
      code: 'custom',
      path: ['coverage.allRiskJewellery'],
      message: 'High risk items cannot exceed 20% of the total contents sum insured',
    });
  }
}

function requirePropertyAddressWhenDifferent(data: Record<string, unknown>, ctx: RefinementCtx): void {
  if (data['property.sameAsProposer'] !== false) return;
  for (const [path, label] of [
    ['property.address.line1', 'Property address'],
    ['property.address.city', 'Property city'],
    ['property.address.country', 'Property country'],
  ] as const) {
    if (String(data[path] || '').trim()) continue;
    ctx.addIssue({ code: 'custom', path: [path], message: `${label} is required` });
  }
}

/**
 * The "within 20 minutes of a fire station" question is only shown — and
 * therefore only required — when the property is NOT in an urban area.
 * A non-urban property that is not within 20 minutes of a fire station is
 * referred by `evaluateHomeUw` (REMOTE_NON_URBAN_NO_FIRE_STATION).
 */
function requireFireStationWhenNotUrban(data: Record<string, unknown>, ctx: RefinementCtx): void {
  if (data['property.urbanArea'] !== false) return;
  if (typeof data['property.within20MinFireStation'] === 'boolean') return;
  ctx.addIssue({
    code: 'custom',
    path: ['property.within20MinFireStation'],
    message: 'Confirm whether the property is within 20 minutes of a fire station',
  });
}

/** Apartments have no separately-insured land; all other Home property types do. */
function requireLandAreaUnlessApartment(
  data: Parameters<RefinementFn>[0],
  ctx: RefinementCtx,
): void {
  if (data['property.propertyType'] === 'Apartment') return;
  const value = data['property.landAreaSqm'];
  if (value !== undefined && value !== null && String(value).trim()) return;
  ctx.addIssue({
    code: 'custom',
    path: ['property.landAreaSqm'],
    message: 'Area of land is required unless the property is an apartment',
  });
}

function requireAdditionalSecurityDescription(data: Record<string, unknown>, ctx: RefinementCtx): void {
  if (data['security.additionalSecurity'] !== true) return;
  if (String(data['security.additionalSecurityDescription'] || '').trim()) return;
  ctx.addIssue({
    code: 'custom',
    path: ['security.additionalSecurityDescription'],
    message: 'Describe the other security at the premises',
  });
}

/**
 * Section C — High Risk Items and Personal Effects.
 *
 * "Specified high risk items" are present when the customer enters a
 * positive Specified High Risk Items sum (`coverage.allRiskJewellery`) or
 * itemises any high risk item with a positive value
 * (`coverage.specifiedItems[].sumInsured`). When they are present the
 * Beazley AB106 Safe Conditions clause applies, so the journey must
 * capture whether there is a safe at the premises.
 *
 * Detection reads the nested canonical `raw` data because the coverage
 * fields are not part of the security step's flat field set.
 */
export function hasSpecifiedHighRiskItems(raw: unknown): boolean {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const coverage = data.coverage && typeof data.coverage === 'object' ? (data.coverage as Record<string, unknown>) : {};
  if (Number(coverage.allRiskJewellery || 0) > 0) return true;
  const items = Array.isArray(coverage.specifiedItems) ? coverage.specifiedItems : [];
  return items.some((item) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return Number(row.sumInsured || 0) > 0;
  });
}

function requireSafeConfirmationWhenSpecifiedHighRisk(
  data: Record<string, unknown>,
  ctx: RefinementCtx,
  extras: { raw: unknown },
): void {
  if (!hasSpecifiedHighRiskItems(extras.raw)) return;
  if (typeof data['security.safeOnPremises'] === 'boolean') return;
  ctx.addIssue({
    code: 'custom',
    path: ['security.safeOnPremises'],
    message: 'Specified high risk items require a safe — confirm whether there is a safe at the premises',
  });
}

function requireSafeDescriptionWhenSafe(data: Record<string, unknown>, ctx: RefinementCtx): void {
  if (data['security.safeOnPremises'] !== true) return;
  if (String(data['security.safeDescription'] || '').trim()) return;
  ctx.addIssue({
    code: 'custom',
    path: ['security.safeDescription'],
    message: 'Describe the safe at the premises',
  });
}

function requireMortgageDetails(data: Record<string, unknown>, ctx: RefinementCtx): void {
  if (data['mortgage.hasMortgage'] !== true) return;
  for (const [path, label] of [
    ['mortgage.lenderName', 'Mortgage lender name'],
    ['mortgage.lenderAddress', 'Mortgage lender address'],
  ] as const) {
    if (String(data[path] || '').trim()) continue;
    ctx.addIssue({ code: 'custom', path: [path], message: `${label} is required` });
  }
}

export const homeValidationProfile: ValidationProfile = {
  productCode: 'HOME',
  fields: {
    // Step 1: Policy holder (PolicyHolderStep renders these)
    'proposer.firstName': { path: 'proposer.firstName', rule: 'name', required: true, label: 'First name' },
    'proposer.lastName': { path: 'proposer.lastName', rule: 'name', required: true, label: 'Last name' },
    'proposer.email': { path: 'proposer.email', rule: 'email', required: true, label: 'Email' },
    'proposer.phone': { path: 'proposer.phone', rule: 'phoneE164', required: true, label: 'Phone' },
    'proposer.dateOfBirth': { path: 'proposer.dateOfBirth', rule: 'dob:18-100', required: true, label: 'Date of birth' },
    'proposer.nationality': { path: 'proposer.nationality', rule: 'nationality', required: true, label: 'Nationality' },
    'proposer.domicileCountry': { path: 'proposer.domicileCountry', rule: 'countryName', required: true, label: 'Country of domicile' },
    'proposer.address.line1': { path: 'proposer.address.line1', rule: 'nonEmptyString', required: true, label: 'Address' },
    'proposer.address.city': { path: 'proposer.address.city', rule: 'name', required: true, label: 'City' },
    'proposer.address.country': { path: 'proposer.address.country', rule: 'countryName', required: true, label: 'Country' },
    'proposer.address.postcode': { path: 'proposer.address.postcode', rule: 'nonEmptyString', label: 'Postal code' },
    'proposer.nif': { path: 'proposer.nif', rule: 'nonEmptyString', label: 'NIF / Tax ID' },
    'proposer.marketingConsent': { path: 'proposer.marketingConsent', rule: 'bool', audience: 'customer' },

    // Step 2: Property
    'property.propertyType': { path: 'property.propertyType', rule: oneOf(HOME_PROPERTY_TYPE_OPTIONS), required: true, label: 'Property type' },
    'property.address.line1': { path: 'property.address.line1', rule: 'nonEmptyString', label: 'Property address' },
    'property.address.city': { path: 'property.address.city', rule: 'name', label: 'Property city' },
    'property.address.postcode': { path: 'property.address.postcode', rule: 'nonEmptyString', label: 'Property postal code' },
    'property.address.country': { path: 'property.address.country', rule: 'countryName', label: 'Property country' },
    'property.bedrooms': { path: 'property.bedrooms', rule: 'positiveMoney', required: true, label: 'Bedrooms' },
    'property.floorAreaSqm': { path: 'property.floorAreaSqm', rule: 'positiveMoney', required: true, label: 'Covered area' },
    'property.landAreaSqm': { path: 'property.landAreaSqm', rule: 'nonNegativeMoney', label: 'Area of land' },
    'property.urbanArea': { path: 'property.urbanArea', rule: 'bool', required: true, label: 'Property is in an urban area' },
    // Conditionally required: only asked when the property is NOT in an
    // urban area (enforced by `requireFireStationWhenNotUrban`).
    'property.within20MinFireStation': { path: 'property.within20MinFireStation', rule: 'bool', label: 'Within 20 minutes of a fire station' },
    'property.permanentHome': { path: 'property.permanentHome', rule: 'bool', required: true },
    'property.sameAsProposer': { path: 'property.sameAsProposer', rule: 'bool' },

    // Step 3: Construction & risk
    'property.yearBuilt': { path: 'property.yearBuilt', rule: oneOf(HOME_YEAR_BUILT_OPTIONS), required: true, label: 'Year built' },
    'property.alarm': { path: 'property.alarm', rule: oneOf(HOME_YES_NO_OPTIONS), required: true, label: 'Alarm' },
    'property.woodenConstruction': { path: 'property.woodenConstruction', rule: 'bool', required: true, label: 'Wooden Constructed House' },
    'property.nonCombustibleMaterial': { path: 'property.nonCombustibleMaterial', rule: 'bool', required: true, label: 'Built of non-combustible solid material' },
    'risk.proposerOver45': { path: 'risk.proposerOver45', rule: 'bool', required: true, label: 'Proposer is aged over 45' },
    'risk.previousClaims': { path: 'risk.previousClaims', rule: oneOf(HOME_PREVIOUS_CLAIMS_OPTIONS), required: true, label: 'Previous claims' },
    'risk.noClaimsDiscount': { path: 'risk.noClaimsDiscount', rule: oneOf(HOME_NO_CLAIMS_DISCOUNT_VALID_OPTIONS), required: true, label: HOME_NO_CLAIMS_DISCOUNT_LABEL },
    'risk.increasedExcess': { path: 'risk.increasedExcess', rule: oneOf(HOME_INCREASED_EXCESS_OPTIONS), required: true, label: 'Excess' },

    // Step 4: Sums insured + use of property
    'coverage.buildings': { path: 'coverage.buildings', rule: 'nonNegativeMoney', label: 'Buildings sum insured' },
    'coverage.contents': { path: 'coverage.contents', rule: 'nonNegativeMoney', label: 'Contents sum insured' },
    'usage.permanentHome': { path: 'usage.permanentHome', rule: 'bool', required: true },
    'usage.businessUse': { path: 'usage.businessUse', rule: 'bool', required: true },
    'usage.rentedOut': { path: 'usage.rentedOut', rule: 'bool', required: true },

    // Step 5: Security
    'security.doorsFiveLeverLocks': { path: 'security.doorsFiveLeverLocks', rule: 'bool', required: true, label: 'External doors with key operated locks' },
    'security.windowsSecured': { path: 'security.windowsSecured', rule: 'bool', required: true, label: 'Easily accessible windows and patio doors with interior locks' },
    'security.additionalSecurity': { path: 'security.additionalSecurity', rule: 'bool', required: true },
    'security.additionalSecurityDescription': { path: 'security.additionalSecurityDescription', rule: 'nonEmptyString', label: 'Other security details' },
    // Section C safe — conditionally required when specified high risk items
    // are present (Beazley AB106 Safe Conditions). Requiredness is enforced
    // by `requireSafeConfirmationWhenSpecifiedHighRisk` /
    // `requireSafeDescriptionWhenSafe` rather than a static `required` flag.
    'security.safeOnPremises': { path: 'security.safeOnPremises', rule: 'bool', label: 'Is there a safe at the premises?' },
    'security.safeDescription': { path: 'security.safeDescription', rule: 'nonEmptyString', label: 'Safe details' },

    // Step 7: Acceptance
    'eligibility.confirmation': { path: 'eligibility.confirmation', rule: 'mustAccept', required: true, label: 'I confirm the information is true and accurate' },
    'policy.startDate': { path: 'policy.startDate', rule: 'isoDate', required: true, label: 'Policy start date' },
    'mortgage.hasMortgage': { path: 'mortgage.hasMortgage', rule: 'bool', label: 'Bank or mortgage interest' },
    'mortgage.lenderName': { path: 'mortgage.lenderName', rule: 'nonEmptyString', label: 'Mortgage lender name' },
    'mortgage.lenderAddress': { path: 'mortgage.lenderAddress', rule: 'nonEmptyString', label: 'Mortgage lender address' },
    'mortgage.lenderReference': { path: 'mortgage.lenderReference', rule: 'nonEmptyString', label: 'Bank / mortgage reference' },

    // Step 8: Pay — no form fields (PaymentStep handles it)
  },
  steps: [
    {
      id: 'policy-holder',
      fields: [
        'proposer.firstName',
        'proposer.lastName',
        'proposer.email',
        'proposer.phone',
        'proposer.dateOfBirth',
        'proposer.nationality',
        'proposer.domicileCountry',
        'proposer.address.line1',
        'proposer.address.city',
        'proposer.address.country',
        'proposer.address.postcode',
        'proposer.marketingConsent',
      ],
      refinements: [
        // Postcode format depends on country; enforce it cross-field.
        (data, ctx) => {
          const country = String(data['proposer.address.country'] || '').trim().toLowerCase();
          const postcode = String(data['proposer.address.postcode'] || '').trim();
          if (!postcode) return;
          if (country === 'portugal' && !/^\d{4}-?\d{3}$/.test(postcode)) {
            ctx.addIssue({
              code: 'custom',
              path: ['proposer.address.postcode'],
              message: 'Portugal post code must be in 1234-567 format',
            });
          } else if (country === 'united kingdom' && !/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(postcode)) {
            ctx.addIssue({
              code: 'custom',
              path: ['proposer.address.postcode'],
              message: 'Enter a valid UK post code',
            });
          }
        },
      ],
    },
    {
      id: 'property',
      fields: [
        'property.sameAsProposer',
        'property.propertyType',
        'property.address.line1',
        'property.address.city',
        'property.address.postcode',
        'property.address.country',
        'property.bedrooms',
        'property.floorAreaSqm',
        'property.landAreaSqm',
        'property.urbanArea',
        'property.within20MinFireStation',
        'property.permanentHome',
      ],
      refinements: [requirePropertyAddressWhenDifferent, requireFireStationWhenNotUrban, requireLandAreaUnlessApartment],
    },
    {
      id: 'construction-risk',
      fields: [
        'property.yearBuilt',
        'property.alarm',
        'property.woodenConstruction',
        'property.nonCombustibleMaterial',
        'risk.proposerOver45',
        'risk.previousClaims',
        'risk.noClaimsDiscount',
        'risk.increasedExcess',
      ],
    },
    {
      id: 'sums-insured',
      fields: [
        'coverage.buildings',
        'coverage.contents',
        'coverage.allRiskJewellery',
        'usage.permanentHome',
        'usage.businessUse',
        'usage.rentedOut',
      ],
      refinements: [requireHomeSumInsured, requireHighRiskItemsWithinContentsCap],
    },
    {
      id: 'security',
      fields: [
        'security.doorsFiveLeverLocks',
        'security.windowsSecured',
        'security.additionalSecurity',
        'security.additionalSecurityDescription',
        'security.safeOnPremises',
        'security.safeDescription',
      ],
      refinements: [requireAdditionalSecurityDescription, requireSafeConfirmationWhenSpecifiedHighRisk, requireSafeDescriptionWhenSafe],
    },
    {
      id: 'quote',
      fields: [],
    },
    {
      id: 'acceptance',
      fields: [
        'eligibility.confirmation',
        'policy.startDate',
        'proposer.nif',
        'mortgage.hasMortgage',
        'mortgage.lenderName',
        'mortgage.lenderAddress',
        'mortgage.lenderReference',
      ],
      refinements: [requirePolicyStartTodayOrLater, requireMortgageDetails],
    },
    {
      id: 'pay',
      fields: [],
    },
  ],
  stages: {
    bind: {
      fields: [
        'proposer.firstName',
        'proposer.lastName',
        'proposer.email',
        'proposer.phone',
        'proposer.dateOfBirth',
        'proposer.nationality',
        'proposer.domicileCountry',
        'proposer.address.line1',
        'proposer.address.city',
        'proposer.address.country',
        'property.propertyType',
        'property.sameAsProposer',
        'property.address.line1',
        'property.address.city',
        'property.address.country',
        'property.bedrooms',
        'property.floorAreaSqm',
        'property.landAreaSqm',
        'property.urbanArea',
        'property.within20MinFireStation',
        'property.permanentHome',
        'property.yearBuilt',
        'property.alarm',
        'property.woodenConstruction',
        'property.nonCombustibleMaterial',
        'risk.proposerOver45',
        'risk.previousClaims',
        'risk.noClaimsDiscount',
        'risk.increasedExcess',
        'coverage.buildings',
        'coverage.contents',
        'usage.permanentHome',
        'usage.businessUse',
        'usage.rentedOut',
        'security.doorsFiveLeverLocks',
        'security.windowsSecured',
        'security.additionalSecurity',
        'security.additionalSecurityDescription',
        'security.safeOnPremises',
        'security.safeDescription',
        'eligibility.confirmation',
        'policy.startDate',
        'mortgage.hasMortgage',
        'mortgage.lenderName',
        'mortgage.lenderAddress',
        'mortgage.lenderReference',
      ],
      refinements: [requirePropertyAddressWhenDifferent, requireFireStationWhenNotUrban, requireLandAreaUnlessApartment, requireHomeSumInsured, requireHighRiskItemsWithinContentsCap, requireAdditionalSecurityDescription, requireSafeConfirmationWhenSpecifiedHighRisk, requireSafeDescriptionWhenSafe, requirePolicyStartTodayOrLater, requireMortgageDetails],
    },
    issuance: {
      fields: [
        'proposer.firstName',
        'proposer.lastName',
        'proposer.email',
        'proposer.phone',
        'proposer.dateOfBirth',
        'proposer.nationality',
        'proposer.domicileCountry',
        'proposer.address.line1',
        'proposer.address.city',
        'proposer.address.country',
        'property.propertyType',
        'property.sameAsProposer',
        'property.address.line1',
        'property.address.city',
        'property.address.country',
        'property.bedrooms',
        'property.floorAreaSqm',
        'property.landAreaSqm',
        'property.urbanArea',
        'property.within20MinFireStation',
        'property.permanentHome',
        'property.yearBuilt',
        'property.alarm',
        'property.woodenConstruction',
        'property.nonCombustibleMaterial',
        'risk.proposerOver45',
        'risk.previousClaims',
        'risk.noClaimsDiscount',
        'risk.increasedExcess',
        'coverage.buildings',
        'coverage.contents',
        'usage.permanentHome',
        'usage.businessUse',
        'usage.rentedOut',
        'security.doorsFiveLeverLocks',
        'security.windowsSecured',
        'security.additionalSecurity',
        'security.additionalSecurityDescription',
        'security.safeOnPremises',
        'security.safeDescription',
        'eligibility.confirmation',
        'policy.startDate',
        'mortgage.hasMortgage',
        'mortgage.lenderName',
        'mortgage.lenderAddress',
        'mortgage.lenderReference',
      ],
      refinements: [requirePropertyAddressWhenDifferent, requireFireStationWhenNotUrban, requireLandAreaUnlessApartment, requireHomeSumInsured, requireHighRiskItemsWithinContentsCap, requireAdditionalSecurityDescription, requireSafeConfirmationWhenSpecifiedHighRisk, requireSafeDescriptionWhenSafe, requirePolicyStartTodayOrLater, requireMortgageDetails],
    },
  },
};
