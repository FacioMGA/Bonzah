import type { ProductManifest, SelectOption } from '../types.js';

export const HOME_PROPERTY_TYPE_OPTIONS: SelectOption[] = [
  { value: 'Villa', label: 'Villa' },
  { value: 'Townhouse', label: 'Townhouse' },
  { value: 'Apartment', label: 'Apartment' },
  { value: 'Static Caravan', label: 'Static Caravan' },
];
export const HOME_YES_NO_OPTIONS: SelectOption[] = [
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
];
export const HOME_YEAR_BUILT_OPTIONS: SelectOption[] = [
  { value: 'Prior to 1980', label: 'Prior to 1980' },
  { value: '1980 to 1989', label: '1980 to 1989' },
  { value: '1990 or Later', label: '1990 or Later' },
];
export const HOME_PREVIOUS_CLAIMS_OPTIONS: SelectOption[] = [
  { value: 'None', label: 'None' },
  { value: '1 claim < 1000', label: '1 claim under €1,000' },
  { value: '2 claims < 3000', label: '2 claims under €3,000' },
  { value: '3 claims or > 3000', label: '3+ claims or over €3,000' },
];
/** ABY-487 — customer-facing label for the construction-risk NCD field. */
export const HOME_NO_CLAIMS_DISCOUNT_LABEL = 'Years claim free (up to a maximum of 4)';

export const HOME_NO_CLAIMS_DISCOUNT_OPTIONS: SelectOption[] = [
  { value: '0 Years', label: '0 years claim free' },
  { value: '1 Year', label: '1 year claim free' },
  { value: '2 Years', label: '2 years claim free' },
  { value: '3 Years', label: '3 years claim free' },
  { value: '4 Years', label: '4 years claim free' },
];

/** Legacy quotes may still carry 5+ Years; pricing treats it the same as 4 Years. */
export const HOME_NO_CLAIMS_DISCOUNT_LEGACY_VALUE = '5+ Years';

export const HOME_NO_CLAIMS_DISCOUNT_VALID_OPTIONS: SelectOption[] = [
  ...HOME_NO_CLAIMS_DISCOUNT_OPTIONS,
  { value: HOME_NO_CLAIMS_DISCOUNT_LEGACY_VALUE, label: '5+ years claim free' },
];
export const HOME_INCREASED_EXCESS_OPTIONS: SelectOption[] = [
  { value: 'STD 150 XS', label: 'Standard €150' },
  { value: '350 XS', label: '€350 (5% discount)' },
  { value: '750 XS', label: '€750 (10% discount)' },
];

function parseIsoDateOnly(value: unknown): Date | null {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatIsoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildHomePolicyStartDate(data: Record<string, unknown>): string | null {
  const policy = data.policy && typeof data.policy === 'object'
    ? data.policy as Record<string, unknown>
    : {};
  return parseIsoDateOnly(policy.startDate) ? String(policy.startDate) : null;
}

function buildHomePolicyEndDate(data: Record<string, unknown>): string | null {
  const start = parseIsoDateOnly(buildHomePolicyStartDate(data));
  if (!start) return null;
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  return formatIsoDateOnly(end);
}

/**
 * Home Product Manifest — single source of truth.
 *
 * Phase 4 (2026-04 consolidation): adopted the BE manifest as canonical
 * (it carried the more complete `min`/`max` constraints and option
 * lists) and deleted `frontend/src/products/home/manifest.ts`. Both
 * sides now consume this manifest from `@facio/products`.
 *
 * Derived from:
 *   - Abbeygate Home Questionnaire DOCX (field schema)
 *   - Helvetia/Beazley rating guide (rates + UW rules)
 *   - BeazleyHome IPID + sample schedule PDFs (cover content)
 */
export const homeManifest: ProductManifest = {
  productType: 'HOME',
  displayName: 'Home Insurance',

  // `insuredObject.fields` declares the property *identity* (address)
  // only. Property *characteristics* (type, bedrooms, area, year, alarm,
  // construction) live in `questionnaire.sections.*.fields` and are read
  // off the same `quoteData.property.*` paths. The dual declaration that
  // existed pre-`spine/v2` was a single-source violation: the same field
  // appeared in both lists with diverging `min`/`max`/`required` over
  // time. The questionnaire is now the canonical definition for those
  // characteristics.
  insuredObject: {
    kind: 'property',
    cardinality: 'one',
    label: { singular: 'Property', plural: 'Properties' },
    fields: [
      { path: 'property.address.line1', label: 'Address', type: 'text', required: true },
      { path: 'property.address.city', label: 'City', type: 'text', required: true },
      { path: 'property.address.province', label: 'Province/Region', type: 'text' },
      { path: 'property.address.postcode', label: 'Postal code', type: 'text' },
      { path: 'property.address.country', label: 'Country', type: 'text', required: true },
    ],
  },

  questionnaire: {
    sections: [
      {
        id: 'policy-holder', title: 'Policy holder', order: 1,
        fields: [
          { path: 'proposer.firstName', label: 'First name', type: 'text', required: true },
          { path: 'proposer.lastName', label: 'Last name', type: 'text', required: true },
          { path: 'proposer.email', label: 'Email', type: 'text', required: true },
          { path: 'proposer.phone', label: 'Phone', type: 'text', required: true },
          { path: 'proposer.address.line1', label: 'Address', type: 'text', required: true },
          { path: 'proposer.address.city', label: 'City', type: 'text', required: true },
          { path: 'proposer.address.postcode', label: 'Postal code', type: 'text' },
          { path: 'proposer.address.country', label: 'Country', type: 'select', searchable: true, required: true },
          { path: 'proposer.dateOfBirth', label: 'Date of birth', type: 'date', required: true },
          { path: 'proposer.nationality', label: 'Nationality', type: 'select', searchable: true, required: true },
          { path: 'proposer.domicileCountry', label: 'Country of domicile', type: 'select', searchable: true, required: true },
          { path: 'proposer.marketingConsent', label: 'Marketing consent', type: 'boolean' },
        ],
      },
      {
        id: 'property', title: 'Property', order: 2,
        fields: [
          { path: 'property.sameAsProposer', label: 'Same address as proposer', type: 'boolean' },
          { path: 'property.propertyType', label: 'Property type', type: 'select', required: true,
            options: HOME_PROPERTY_TYPE_OPTIONS },
          { path: 'property.address.line1', label: 'Property address', type: 'text', requiredWhenKey: 'property.sameAsProposer', requiredWhenValue: false, visibleWhenKey: 'property.sameAsProposer', visibleWhenValue: false },
          { path: 'property.address.city', label: 'Property city', type: 'text', requiredWhenKey: 'property.sameAsProposer', requiredWhenValue: false, visibleWhenKey: 'property.sameAsProposer', visibleWhenValue: false },
          { path: 'property.address.postcode', label: 'Property postal code', type: 'text', visibleWhenKey: 'property.sameAsProposer', visibleWhenValue: false },
          { path: 'property.address.country', label: 'Property country', type: 'select', searchable: true, requiredWhenKey: 'property.sameAsProposer', requiredWhenValue: false, visibleWhenKey: 'property.sameAsProposer', visibleWhenValue: false },
          { path: 'property.bedrooms', label: 'Bedrooms', type: 'number', required: true, min: 1, max: 20 },
          { path: 'property.floorAreaSqm', label: 'Covered area (sqm)', type: 'number', required: true, min: 10 },
          { path: 'property.landAreaSqm', label: 'Area of land (sqm)', type: 'number', min: 0 },
          { path: 'property.urbanArea', label: 'Is the property in an urban area?', type: 'boolean', required: true },
          { path: 'property.within20MinFireStation', label: 'Is the property within 20 minutes of a fire station?', type: 'boolean', requiredWhenKey: 'property.urbanArea', requiredWhenValue: false, visibleWhenKey: 'property.urbanArea', visibleWhenValue: false },
          { path: 'property.permanentHome', label: 'Permanent home', type: 'boolean', required: true },
        ],
      },
      {
        id: 'construction-risk', title: 'Construction & Risk', order: 3,
        fields: [
          { path: 'property.woodenConstruction', label: 'Wooden Constructed House', type: 'boolean', required: true },
          { path: 'property.nonCombustibleMaterial', label: 'Built of non-combustible solid material', type: 'boolean', required: true },
          { path: 'property.alarm', label: 'Alarm installed', type: 'select', required: true,
            options: HOME_YES_NO_OPTIONS },
          { path: 'property.yearBuilt', label: 'Year built', type: 'select', required: true,
            options: HOME_YEAR_BUILT_OPTIONS },
          { path: 'risk.previousClaims', label: 'Previous claims', type: 'select', required: true,
            options: HOME_PREVIOUS_CLAIMS_OPTIONS },
          { path: 'risk.noClaimsDiscount', label: HOME_NO_CLAIMS_DISCOUNT_LABEL, type: 'select', required: true,
            options: HOME_NO_CLAIMS_DISCOUNT_OPTIONS },
          { path: 'risk.increasedExcess', label: 'Excess', type: 'select', required: true,
            options: HOME_INCREASED_EXCESS_OPTIONS },
          { path: 'risk.proposerOver45', label: 'Proposer is aged over 45', type: 'boolean', required: true },
        ],
      },
      {
        id: 'sums-insured', title: 'Sums Insured', order: 4,
        fields: [
          { path: 'coverage.buildings', label: 'Buildings sum insured', type: 'currency', min: 0 },
          { path: 'coverage.contents', label: 'Contents sum insured', type: 'currency', min: 0 },
          { path: 'coverage.accidentalDamageBuildings', label: 'Accidental damage (buildings)', type: 'boolean', visibleWhenKey: 'usage.permanentHome', visibleWhenValue: true },
          { path: 'coverage.accidentalDamageContents', label: 'Accidental damage (contents)', type: 'boolean', visibleWhenKey: 'usage.permanentHome', visibleWhenValue: true },
          { path: 'coverage.allRiskJewellery', label: 'High Risk Items (e.g., jewellery, watches, electronic devices, etc.)', type: 'currency', visibleWhenKey: 'usage.permanentHome', visibleWhenValue: true },
          { path: 'coverage.allRiskOther', label: 'All Risks Unspecified', type: 'currency', visibleWhenKey: 'usage.permanentHome', visibleWhenValue: true },
          { path: 'coverage.solarPanelCover', label: 'Solar panel cover', type: 'currency' },
        ],
      },
      {
        id: 'use', title: 'Use of property', order: 5,
        fields: [
          { path: 'usage.permanentHome', label: 'Permanent Home', type: 'boolean', required: true },
          { path: 'usage.businessUse', label: 'Used for any business, trade or professional purpose', type: 'boolean', required: true },
          { path: 'usage.rentedOut', label: 'Rented out or sub-let', type: 'boolean', required: true },
        ],
      },
      {
        id: 'security', title: 'Security', order: 6,
        fields: [
          { path: 'security.doorsFiveLeverLocks', label: 'Are all external doors fitted with key operated locks (standard or local equivalent)?', type: 'boolean', required: true },
          { path: 'security.windowsSecured', label: 'Are all easily accessible windows and patio doors fitted with interior locks?', type: 'boolean', required: true },
          { path: 'security.additionalSecurity', label: 'Is there other security at the premises?', type: 'boolean', required: true },
          { path: 'security.additionalSecurityDescription', label: 'Other security details', type: 'text', visibleWhenKey: 'security.additionalSecurity', visibleWhenValue: true },
          { path: 'security.safeOnPremises', label: 'Is there a safe at the premises?', type: 'boolean' },
          { path: 'security.safeDescription', label: 'Safe details', type: 'text', visibleWhenKey: 'security.safeOnPremises', visibleWhenValue: true },
        ],
      },
      {
        id: 'acceptance', title: 'Acceptance', order: 7,
        fields: [
          { path: 'eligibility.confirmation', label: 'I confirm the information is true and accurate', type: 'boolean', required: true },
          { path: 'policy.startDate', label: 'Policy start date', type: 'date', required: true },
          { path: 'proposer.nif', label: 'NIF / Tax ID', type: 'text' },
          { path: 'mortgage.hasMortgage', label: 'Bank / mortgage interest', type: 'boolean' },
          { path: 'mortgage.lenderName', label: 'Mortgage lender name', type: 'text', visibleWhenKey: 'mortgage.hasMortgage', visibleWhenValue: true },
          { path: 'mortgage.lenderAddress', label: 'Mortgage lender address', type: 'textarea', visibleWhenKey: 'mortgage.hasMortgage', visibleWhenValue: true },
          { path: 'mortgage.lenderReference', label: 'Bank / mortgage reference', type: 'text', visibleWhenKey: 'mortgage.hasMortgage', visibleWhenValue: true },
        ],
      },
    ],
  },

  summaryFields: {
    titlePaths: ['property.address.line1', 'property.propertyType'],
    subtitlePaths: ['property.bedrooms', 'property.floorAreaSqm', 'property.yearBuilt'],
    insuredValuePath: 'coverage.buildings',
    // ABY-101 — Policy detail header was rendering only "Villa"
    // because `titlePaths` joined `property.address.line1` (often
    // unset until the customer types it) with `property.propertyType`,
    // and `buildRiskIdentityFromManifest` falls back to the LAST
    // non-empty value when only one is present. The agreed copy on
    // the policy detail header is "[N]-bedroom [type] in [city]"
    // (e.g. "3-bedroom Villa in Paphos"). `buildTitle` takes
    // precedence over `titlePaths` (see `buildRiskIdentityFromManifest`)
    // so this single change updates the policy detail header, the
    // BO list `insured` column, and any consumer that walks the
    // manifest summary contract.
    buildTitle: (data) => {
      const property = (data && typeof data === 'object' && 'property' in data && data.property && typeof data.property === 'object')
        ? data.property as Record<string, unknown>
        : {};
      const address = (property.address && typeof property.address === 'object')
        ? property.address as Record<string, unknown>
        : {};
      const bedroomsRaw = Number(property.bedrooms);
      const bedrooms = Number.isFinite(bedroomsRaw) && bedroomsRaw > 0 ? bedroomsRaw : null;
      const propertyType = String(property.propertyType || '').trim();
      const city = String(address.city || '').trim();

      const head = bedrooms && propertyType
        ? `${bedrooms}-bedroom ${propertyType}`
        : propertyType
          ? propertyType
          : bedrooms
            ? `${bedrooms}-bedroom property`
            : '';
      if (head && city) return `${head} in ${city}`;
      if (head) return head;
      if (city) return `Property in ${city}`;
      return '';
    },
  },

  listColumns: {
    insured: {
      primaryPaths: [],
      secondaryPaths: [],
      buildPrimary: (data) => {
        const property = (data.property && typeof data.property === 'object')
          ? data.property as Record<string, unknown>
          : {};
        const bedrooms = Number(property.bedrooms);
        const propertyType = String(property.propertyType || '').trim();
        if (Number.isFinite(bedrooms) && bedrooms > 0 && propertyType) return `${bedrooms}-Bed ${propertyType}`;
        return propertyType || 'Home';
      },
      buildSecondary: (data) => {
        const property = (data.property && typeof data.property === 'object')
          ? data.property as Record<string, unknown>
          : {};
        const address = (property.address && typeof property.address === 'object')
          ? property.address as Record<string, unknown>
          : {};
        const city = String(address.city || '').trim();
        const floorArea = Number(property.floorAreaSqm);
        const area = Number.isFinite(floorArea) && floorArea > 0 ? `${Math.round(floorArea)}m²` : '';
        return [city, area].filter(Boolean).join(' · ') || null;
      },
    },
    coverage: {
      primaryPaths: [],
      buildStartDate: buildHomePolicyStartDate,
      buildEndDate: buildHomePolicyEndDate,
      buildPrimary: (data) => {
        const cov = (data.coverage && typeof data.coverage === 'object')
          ? data.coverage as Record<string, unknown>
          : {};
        const hasBuildings = Number(cov.buildings || 0) > 0;
        const hasContents = Number(cov.contents || 0) > 0;
        if (hasBuildings && hasContents) return 'Buildings + Contents';
        if (hasBuildings) return 'Buildings only';
        if (hasContents) return 'Contents only';
        return 'Home insurance';
      },
      buildSecondary: (data) => {
        const cov = (data.coverage && typeof data.coverage === 'object')
          ? data.coverage as Record<string, unknown>
          : {};
        const format = (value: unknown) => {
          const amount = Number(value);
          if (!Number.isFinite(amount) || amount <= 0) return null;
          return `€${Math.round(amount).toLocaleString()}`;
        };
        return [format(cov.buildings), format(cov.contents)].filter(Boolean).join(' + ') || null;
      },
    },
  },

  coverageCatalog: [
    { code: 'HOME-ACCIDENTAL-DAMAGE-BUILDINGS', label: 'Accidental damage to buildings', scope: 'POLICY', group: 'extras' },
    { code: 'HOME-ACCIDENTAL-DAMAGE-CONTENTS', label: 'Accidental damage to contents', scope: 'POLICY', group: 'extras' },
    { code: 'HOME-ALL-RISKS-UNSPECIFIED', label: 'All Risks Unspecified', scope: 'POLICY', group: 'extras' },
    { code: 'HOME-ALL-RISKS-JEWELLERY', label: 'High Risk Items', scope: 'POLICY', group: 'extras' },
    { code: 'HOME-SOLAR-PANELS', label: 'Solar panel cover', scope: 'POLICY', group: 'extras' },
    { code: 'HOME-PEDAL-CYCLES', label: 'Pedal cycles', scope: 'RISK_OBJECT', group: 'extras' },
    { code: 'HOME-LIABILITY', label: 'Public liability (included)', scope: 'POLICY', group: 'core', required: true },
  ],

  uwConfigSchema: {
    groups: [
      {
        id: 'property-caps',
        title: 'Property caps',
        fields: [
          { path: 'maxBuildingsSumInsured', label: 'Max buildings sum insured', type: 'currency' },
          { path: 'maxContentsSumInsured', label: 'Max contents sum insured', type: 'currency' },
          { path: 'maxAllRisksUnspecifiedSumInsured', label: 'Max All Risks Unspecified sum insured', type: 'currency' },
          { path: 'maxSolarPanelsSumInsured', label: 'Max solar panels sum insured', type: 'currency' },
          { path: 'allowedPropertyTypes', label: 'Allowed property types', type: 'text', description: 'Comma-separated' },
        ],
      },
      {
        id: 'risk-rules',
        title: 'Risk rules',
        fields: [
          { path: 'declineClaimsCountOver', label: 'Decline if claims count over', type: 'number' },
          { path: 'referClaimsCountAtLeast', label: 'Refer if claims count at least', type: 'number' },
          { path: 'combustibleConstructionRefer', label: 'Refer combustible wooden construction', type: 'boolean' },
        ],
      },
      {
        id: 'geography',
        title: 'Geography',
        fields: [
          { path: 'allowedRiskCountries', label: 'Allowed risk countries', type: 'text', description: 'Comma-separated' },
          { path: 'greekPostcodeDecline', label: 'Greek postcodes to decline', type: 'text', description: 'Comma-separated' },
        ],
      },
    ],
  },

  documentTypes: {
    // Home product issues a single combined Policy Schedule whose first page
    // is the Lloyd's policy jacket — no separate "Certificate" document is
    // produced (would duplicate the cover already inside the schedule).
    HOME_SCHEDULE_PDF: 'Policy Schedule',
    HOME_STATEMENT_OF_FACT_PDF: 'Statement of Fact',
    HOME_IPID_PDF: 'Insurance Product Information Document',
    HOME_POLICY_WORDING_PDF: 'Policy Wording',
    HOME_EUROP_ASSISTANCE_PDF: 'Europ Assistance Information',
    HOME_ENDORSEMENT_SCHEDULE_PDF: 'Endorsement Schedule',
  },

  riskModelHints: {
    requiredForUw: [
      { path: 'proposer.firstName', label: 'First name' },
      { path: 'proposer.lastName', label: 'Last name' },
      { path: 'proposer.email', label: 'Email' },
      { path: 'proposer.dateOfBirth', label: 'Date of birth' },
      { path: 'property.address.country', label: 'Property country' },
      { path: 'property.propertyType', label: 'Property type' },
      { path: 'property.yearBuilt', label: 'Year built' },
      { path: 'property.woodenConstruction', label: 'Construction material' },
      { path: 'coverage.buildings', label: 'Buildings sum insured' },
      { path: 'coverage.contents', label: 'Contents sum insured' },
    ],
    referralFlags: [
      { path: 'property.woodenConstruction', label: 'Combustible construction', points: -20, reason: 'Subject to referral and acceptance' },
    ],
    ratingInputs: [
      { path: 'property.propertyType', label: 'Property type', format: 'text' },
      { path: 'coverage.buildings', label: 'Buildings SI', format: 'currency' },
      { path: 'coverage.contents', label: 'Contents SI', format: 'currency' },
      { path: 'property.yearBuilt', label: 'Year built', format: 'text' },
      { path: 'property.alarm', label: 'Alarm', format: 'text' },
      { path: 'risk.previousClaims', label: 'Previous claims', format: 'text' },
      { path: 'risk.noClaimsDiscount', label: 'NCB', format: 'text' },
      { path: 'risk.increasedExcess', label: 'Excess', format: 'text' },
      { path: 'risk.proposerOver45', label: 'Proposer age 45+', format: 'boolean' },
    ],
  },

  rules: { batchRules: { minUnits: 0 } },

  theme: { iconKey: 'home', segmentLabel: 'Home' },
};
