// AUTO-GENERATED FILE. DO NOT EDIT.
// Source:
//   - backend/...endorsementTemplates...travel
//   - backend/modules/reporting/app/bdxImport/productMappers/travelMapper.ts
// Generator: tools/quality/generateValidationContractArtifacts.ts

export const TRAVEL_ENDORSEMENT_TEMPLATES_SOURCE_HASH = 'de7f45b987ed87bf07fb4cf3815528ed147d775b8023fc12c7f9f20e46c654da';
export const TRAVEL_BDX_IMPORT_SPEC_SOURCE_HASH = '679e6364b74e02a609e4344f6f7c852eac215075a49dd5c2b45ac20a84509e74';

/**
 * Per-endorsement editable fields (union of `parameters_schema.properties`
 * keys and `ui.form_fields[].name`). Empty arrays mean the endorsement
 * accepts no operator-set parameters.
 */
export const TRAVEL_ENDORSEMENT_EDITABLE_FIELDS = {
  "TRAVEL-BASE-COVER": [
    "areaOfTravel",
    "days",
    "levelOfCover",
    "maxTripDuration",
    "travellerType",
    "typeOfCover",
  ],
  "TRAVEL-BUSINESS-COVER": [
    "travellerCount",
  ],
  "TRAVEL-GADGET": [
    "travellerCount",
  ],
  "TRAVEL-GOLF-COVER": [
    "travellerCount",
  ],
  "TRAVEL-SPORTS-EQUIPMENT": [
    "travellerCount",
  ],
  "TRAVEL-TERRORISM": [
    "travellerCount",
  ],
  "TRAVEL-WEDDING": [
    "travellerCount",
  ],
  "TRAVEL-WINTER-SPORTS": [
    "travellerCount",
  ],
} as const;

/**
 * BDX raw-column → DTO map keyed as `<group>.<field>`, value is the
 * accepted alias array (canonical column first). Sourced directly from
 * the per-product `*LloydsV52MappingSpec`.
 */
export const TRAVEL_BDX_IMPORT_RAW_TO_DTO = {
  "coverFields.area": [
    "Area of Cover",
  ],
  "coverFields.maxTripDays": [
    "Number of Days",
  ],
  "coverFields.plan": [
    "Level of Cover",
  ],
  "coverFields.travellers": [
    "Travellers",
  ],
  "coverFields.tripType": [
    "Type of Cover",
  ],
  "dateFields.booked": [
    "Effective Date of Transaction",
    "Policy issuance date",
  ],
  "dateFields.expiry": [
    "Risk Expiry Date",
    "Risk Trip End Date",
    "To Date",
    "Risk Expiry Date To Date",
  ],
  "dateFields.inception": [
    "Risk Inception Date",
    "Risk Trip Start Date",
    "From Date",
    "Risk Inception Date From Date",
  ],
  "insuredFields.address": [
    "Insured Address",
    "Location of Risk, Address",
  ],
  "insuredFields.country": [
    "Insured Country (see code list)",
    "Location of risk - Country",
  ],
  "insuredFields.firstName": [
    "Insured First Name",
  ],
  "insuredFields.lastName": [
    "Insured Full Name, Last Name or Company Name",
  ],
  "insuredFields.postcode": [
    "Insured Postcode, Zip Code or Similar",
    "Location of Risk, Postcode, zip code or similar",
  ],
  "policyFields.entry": [
    "Risk, Transaction Type",
    "Transaction Type - Original Premium etc.",
    "Entry Reason",
  ],
  "policyFields.policyRef": [
    "Certificate Ref",
  ],
  "policyFields.sourceId": [
    "Certificate Ref",
    "Policy or Group Ref",
    "Broker's Ref Number",
  ],
  "premiumFields.commission": [
    "Coverholder commission amount for whole risk/written premium",
  ],
  "premiumFields.gross": [
    "Total gross written premium",
  ],
  "premiumFields.net": [
    "Net written Premium to London in original currency",
  ],
  "premiumFields.tax": [
    "Total taxes payable locally",
  ],
  "premiumFields.total": [
    "Total gross written premium",
  ],
  "riskFields.addons": [
    "Winter Sports Cover",
    "Gadget Cover",
    "Business Cover",
    "Golf Cover",
    "Terrorism Cover",
    "Sports Equipment Cover",
    "Wedding Cover",
  ],
  "riskFields.travellerDobs": [
    "Traveller 1 DOB",
    "Traveller 2 DOB",
    "Traveller 3 DOB",
    "Traveller 4 DOB",
    "Traveller 5 DOB",
  ],
  "riskFields.travellerNames": [
    "Traveller 1 Name",
    "Traveller 2 Name",
    "Traveller 3 Name",
    "Traveller 4 Name",
    "Traveller 5 Name",
  ],
} as const;
