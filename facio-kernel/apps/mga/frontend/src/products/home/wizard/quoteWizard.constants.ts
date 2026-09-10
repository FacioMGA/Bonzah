import { REGION_CONFIG } from '@/src/shared/config/region';
import {
  HOME_SOLAR_PANEL_DEFAULT_AMOUNT,
  hasHomeSolarPanelDefault,
} from '@facio/products';

const initialSolarPanelCover = hasHomeSolarPanelDefault(REGION_CONFIG.defaultRegionCode)
  ? HOME_SOLAR_PANEL_DEFAULT_AMOUNT
  : undefined;

export const wizardSteps = [
  'Your details',
  'Your quote',
  'Acceptance',
  'Payment',
];

/**
 * Customer-facing journey stages. The Home flow keeps its individual form
 * step ids below because they own validation, autosave, resume URLs, and the
 * single Security → Quote rating transition. This is only their progress UI
 * projection.
 */
export const homeJourneyStageByStepId: Record<string, number> = {
  'policy-holder': 1,
  property: 1,
  'construction-risk': 1,
  'sums-insured': 1,
  security: 1,
  'your-quote': 2,
  acceptance: 3,
  payment: 4,
  success: 4,
};

/** Short, in-stage labels retained for Home's five information sections. */
export const homeInformationSubsectionByStepId: Record<string, string> = {
  'policy-holder': 'Your details',
  property: 'Property',
  'construction-risk': 'Construction',
  'sums-insured': 'Sums insured',
  security: 'Security',
};

/**
 * The canonical Home manifest keeps "Use of property" as its own section,
 * while the customer journey renders those inputs within Sums insured. This
 * projection preserves the existing internal wizard step ownership when a
 * canonical readiness diagnostic names its manifest section.
 */
export const homeWizardStepIdByManifestSectionId: Readonly<Record<string, string>> = {
  'policy-holder': 'policy-holder',
  property: 'property',
  'construction-risk': 'construction-risk',
  'sums-insured': 'sums-insured',
  use: 'sums-insured',
  security: 'security',
};

export const homeInformationStepIds = [
  'policy-holder',
  'property',
  'construction-risk',
  'sums-insured',
  'security',
];

// Internal step positions are intentionally unchanged: validation profiles,
// autosave payloads and `?step=` resume links use these ids, not the four
// customer-facing journey stages above.
export const stepIdToIndex: Record<string, number> = {
  'policy-holder': 1,
  property: 2,
  'construction-risk': 3,
  'sums-insured': 4,
  security: 5,
  'your-quote': 6,
  acceptance: 7,
  payment: 8,
};

export const indexToStepId: Record<number, string> = {
  1: 'policy-holder',
  2: 'property',
  3: 'construction-risk',
  4: 'sums-insured',
  5: 'security',
  6: 'your-quote',
  7: 'acceptance',
  8: 'payment',
};

export type HomeFormValues = Record<string, unknown>;

export const initialHomeQuoteData: HomeFormValues = {
  proposer: {
    firstName: '', lastName: '', email: '', phone: '', dateOfBirth: '',
    nationality: '',
    domicileCountry: REGION_CONFIG.defaultCountry,
    nif: '',
    address: {
      line1: '', city: '', province: '', postcode: '',
      country: REGION_CONFIG.defaultCountry,
    },
  },
  // ABY-57 (re-open): the customer journey must NOT pre-fill discretionary
  // factual fields (property type / bedrooms / floor area). The previous
  // defaults (`Villa` / 3 / 150) were illegal pre-selections that a Lloyd's
  // coverholder must not present to the proposer because they would auto-
  // accept underwriting facts the customer never confirmed. Only true
  // structural defaults stay (sameAsProposer + country come from region
  // config and are factual scope, not underwriting choices).
  property: {
    sameAsProposer: true,
    address: { line1: '', country: REGION_CONFIG.defaultCountry },
    propertyType: '',
    bedrooms: undefined,
    floorAreaSqm: undefined,
    landAreaSqm: undefined,
    urbanArea: undefined,
    within20MinFireStation: undefined,
    permanentHome: undefined,
    woodenConstruction: undefined,
    nonCombustibleMaterial: undefined,
    alarm: '',
    yearBuilt: '',
  },
  risk: {
    previousClaims: '',
    noClaimsDiscount: '',
    increasedExcess: '',
    proposerOver45: undefined,
  },
  // Required sums start blank so the customer explicitly enters them.
  // Discretionary covers are an explicit no-cover selection at €0: that is
  // the same canonical pricing state already used when an optional cover is
  // absent, but prevents an accidental token amount from creating a referral.
  coverage: {
    buildings: undefined, contents: undefined,
    accidentalDamageBuildings: false, accidentalDamageContents: false,
    allRiskJewellery: 0,
    allRiskOther: 0,
    // ADR-0090 — CY/GR Home quotes start with the mandatory €2,000 solar
    // panel cover. The product rule is also enforced by the runtime and
    // document projection; this is only the customer-facing prefill.
    solarPanelCover: initialSolarPanelCover,
  },
  usage: { permanentHome: undefined, businessUse: undefined, rentedOut: undefined },
  security: {
    doorsFiveLeverLocks: undefined,
    windowsSecured: undefined,
    additionalSecurity: undefined,
    additionalSecurityDescription: '',
  },
  eligibility: { confirmation: false },
  mortgage: { hasMortgage: false, lenderName: '', lenderAddress: '', lenderReference: '' },
  policy: { startDate: '' },
};
