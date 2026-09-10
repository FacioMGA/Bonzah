// AUTO-GENERATED FILE. DO NOT EDIT.
// Source:
//   - backend/...endorsementTemplates...motor
//   - backend/modules/reporting/app/bdxImport/productMappers/motorMapper.ts
// Generator: tools/quality/generateValidationContractArtifacts.ts

export const MOTOR_ENDORSEMENT_TEMPLATES_SOURCE_HASH = 'fefcaf5579744f677ed6c06338d9a89e0dcfc2d1e172743946d2134af7dd924d';
export const MOTOR_BDX_IMPORT_SPEC_SOURCE_HASH = 'cbc34cdd479a276d2aceef8f24f0dbd51705aa2b63df2a382780d79644bc614e';

/**
 * Per-endorsement editable fields (union of `parameters_schema.properties`
 * keys and `ui.form_fields[].name`). Empty arrays mean the endorsement
 * accepts no operator-set parameters.
 */
export const MOTOR_ENDORSEMENT_EDITABLE_FIELDS = {
  "ABG001": [
    "club_recognition_required",
    "eligible_vehicle_flag",
    "exclusions",
  ],
  "COV-ROADSIDE": [
    "price_eur",
    "provider",
    "refundable",
  ],
  "COV-ROADSIDE-VIP": [
    "upgrade_price_eur",
  ],
  "COV-TPFT": [
    "deductible_eur",
    "premium_eur",
  ],
  "COV-TPL": [
    "basis_text",
    "limit_bodily_injury_eur",
    "limit_property_damage_eur",
    "premium_eur",
  ],
  "CV 1028": [],
  "CV 1029": [],
  "CV 172": [
    "protection_level",
  ],
  "CV 23": [
    "applies_to_all_trailers",
    "max_liability_eur",
  ],
  "CV 24": [
    "cy_limit_eur",
    "no_ncb_impact_limit_eur",
    "other_limit_eur",
    "premium_eur",
  ],
  "CV 4": [
    "excess_amount_eur",
  ],
  "CV 46": [
    "installation_confirmed",
    "installation_date",
    "service_contract_id",
    "tracker_model",
  ],
  "CV 47": [
    "effective_from",
    "note",
  ],
  "CV 5": [
    "excess_amount_eur",
  ],
  "CV 6": [
    "excess_amount_eur",
    "requires_green_card",
    "territory_scope",
  ],
  "CV 7": [
    "additional_excess_eur",
    "target_vehicle_id",
  ],
  "CV 999": [],
} as const;

/**
 * BDX raw-column → DTO map keyed as `<group>.<field>`, value is the
 * accepted alias array (canonical column first). Sourced directly from
 * the per-product `*LloydsV52MappingSpec`.
 */
export const MOTOR_BDX_IMPORT_RAW_TO_DTO = {
  "coverFields.cover": [
    "Cover",
  ],
  "coverFields.drivers": [
    "Drivers",
  ],
  "coverFields.excess": [
    "Excess",
  ],
  "coverFields.use": [
    "Use",
  ],
  "dateFields.booked": [
    "Booked Date",
    "Booked",
  ],
  "dateFields.change": [
    "Date Of Change",
  ],
  "dateFields.expiry": [
    "Expiry Date",
    "Expiry",
  ],
  "dateFields.inception": [
    "Inception Date",
    "Inception",
  ],
  "insuredFields.dateOfBirth": [
    "Date Of Birth",
  ],
  "insuredFields.name": [
    "Insured",
  ],
  "insuredFields.nif": [
    "NIF",
    "Tax Identification Number",
  ],
  "insuredFields.occupation": [
    "Occupation",
  ],
  "insuredFields.postcode": [
    "Postcode",
  ],
  "policyFields.endorsement": [
    "Endorsement",
  ],
  "policyFields.entry": [
    "Entry Type",
    "Entry",
  ],
  "policyFields.note": [
    "Note",
  ],
  "policyFields.policyRef": [
    "Policy Number",
    "Policy",
  ],
  "policyFields.sourceId": [
    "NIE/Passport",
    "Id",
    "Tax Identification Number",
  ],
  "premiumFields.commission": [
    "Commission",
    "Comm.",
    "Comm",
  ],
  "premiumFields.fees": [
    "Green Card Fee",
  ],
  "premiumFields.gross": [
    "Gross  Premium",
    "Gross Premium",
    "Net Premium",
  ],
  "premiumFields.mifPayable": [
    "Mif",
    "MIF Payable",
    "Tax Value",
  ],
  "premiumFields.net": [
    "Payable to ARB",
    "Pay able to ARB",
    "Due to ARB",
    "NWP",
  ],
  "premiumFields.stampPayable": [
    "Stamp",
    "Stamp Payable",
    "Stamp Duty",
  ],
  "premiumFields.total": [
    "Premium Payable",
    "Premium",
  ],
  "riskFields.claimProtection": [
    "Claim protection option",
  ],
  "riskFields.details": [
    "Details",
    "Detail",
  ],
  "riskFields.engineSize": [
    "Engine Size",
  ],
  "riskFields.make": [
    "Make",
  ],
  "riskFields.model": [
    "Model",
  ],
  "riskFields.ncbYears": [
    "NCB Discount years",
  ],
  "riskFields.registration": [
    "Registration",
  ],
  "riskFields.vehicleValue": [
    "Vehicle Value",
  ],
  "riskFields.vehicleYear": [
    "Year",
  ],
} as const;
