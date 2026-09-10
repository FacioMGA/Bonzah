// AUTO-GENERATED FILE. DO NOT EDIT.
// Source:
//   - backend/...endorsementTemplates...health
//   - backend/products/health/claims/defaultClaimsContract.ts
//   - backend/modules/reporting/app/bdxImport/productMappers/healthMapper.ts
// Generator: tools/quality/generateValidationContractArtifacts.ts

export const HEALTH_ENDORSEMENT_TEMPLATES_SOURCE_HASH = 'efa5e8281b8c6594ffd490c6c0a8fab535a7cb9f31ad744830b97532a31a1c52';
export const HEALTH_CLAIMS_CONTRACT_SOURCE_HASH = '7fd1a9234222fd0ee7c38c32cf6725c890984184e4d6e7f9c6ed384494b546a8';
export const HEALTH_BDX_IMPORT_SPEC_SOURCE_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Per-endorsement editable fields (union of `parameters_schema.properties`
 * keys and `ui.form_fields[].name`). Empty arrays mean the endorsement
 * accepts no operator-set parameters.
 */
export const HEALTH_ENDORSEMENT_EDITABLE_FIELDS = {
  'HEALTH-BASE-COVER': [
    'childbirthLumpSum',
    'dailyRoomEmergency',
    'dailyRoomRegular',
    'inpatientPerIllness',
    'inpatientPerPeriod',
    'repatriationLimit',
  ],
  'HEALTH-GESY-CLAIMS-CONDITION': [],
  'HEALTH-GHS-EXTENSION': [
    'coinsurancePercent',
    'doctorVisit',
    'doctorVisitsPerPeriod',
    'medications',
    'outpatientExcess',
    'outpatientPerIllness',
    'outpatientPerPeriod',
  ],
} as const;

/**
 * Claim form field key → `policy.*` prefill path. Empty when the
 * product's `fullClaimForm.fields` is empty (`source: 'external_spec'`
 * or `'metadata'`); the empty object IS the canonical statement that no
 * prefill paths are authored for the product.
 */
export const HEALTH_CLAIM_PREFILL_PATHS = {} as const;

/**
 * BDX raw-column → DTO map keyed as `<group>.<field>`, value is the
 * accepted alias array (canonical column first). Sourced directly from
 * the per-product `*LloydsV52MappingSpec`.
 */
export const HEALTH_BDX_IMPORT_RAW_TO_DTO = {} as const;
