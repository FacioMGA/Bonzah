// AUTO-GENERATED FILE. DO NOT EDIT.
// Source:
//   - backend/...endorsementTemplates...health
//   - backend/modules/reporting/app/bdxImport/productMappers/healthMapper.ts
// Generator: tools/quality/generateValidationContractArtifacts.ts

export const HEALTH_ENDORSEMENT_TEMPLATES_SOURCE_HASH = 'd94d789732318e3dafe1c775e19016f89cc4a70bf8ad2cb5d7150f446cb84e86';
export const HEALTH_BDX_IMPORT_SPEC_SOURCE_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Per-endorsement editable fields (union of `parameters_schema.properties`
 * keys and `ui.form_fields[].name`). Empty arrays mean the endorsement
 * accepts no operator-set parameters.
 */
export const HEALTH_ENDORSEMENT_EDITABLE_FIELDS = {
  "HEALTH-BASE-COVER": [
    "childbirthLumpSum",
    "coinsurancePercent",
    "dailyRoomEmergency",
    "dailyRoomRegular",
    "inpatientPerIllness",
    "inpatientPerPeriod",
    "outpatientExcess",
    "outpatientPerIllness",
    "outpatientPerPeriod",
    "repatriationLimit",
  ],
  "HEALTH-GESY-CLAIMS-CONDITION": [],
  "HEALTH-GHS-EXTENSION": [
    "doctorVisit",
    "doctorVisitsPerPeriod",
    "medications",
  ],
} as const;

/**
 * BDX raw-column → DTO map keyed as `<group>.<field>`, value is the
 * accepted alias array (canonical column first). Sourced directly from
 * the per-product `*LloydsV52MappingSpec`.
 */
export const HEALTH_BDX_IMPORT_RAW_TO_DTO = {} as const;
