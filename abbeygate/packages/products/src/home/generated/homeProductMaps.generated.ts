// AUTO-GENERATED FILE. DO NOT EDIT.
// Source:
//   - backend/...endorsementTemplates...home
//   - backend/products/home/claims/defaultClaimsContract.ts
//   - backend/modules/reporting/app/bdxImport/productMappers/homeMapper.ts
// Generator: tools/quality/generateValidationContractArtifacts.ts

export const HOME_ENDORSEMENT_TEMPLATES_SOURCE_HASH = '5409ef521d5ff1a47aceed84a1640760025087b95685d5efd764e5e6c443133d';
export const HOME_CLAIMS_CONTRACT_SOURCE_HASH = '75ba2236f5b66e8f6b623fced77134e6fb5c32dd2647313065303d4c491cec39';
export const HOME_BDX_IMPORT_SPEC_SOURCE_HASH = 'e6b7298750e1f78e7d4c43d2f30591d2b6e8faac5292ce98ec369953f2d31027';

/**
 * Per-endorsement editable fields (union of `parameters_schema.properties`
 * keys and `ui.form_fields[].name`). Empty arrays mean the endorsement
 * accepts no operator-set parameters.
 */
export const HOME_ENDORSEMENT_EDITABLE_FIELDS = {
  'HOME-ACC-DAMAGE-BUILDINGS': [],
  'HOME-ACC-DAMAGE-CONTENTS': [],
  'HOME-BUILDINGS': [
    'earthquakeVolcanicExcess',
    'escapeOfWaterExcess',
    'excess',
    'subsidenceExcess',
    'sumInsured',
  ],
  'HOME-CONTENTS': [
    'outbuildingsLimit',
    'singleArticleLimit',
    'sumInsured',
    'valuablesTotalLimit',
  ],
  'HOME-EMERGENCY-TRAVEL': [
    'accommodationExpensesLimit',
    'aggregatePeriodLimit',
    'returnTicketLimit',
  ],
  'HOME-EUROP-ASSISTANCE': [
    'premium_eur',
    'provider',
  ],
  'HOME-LIABILITY': [
    'limit',
  ],
  'HOME-SAFE-HIGH-RISK': [],
  'HOME-VALUABLES-PE': [
    'jewelleryAmount',
    'personalEffectsAmount',
    'singleArticleLimit',
  ],
} as const;

/**
 * Claim form field key → `policy.*` prefill path. Empty when the
 * product's `fullClaimForm.fields` is empty (`source: 'external_spec'`
 * or `'metadata'`); the empty object IS the canonical statement that no
 * prefill paths are authored for the product.
 */
export const HOME_CLAIM_PREFILL_PATHS = {} as const;

/**
 * BDX raw-column → DTO map keyed as `<group>.<field>`, value is the
 * accepted alias array (canonical column first). Sourced directly from
 * the per-product `*LloydsV52MappingSpec`.
 */
export const HOME_BDX_IMPORT_RAW_TO_DTO = {
  'coverFields.accidentalDamage': [
    'Accidental Damage',
  ],
  'coverFields.allRisk': [
    'All Risk Sum Insured',
  ],
  'coverFields.buildings': [
    'Buildings Sum Insured',
  ],
  'coverFields.contents': [
    'Contents Sum Insured',
  ],
  'coverFields.solar': [
    'Solar Sum Insured',
  ],
  'dateFields.booked': [
    'Date Issue of Schedule',
    'Effective Date of Transaction',
    'Policy issuance date',
  ],
  'dateFields.expiry': [
    'Risk End Date & Transaction End Date',
    'Risk Expiry Date',
    'Policy Renewal Date',
    'Risk Expiry Date Risk End Date & Transaction End Date',
  ],
  'dateFields.inception': [
    'Risk Start Date',
    'Risk Inception Date',
    'Policy Start Date',
    'Risk Inception Date Risk Start Date',
  ],
  'insuredFields.address': [
    'Insured Address',
    'Policy Holder Property Name / No and Street',
  ],
  'insuredFields.city': [
    'Policy Holder Town / City',
    'Risk Town / City',
  ],
  'insuredFields.country': [
    'Insured Country (see code list)',
    'Policy Holder Country',
    'Risk Country',
  ],
  'insuredFields.firstName': [
    'Insured First Name',
    'Policy Holder First Name',
  ],
  'insuredFields.lastName': [
    'Insured Full Name, Last Name or Company Name',
    'Policy Holder Surname / Compnay Name',
  ],
  'insuredFields.postcode': [
    'Insured Postcode, Zip Code or Similar',
    'Policy Holder Post Code 1',
    'Risk Postcode 1',
  ],
  'policyFields.entry': [
    'Risk, Transaction Type',
    'Transaction Type - Original Premium etc.',
    'Entry Reason',
  ],
  'policyFields.policyRef': [
    'Certificate Ref',
    'Policy or Group Ref',
    'Broker\'s Ref Number',
  ],
  'premiumFields.commission': [
    'Total Commission',
    'Coverholder commission amount for whole risk/written premium',
  ],
  'premiumFields.fees': [
    'Broker Fee',
    'Other Fees or Deductions written Amount',
  ],
  'premiumFields.gross': [
    'Risk Gross Total Premium (ex Ipt)',
    'Total gross written premium',
  ],
  'premiumFields.net': [
    'Risk Net Total Premium (ex Ipt)',
    'Net written Premium to London in original currency',
  ],
  'premiumFields.tax': [
    'IPT',
    'Total taxes payable locally',
  ],
  'premiumFields.total': [
    'Total Gross Premium including IPT',
  ],
  'riskFields.bedrooms': [
    'No Of Beds',
  ],
  'riskFields.flatRoof': [
    'Flat Roof',
  ],
  'riskFields.listedBuilding': [
    'Listed Building',
  ],
  'riskFields.propertyType': [
    'Property Type',
  ],
  'riskFields.unoccupied': [
    'Unoccupied (Y/N)',
  ],
  'riskFields.yearBuilt': [
    'Building Year Built',
  ],
} as const;
