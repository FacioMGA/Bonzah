/* eslint-disable max-lines -- Endorsement template data table (regulatory content, not logic) */
import type { EndorsementTemplate } from './types.js';

export const TEMPLATES: EndorsementTemplate[] = [
    {
        "id": "tmpl-cv4",
        "program_code": "abbeygate_motor",
        "code": "CV 4",
        "title": "ACCIDENTAL DAMAGE EXCESS",
        "summary": "Adds an additional excess to accidental damage claims under Section 2.",
        "type": "EXCESS",
        "scope": "POLICY",
        "jurisdiction": ["CY"],
        "legal_text": "We shall only be liable for the amount in excess of the first (the amount shown in the Schedule) in respect of each and every claim under Section-2 of this Insurance. This Endorsement operates independently of and in addition to any other Excess provision or condition which may be applied or which may be contained in this policy.",
        "parameters_schema": {
            "type": "object",
            "properties": {
                "excess_amount_eur": { "type": "number", "minimum": 0 }
            },
            "required": ["excess_amount_eur"]
        },
        "default_params": { "excess_amount_eur": 275 },
        "option_defaults": { "enabledByDefault": true },
        "rules": {
            "prerequisites": [
                { "type": "policy_flag", "key": "isComprehensive", "value": true, "message": "Accidental damage excess applies only to comprehensive cover." }
            ],
            "exclusions": [],
            "effects": [
                {
                    "type": "ADD_EXCESS",
                    "target": "SECTION_2_ACCIDENTAL_DAMAGE",
                    "amount_param": "excess_amount_eur",
                    "stacking": "add"
                }
            ],
            "approval": { "requires_underwriter": false }
        },
        "ui": {
            "group": "Excesses",
            "help_text": "Adds an additional excess to accidental damage claims under Section 2.",
            "form_fields": [
                { "name": "excess_amount_eur", "label": "Excess amount (EUR)", "type": "currency", "required": true }
            ]
        },
        "document_template": "cv4.html",
        "requires_underwriter_approval": false,
        "allowed_with": [],
        "disallowed_with": []
    },
    {
        "id": "tmpl-cv5",
        "program_code": "abbeygate_motor",
        "code": "CV 5",
        "title": "FIRE & THEFT EXCESS",
        "summary": "Adds an additional excess to claims for fire and theft under Section 2.",
        "type": "EXCESS",
        "scope": "POLICY",
        "jurisdiction": ["CY"],
        "legal_text": "We shall only be liable for the amount in excess of the first (the amount shown in the Schedule) in respect of each and every claim under Section-2 of this Insurance. This Endorsement operates independently of and in addition to any other Excess provision or condition which may be applied or which may be contained in this policy.",
        "parameters_schema": {
            "type": "object",
            "properties": {
                "excess_amount_eur": { "type": "number", "minimum": 0 }
            },
            "required": ["excess_amount_eur"]
        },
        "default_params": { "excess_amount_eur": 275 },
        "option_defaults": { "enabledByDefault": true },
        "rules": {
            "prerequisites": [
                { "type": "policy_flag", "key": "isComprehensive", "value": true, "message": "Fire & theft excess applies only to comprehensive cover." }
            ],
            "exclusions": [],
            "effects": [
                {
                    "type": "ADD_EXCESS",
                    "target": "SECTION_2_THEFT_FIRE",
                    "amount_param": "excess_amount_eur",
                    "stacking": "add"
                }
            ],
            "approval": { "requires_underwriter": false }
        },
        "ui": {
            "group": "Excesses",
            "help_text": "Adds an additional excess to claims for fire and theft under Section 2.",
            "form_fields": [
                { "name": "excess_amount_eur", "label": "Excess amount (EUR)", "type": "currency", "required": true }
            ]
        },
        "document_template": "cv5.html",
        "requires_underwriter_approval": false,
        "allowed_with": [],
        "disallowed_with": []
    },
    {
        "id": "tmpl-cv6",
        "program_code": "abbeygate_motor",
        "code": "CV 6",
        "title": "UK EXCESS",
        "summary": "Adds an extra excess that applies while the vehicle is used in the United Kingdom.",
        "type": "EXCESS",
        "scope": "POLICY",
        "jurisdiction": ["CY", "GB", "EU"],
        "legal_text": "We shall only be liable for the amount in excess of the first (the amount shown in the Schedule) in respect of each and every claim under Section 2 of this Insurance whilst the Motor Vehicle is being used in the United Kingdom, subject to such use being approved by us and an International Motor Insurance Certificate (Green Card) being in force. This Endorsement operates independently of and in addition to any other Excess provision or condition which may be applied or which may be contained in this policy.",
        "parameters_schema": {
            "type": "object",
            "properties": {
                "excess_amount_eur": { "type": "number", "minimum": 0 },
                "territory_scope": { "type": "string", "enum": ["United Kingdom"], "default": "United Kingdom" },
                "requires_green_card": { "type": "boolean", "default": true }
            },
            "required": ["excess_amount_eur"]
        },
        "default_params": { "excess_amount_eur": 500, "territory_scope": "United Kingdom", "requires_green_card": true },
        "rules": {
            "prerequisites": [
                {
                    "type": "policy_has_territory",
                    "value": ["GB"],
                    "message": "CV6 applies only when the policy territorial limits include the United Kingdom or when a Green Card for the UK is requested."
                }
            ],
            "exclusions": [],
            "effects": [
                {
                    "type": "CONDITIONAL_EFFECT",
                    "condition": { "type": "in_territory", "territory": "GB" },
                    "effect": {
                        "type": "ADD_EXCESS",
                        "target": "SECTION_2_ACCIDENTAL_DAMAGE",
                        "amount_param": "excess_amount_eur",
                        "stacking": "add"
                    }
                }
            ],
            "approval": { "requires_underwriter": false }
        },
        "ui": {
            "group": "Excesses",
            "help_text": "Adds an extra excess that applies while the vehicle is used in the United Kingdom. Requires Green Card when used abroad.",
            "form_fields": [
                { "name": "excess_amount_eur", "label": "Excess amount (EUR)", "type": "currency", "required": true },
                { "name": "requires_green_card", "label": "Requires Green Card", "type": "boolean", "required": false }
            ]
        },
        "document_template": "cv6.html",
        "requires_underwriter_approval": false,
        "allowed_with": ["CV 4", "CV 5", "CV 7"],
        "disallowed_with": []
    },
    {
        "id": "tmpl-cv7",
        "program_code": "abbeygate_motor",
        "code": "CV 7",
        "title": "ADDITIONAL EXCESS (Convertible Roof)",
        "summary": "Adds an additional excess specifically for convertible roof related claims.",
        "type": "EXCESS",
        "scope": "VEHICLE",
        "jurisdiction": ["CY"],
        "legal_text": "We shall only be liable for the amount in excess of the first (the amount shown in the Schedule) in respect of each claim under Section 2 of this Insurance. {{additional_excess_eur}} Euros additional excess for any claim paid for the convertible roof. This Endorsement operates independently of and in addition to any other Excess provision or condition which may be applied or which may be contained in this policy.",
        "parameters_schema": {
            "type": "object",
            "properties": {
                "additional_excess_eur": { "type": "number", "minimum": 0 }
            },
            "required": ["additional_excess_eur"]
        },
        "default_params": { "additional_excess_eur": 500 },
        "rules": {
            "prerequisites": [
                { "type": "vehicle_property", "key": "body_type", "in": ["convertible"], "message": "CV7 only applies to vehicles with body_type 'convertible'." }
            ],
            "exclusions": [],
            "effects": [
                {
                    "type": "ADD_EXCESS",
                    "target": "CONVERTIBLE_ROOF_RELATED_CLAIMS",
                    "amount_param": "additional_excess_eur",
                    "stacking": "add"
                }
            ],
            "approval": { "requires_underwriter": false }
        },
        "ui": {
            "group": "Excesses",
            "help_text": "Adds an additional excess specifically for convertible roof related claims.",
            "form_fields": [
                { "name": "additional_excess_eur", "label": "Convertible roof extra excess (EUR)", "type": "currency", "required": true },
                { "name": "target_vehicle_id", "label": "Apply to vehicle", "type": "vehicle_select", "required": true }
            ]
        },
        "document_template": "cv7.html",
        "requires_underwriter_approval": false,
        "allowed_with": ["CV 4", "CV 5"],
        "disallowed_with": []
    },
    {
        "id": "tmpl-cv999",
        "program_code": "abbeygate_motor",
        "code": "CV 999",
        "title": "VEHICLE LOCATION",
        "summary": "Vehicle location warranty (statement of fact address).",
        "type": "WARRANTY",
        "scope": "POLICY",
        "jurisdiction": ["CY"],
        "legal_text": "This insurance is issued on the strict understanding that the vehicle will reside at the address shown in the statement of fact.",
        "parameters_schema": { "type": "object", "properties": {}, "required": [] },
        "default_params": {},
        "rules": {
            "prerequisites": [],
            "exclusions": [],
            "effects": [
                { "type": "ADD_WARRANTY", "text": "This insurance is issued on the strict understanding that the vehicle will reside at the address shown in the statement of fact." }
            ],
            "approval": { "requires_underwriter": false }
        },
        "ui": {
            "group": "Core",
            "help_text": "Vehicle location warranty. Printed on the schedule.",
            "form_fields": []
        },
        "document_template": "cv999.html",
        "requires_underwriter_approval": false,
        "allowed_with": [],
        "disallowed_with": []
    },
    {
        "id": "tmpl-cv1028",
        "program_code": "abbeygate_motor",
        "code": "CV 1028",
        "title": "ECONOMIC AND TRADE SANCTIONS EXCLUSION",
        "summary": "Sanctions exclusion clause.",
        "type": "EXCLUSION",
        "scope": "POLICY",
        "jurisdiction": ["CY", "EU", "GB"],
        "legal_text": "The Company is not liable to make any payments for liability under any coverage sections of this policy or any other policy which is not expressly included in this policy. The Company is not liable to make any payments for liability under any extension for any loss of claim arising in, or where the insured or any beneficiary under the policy is a citizen or instrumentality of the government of, any country (ies) against which any laws and/or regulations governing this policy and/or the insurer, its parent company or its legitimate controlling entity have established an embargo or other form of economic sanction which have the effect of prohibiting the insurer to provide insurance coverage, transacting business with or otherwise offering economic benefits to the insured or any other beneficiary under the policy. It is further understood and agreed that no benefits or payments will be made to any beneficiary (ies) who is/are declared unable to receive economic benefits under the laws and/or regulations governing this policy and/or the insurer, its parent company or its ultimate controlling entity. All other terms, conditions and exceptions remain unchanged.",
        "parameters_schema": { "type": "object", "properties": {}, "required": [] },
        "default_params": {},
        "rules": {
            "prerequisites": [],
            "exclusions": [],
            "effects": [
                { "type": "ADD_RESTRICTION", "text": "Economic and trade sanctions exclusion applies. No cover or benefit where prohibited by applicable sanctions/embargo laws." }
            ],
            "approval": { "requires_underwriter": false }
        },
        "ui": {
            "group": "Core",
            "help_text": "Sanctions exclusion. Printed on the schedule.",
            "form_fields": []
        },
        "document_template": "cv1028.html",
        "requires_underwriter_approval": false,
        "allowed_with": [],
        "disallowed_with": []
    },
    {
        "id": "tmpl-cv1029",
        "program_code": "abbeygate_motor",
        "code": "CV 1029",
        "title": "PREMIUM PAYMENT WARRANTY",
        "summary": "Premium payment warranty clause.",
        "type": "WARRANTY",
        "scope": "POLICY",
        "jurisdiction": ["CY"],
        "legal_text": "Notwithstanding any provision to the contrary within this policy or any endorsement hereto, in respect of non-payment of premium only the following clause will apply. The Policyholder / Insured undertakes that premium will be paid to the Insurer in instalments, when due. If any instalment of the premium due under this policy has not been so paid to the Insurer by the date it is due, the Insurer shall have the right to cancel this policy by notifying the Policyholder / Insured in writing. In the event of cancellation, premium is due to the insurer on a pro rata basis for the period that the insurer is on the risk but the full policy premium shall be payable to the Insurer in the event of a loss or occurrence prior to the date of termination which gives rise to a valid claim under this policy. It is agreed that the Insurer shall give not less than fifteen days prior notice of cancellation to the Policyholder / Insured. If premium due is paid in full to the Insurer before the notice period expires, notice of cancellation shall automatically be revoked. If not, the policy shall automatically terminate at the end of the notice period. If any provision of this clause is found by any court or administrative body of competent jurisdiction to be invalid or unenforceable, such invalidity or unenforceability will not affect the other provisions of this clause which will remain in full force and effect. All other terms, conditions and limitations of this Policy shall remain unchanged.",
        "parameters_schema": { "type": "object", "properties": {}, "required": [] },
        "default_params": {},
        "rules": {
            "prerequisites": [],
            "exclusions": [],
            "effects": [
                { "type": "ADD_WARRANTY", "text": "Premium payment warranty applies (instalment non-payment cancellation and pro-rata/full premium conditions)." }
            ],
            "approval": { "requires_underwriter": false }
        },
        "ui": {
            "group": "Core",
            "help_text": "Premium payment warranty. Printed on the schedule.",
            "form_fields": []
        },
        "document_template": "cv1029.html",
        "requires_underwriter_approval": false,
        "allowed_with": [],
        "disallowed_with": []
    },
    {
        "id": "tmpl-cv23",
        "program_code": "abbeygate_motor",
        "code": "CV 23",
        "title": "TRAILERS (TPO extension)",
        "summary": "Extends Third Party Only cover to a trailer while attached to the vehicle.",
        "type": "COVER_EXTENSION",
        "scope": "POLICY",
        "jurisdiction": ["CY"],
        "legal_text": "The extension of TPO cover to a trailer being towed only whilst attached to or accidentally detached from the Motor Vehicle listed in this schedule of insurance.",
        "parameters_schema": {
            "type": "object",
            "properties": {
                "max_liability_eur": { "type": "number", "minimum": 0 },
                "applies_to_all_trailers": { "type": "boolean", "default": false }
            },
            "required": []
        },
        "default_params": { "max_liability_eur": 5000, "applies_to_all_trailers": false },
        "rules": {
            "prerequisites": [],
            "exclusions": [],
            "effects": [
                {
                    "type": "ADD_COVER",
                    "target": "TRAILER_TPO_EXTENSION",
                    "params_map": { "limit_eur": "max_liability_eur", "applies_to_all_trailers": "applies_to_all_trailers" }
                }
            ],
            "approval": { "requires_underwriter": false }
        },
        "ui": {
            "group": "Extensions",
            "help_text": "Extends Third Party Only cover to a trailer while attached to or accidentally detached from the insured vehicle.",
            "form_fields": [
                { "name": "max_liability_eur", "label": "Maximum liability for trailer (EUR)", "type": "currency", "required": false },
                { "name": "applies_to_all_trailers", "label": "Apply to all trailers", "type": "boolean", "required": false }
            ]
        },
        "document_template": "cv23.html",
        "requires_underwriter_approval": false,
        "allowed_with": [],
        "disallowed_with": []
    },
    {
        "id": "tmpl-cv24",
        "program_code": "abbeygate_motor",
        "code": "CV 24",
        "title": "WINDSCREEN",
        "summary": "Covers windscreen/window glass and associated scratching. Included in Comprehensive cover at no additional charge.",
        "type": "COVER_EXTENSION",
        "scope": "POLICY",
        "jurisdiction": ["CY", "EU"],
        "legal_text": "The Company will indemnify accidental breakage of glass in the windscreen or windows, and/or scratching of bodywork resulting solely and directly from such breakage. Payment under this Section will not affect the allowance of No Claim Discount providing that the payment does not exceed (Cyprus: \"750\":  Others \"1,250\") Euros.",
        "option_defaults": { "enabledByDefault": true },
        "computed_params": [
            { "type": "PRO_RATE_BY_POLICY_TERM_MONTHS", "param": "premium_eur", "defaultValue": 0, "precision": 2 }
        ],
        "parameters_schema": {
            "type": "object",
            "properties": {
                "cy_limit_eur": { "type": "number", "minimum": 0 },
                "other_limit_eur": { "type": "number", "minimum": 0 },
                "no_ncb_impact_limit_eur": { "type": "number", "minimum": 0 },
                "premium_eur": { "type": "number", "minimum": 0 }
            },
            "required": []
        },
        "default_params": { "cy_limit_eur": 750, "other_limit_eur": 1250, "no_ncb_impact_limit_eur": 750, "premium_eur": 0 },
        "rules": {
            "prerequisites": [
                { "type": "policy_flag", "key": "isComprehensive", "value": true, "message": "Windscreen is only available with Comprehensive cover." },
                { "type": "policy_flag", "key": "windscreenDisabled", "value": false, "message": "Windscreen cover has been disabled for this quote." },
                { "type": "policy_flag", "key": "isMotorbike", "value": false, "message": "Windscreen cover is not applicable to motorbikes." }
            ],
            "exclusions": [],
            "effects": [
                {
                    "type": "ADD_COVER",
                    "target": "WINDSCREEN_REPAIR_REPLACE",
                    "params_map": { "cy_limit_eur": "cy_limit_eur", "other_limit_eur": "other_limit_eur" }
                },
                {
                    "type": "ALTER_NCB_BEHAVIOUR",
                    "description": "Claims for windscreen repair/replacement up to `no_ncb_impact_limit_eur` will not affect No Claim Bonus"
                }
            ],
            "approval": { "requires_underwriter": false }
        },
        "ui": {
            "group": "Extras",
            "help_text": "Covers windscreen/window glass and associated scratching; small payments do not affect NCB up to the stated limit.",
            "form_fields": [
                { "name": "cy_limit_eur", "label": "Cyprus limit (EUR)", "type": "currency", "required": false },
                { "name": "other_limit_eur", "label": "Other territories limit (EUR)", "type": "currency", "required": false },
                { "name": "premium_eur", "label": "Premium (EUR)", "type": "currency", "required": false }
            ]
        },
        "document_template": "cv24.html",
        "requires_underwriter_approval": false,
        "allowed_with": [],
        "disallowed_with": []
    },
    {
        "id": "tmpl-cv46",
        "program_code": "abbeygate_motor",
        "code": "CV 46",
        "title": "TRACKER SYSTEM",
        "summary": "Requires tracker installation and service contract conditions.",
        "type": "CONDITION",
        "scope": "VEHICLE",
        "jurisdiction": ["CY"],
        "legal_text": "If shown in the schedule as applying to the insured Motor Vehicle, a Tracker system, as approved and agreed by us, is required to be installed and it is a condition of this Section of the Policy that: a) The Tracker system is kept in an efficient and effective condition. b) A service contract is kept continuously in force with the Tracking Company, and the company responsible for the service contract is immediately advised by you of any apparent defects or failures in the system or signalling. c) All detection devices and their circuitry connection for continuous functioning are fully operable at all times. d) The system is put into full and effective operation at all times. e) We are notified immediately; i) If the central monitoring body give written or verbal warning of possible intended withdrawal of response. ii) Before any alteration to or replacement of the Tracker system and its associated service contract is made.",
        "parameters_schema": {
            "type": "object",
            "properties": {
                "tracker_model": { "type": "string" },
                "installation_confirmed": { "type": "boolean" },
                "service_contract_id": { "type": "string" },
                "installation_date": { "type": "string", "format": "date" }
            },
            "required": ["tracker_model", "installation_confirmed"]
        },
        "default_params": { "tracker_model": "", "installation_confirmed": false, "service_contract_id": null },
        "rules": {
            "prerequisites": [
                { "type": "vehicle_level", "message": "Tracker endorsements are per vehicle and require tracker model and installation confirmation." }
            ],
            "exclusions": [],
            "effects": [
                {
                    "type": "SET_FLAG",
                    "flag": "TRACKER_INSTALLED",
                    "value_param": "installation_confirmed",
                    "description": "Records that tracker is installed and enforces service contract obligations."
                },
                {
                    "type": "ADD_RESTRICTION",
                    "text": "Tracker must be kept in efficient condition and a service contract maintained as a condition of cover."
                }
            ],
            "approval": { "requires_underwriter": true }
        },
        "ui": {
            "group": "Security",
            "help_text": "Requires underwriter approval. Enforces tracker installation and service contract conditions.",
            "form_fields": [
                { "name": "tracker_model", "label": "Tracker model", "type": "string", "required": true },
                { "name": "installation_confirmed", "label": "Installation confirmed", "type": "boolean", "required": true },
                { "name": "service_contract_id", "label": "Service contract reference", "type": "string", "required": false }
            ]
        },
        "document_template": "cv46.html",
        "requires_underwriter_approval": true,
        "allowed_with": [],
        "disallowed_with": []
    },
    {
        "id": "tmpl-cv47",
        "program_code": "abbeygate_motor",
        "code": "CV 47",
        "title": "DELETE NO CLAIM BONUS",
        "summary": "Deletes No Claim Bonus for the policy.",
        "type": "COVER_DELETION",
        "scope": "POLICY",
        "jurisdiction": ["CY"],
        "legal_text": "The benefits granted by Section 4 (No Claim Bonus) have been deleted.",
        "parameters_schema": {
            "type": "object",
            "properties": {
                "effective_from": { "type": "string", "format": "date" },
                "note": { "type": "string" }
            },
            "required": []
        },
        "default_params": {},
        "rules": {
            "prerequisites": [],
            "exclusions": ["CV 172"],
            "effects": [
                {
                    "type": "DELETE_COVER",
                    "target": "NO_CLAIM_BONUS",
                    "description": "Removes No Claim Bonus benefit from policy; affects premium and claims calculations."
                }
            ],
            "approval": { "requires_underwriter": true }
        },
        "ui": {
            "group": "NCB",
            "help_text": "Deletes No Claim Bonus for the policy. Requires underwriter approval.",
            "form_fields": [
                { "name": "effective_from", "label": "Effective from", "type": "date", "required": false },
                { "name": "note", "label": "Underwriter note", "type": "text", "required": true }
            ]
        },
        "document_template": "cv47.html",
        "requires_underwriter_approval": true,
        "allowed_with": [],
        "disallowed_with": ["CV 172"]
    },
    {
        "id": "tmpl-cv172",
        "program_code": "abbeygate_motor",
        "code": "CV 172",
        "title": "NO CLAIM PROTECTION",
        "summary": "Provides no-claim protection per Section 4.",
        "type": "PROTECTION",
        "scope": "POLICY",
        "jurisdiction": ["CY"],
        "legal_text": "Section 4 ‘No claim protection’ is included.",
        "parameters_schema": {
            "type": "object",
            "properties": {
                "protection_level": { "type": "string", "enum": ["Basic", "Full"], "default": "Basic" }
            },
            "required": []
        },
        "default_params": { "protection_level": "Basic" },
        "rules": {
            "prerequisites": [],
            "exclusions": ["CV 47"],
            "effects": [
                {
                    "type": "ADD_COVER",
                    "target": "NO_CLAIM_PROTECTION",
                    "params_map": { "level": "protection_level" }
                },
                {
                    "type": "ALTER_NCB_BEHAVIOUR",
                    "description": "Implements the no-claim protection behavior defined in policy wording Section 4."
                },
                {
                    "type": "ADD_PREMIUM_PCT_OF_NET",
                    "percentage": 0.10,
                    "item_name": "NCB Protection",
                    "min_ncd_pct": 0.60
                }
            ],
            "approval": { "requires_underwriter": false }
        },
        "ui": {
            "group": "Protection",
            "help_text": "Provides no-claim protection per Section 4. Charged as +10% of net premium; requires at least 4 years No Claim Discount. Conflicts with CV47 (Delete NCB).",
            "form_fields": [
                { "name": "protection_level", "label": "Protection level", "type": "select", "options": ["Basic", "Full"], "required": false }
            ]
        },
        "document_template": "cv172.html",
        "requires_underwriter_approval": false,
        "allowed_with": [],
        "disallowed_with": ["CV 47"]
    },
    {
        "id": "tmpl-abg001",
        "program_code": "abbeygate_motor",
        "code": "ABG001",
        "title": "RALLIES (Classic Car Only)",
        "summary": "Allows cover for non-competitive rallies organised by recognised owners' clubs.",
        "type": "EXTENSION_SPECIAL",
        "scope": "POLICY",
        "jurisdiction": ["CY"],
        "legal_text": "Rallies (Only Organised by Owners Clubs). We will provide cover when Your Vehicle is being used in connection with local, national or international rallies organised by owners’ clubs which are recognised by the Driver and Licensing Agency (DVLA) or FIVA. This cover does not apply to any rally that includes racing, pacemaking, or being in any contest or speed trial. The following uses are not deemed to be rallies and are directly excluded from policy coverage: • Racing, pacemaking, being in any contest or speed trial, or any reliability testing on Your Vehicle (apart from road-safety rallies and treasure hunts); • Being trackside (in the restricted area or on the track) at a motor racing circuit.; • Any purpose connected with the motor trade.; • Hiring out Your Vehicle in return for money.; • Carrying passengers or goods in return for money.; • Use on any derestricted toll road, including The Nurburgring.",
        "parameters_schema": {
            "type": "object",
            "properties": {
                "eligible_vehicle_flag": { "type": "boolean", "default": true },
                "club_recognition_required": { "type": "boolean", "default": true },
                "exclusions": { "type": "array", "items": { "type": "string" } }
            },
            "required": []
        },
        "default_params": { "eligible_vehicle_flag": true, "club_recognition_required": true, "exclusions": ["racing", "trackside", "motor_trade", "hire_reward", "carrying_for_reward", "derestricted_toll_road"] },
        "rules": {
            "prerequisites": [
                { "type": "policy_flag", "key": "classic_car", "value": true, "message": "ABG001 applies only to vehicles flagged as 'classic'." }
            ],
            "exclusions": [],
            "effects": [
                {
                    "type": "ADD_COVER",
                    "target": "RALLIES_ORGANISERS_CLUBS",
                    "params_map": { "club_recognition_required": "club_recognition_required", "exclusions": "exclusions" }
                },
                {
                    "type": "ADD_RESTRICTION",
                    "text": "Cover applies only to rallies organised by recognised owners' clubs and excludes racing, pacemaking, track use, hire for reward, and derestricted toll roads."
                }
            ],
            "approval": { "requires_underwriter": true }
        },
        "ui": {
            "group": "Classic Car",
            "help_text": "Allows cover for non-competitive rallies organised by recognised owners' clubs. Requires classic car flag and underwriter approval.",
            "form_fields": [
                { "name": "eligible_vehicle_flag", "label": "Vehicle is classic", "type": "boolean", "required": true },
                { "name": "club_recognition_required", "label": "Club recognised by DVLA/FIVA required", "type": "boolean", "required": true },
                { "name": "exclusions", "label": "Exclusions", "type": "multiselect", "required": false, "options": ["racing", "trackside", "motor_trade", "hire_reward", "carrying_for_reward", "derestricted_toll_road"] }
            ]
        },
        "document_template": "abg001.html",
        "requires_underwriter_approval": true,
        "allowed_with": ["CV 23"],
        "disallowed_with": []
    },
    {
        "id": "tmpl-cov-tpl",
        "program_code": "abbeygate_motor",
        "code": "COV-TPL",
        "title": "Third Party Liability (TPL)",
        "summary": "Compulsory third party liability cover.",
        "type": "COVERAGE",
        "section_id": "SECTION_3",
        "scope": "POLICY",
        "jurisdiction": ["CY"],
        "legal_text": "We will indemnify You against your legal liability to pay damages and claimant's costs and expenses in respect of death of or bodily injury to any person and damage to property derived from the use of the Motor Vehicle.",
        "parameters_schema": {
            "type": "object",
            "properties": {
                "limit_bodily_injury_eur": { "type": "number" },
                "limit_property_damage_eur": { "type": "number" },
                "basis_text": { "type": "string" },
                "premium_eur": { "type": "number" }
            },
            "required": ["limit_bodily_injury_eur", "limit_property_damage_eur"]
        },
        "default_params": {
            "limit_bodily_injury_eur": 38600000,
            "limit_property_damage_eur": 1300000,
            "basis_text": "Cyprus statutory limits"
        },
        "rules": {
            "prerequisites": [],
            "exclusions": [],
            "effects": [
                {
                    "type": "ADD_COVER",
                    "target": "THIRD_PARTY_LIABILITY",
                    "section": "SECTION_3",
                    "params_map": {
                        "limit_bodily_injury_eur": "limit_bodily_injury_eur",
                        "limit_property_damage_eur": "limit_property_damage_eur",
                        "basis": "basis_text"
                    }
                },
                {
                    "type": "ADD_PREMIUM_ROW",
                    "params_map": {
                        "item_name": "Third Party Liability (Basic)",
                        "basis": "basis_text",
                        "value": "-",
                        "amount": "premium_eur"
                    }
                }
            ],
            "approval": { "requires_underwriter": false }
        },
        "ui": {
            "group": "Third Party",
            "help_text": "Compulsory third party liability cover.",
            "form_fields": [
                { "name": "limit_bodily_injury_eur", "label": "Bodily injury limit (EUR)", "type": "currency", "required": true },
                { "name": "limit_property_damage_eur", "label": "Property damage limit (EUR)", "type": "currency", "required": true }
            ]
        },
        "document_template": "cov-tpl.html",
        "requires_underwriter_approval": false,
        "allowed_with": [],
        "disallowed_with": []
    },
    {
        "id": "tmpl-cov-tpft",
        "program_code": "abbeygate_motor",
        "code": "COV-TPFT",
        "title": "Third Party Fire & Theft (TPFT)",
        "summary": "Third party + fire & theft only.",
        "type": "COVERAGE",
        "section_id": "SECTION_2_PART",
        "scope": "VEHICLE",
        "jurisdiction": ["CY"],
        "legal_text": "We will indemnify You against loss of or damage to the Motor Vehicle and its accessories caused by fire, lightning, self-ignition or explosion or by theft or attempted theft.",
        "parameters_schema": {
            "type": "object",
            "properties": {
                "deductible_eur": { "type": "number" },
                "premium_eur": { "type": "number" }
            },
            "required": []
        },
        "default_params": { "deductible_eur": 250 },
        "rules": {
            "prerequisites": [],
            "exclusions": [],
            "effects": [
                {
                    "type": "ADD_COVER",
                    "target": "FIRE_AND_THEFT",
                    "section": "SECTION_2_PART",
                    "params_map": { "deductible_eur": "deductible_eur" }
                },
                {
                    "type": "ADD_PREMIUM_ROW",
                    "params_map": {
                        "item_name": "Third Party Fire & Theft",
                        "basis": "As per wording",
                        "value": "-",
                        "amount": "premium_eur"
                    }
                }
            ],
            "approval": { "requires_underwriter": false }
        },
        "ui": {
            "group": "Own Damage",
            "help_text": "Third party + fire & theft only.",
            "form_fields": [
                { "name": "deductible_eur", "label": "Deductible (EUR)", "type": "currency", "required": true }
            ]
        },
        "document_template": "cov-tpft.html",
        "requires_underwriter_approval": false,
        "allowed_with": [],
        "disallowed_with": []
    },
    {
        "id": "tmpl-cov-roadside",
        "program_code": "abbeygate_motor",
        "code": "COV-ROADSIDE",
        "title": "Roadside Assistance",
        "summary": "24h Roadside Assistance",
        "type": "ASSISTANCE",
        "section_id": "SECTION_EXTRAS",
        "scope": "VEHICLE",
        "jurisdiction": ["CY"],
        "legal_text": "Assistance services.",
        "option_defaults": { "enabledByDefault": true },
        "parameters_schema": {
            "type": "object",
            "properties": {
                "provider": { "type": "string" },
                "price_eur": { "type": "number" },
                "refundable": { "type": "boolean" }
            },
            "required": ["provider"]
        },
        "default_params": { "provider": "Configured Assistance", "price_eur": 86, "refundable": false },
        "rules": {
            "prerequisites": [
                { "type": "policy_flag", "key": "isComprehensive", "value": true, "message": "Roadside Assistance is available only on comprehensive cover." }
            ],
            "exclusions": [],
            "effects": [
                {
                    "type": "ASSISTANCE_ATTACH",
                    "params_map": { "provider": "provider", "price": "price_eur" }
                },
                {
                    "type": "ADD_PREMIUM_ROW",
                    "params_map": {
                        "item_name": "Breakdown & ULR Cover",
                        "basis": "Binder options",
                        "value": "Included",
                        "amount": "price_eur"
                    }
                }
            ],
            "approval": { "requires_underwriter": false }
        },
        "ui": {
            "group": "Extras",
            "help_text": "24h roadside assistance provider and terms (Mandatory).",
            "form_fields": [
                { "name": "provider", "label": "Provider", "type": "string", "required": true },
                { "name": "price_eur", "label": "Price (EUR)", "type": "currency", "required": true }
            ]
        },
        "document_template": "cov-assist.html",
        "requires_underwriter_approval": false,
        "allowed_with": [],
        "disallowed_with": []
    },
    {
        "id": "tmpl-cov-roadside-vip",
        "program_code": "abbeygate_motor",
        "code": "COV-ROADSIDE-VIP",
        "title": "VIP Roadside Upgrade",
        "summary": "Upgrade to VIP Roadside Assistance.",
        "type": "COVERAGE",
        "section_id": "SECTION_2_ASSIST_VIP",
        "scope": "POLICY",
        "jurisdiction": ["CY"],
        "legal_text": "Upgrade to VIP Breakdown assistance service as defined in the VIP policy wording.",
        "parameters_schema": {
            "type": "object",
            "properties": {
                "upgrade_price_eur": { "type": "number" }
            },
            "required": ["upgrade_price_eur"]
        },
        "default_params": { "upgrade_price_eur": 35 },
        "rules": {
            "prerequisites": [
                { "type": "endorsement_present", "value": "COV-ROADSIDE", "message": "VIP Upgrade requires Base Roadside Assistance." }
            ],
            "exclusions": [],
            "effects": [
                {
                    "type": "ASSISTANCE_ATTACH",
                    "params_map": { "price": "upgrade_price_eur" }
                },
                {
                    "type": "ADD_PREMIUM_ROW",
                    "params_map": {
                        "item_name": "VIP Roadside Upgrade",
                        "basis": "Optional",
                        "value": "Yes",
                        "amount": "upgrade_price_eur"
                    }
                }
            ],
            "approval": { "requires_underwriter": false }
        },
        "ui": {
            "group": "Extras",
            "help_text": "Upgrade to VIP Roadside Assistance.",
            "form_fields": [
                { "name": "upgrade_price_eur", "label": "Upgrade Price (EUR)", "type": "currency", "required": true }
            ]
        },
        "document_template": "cov-assist-vip.html",
        "requires_underwriter_approval": false,
        "allowed_with": ["COV-ROADSIDE"],
        "disallowed_with": []
    }
];

export const ENDORSEMENT_GROUPS = [
    { id: "excesses", title: "Excesses", templates: ["CV 4", "CV 5", "CV 6", "CV 7"] },
    { id: "extensions", title: "Extensions", templates: ["CV 23"] },
    { id: "extras", title: "Extras", templates: ["CV 24", "COV-ROADSIDE", "COV-ROADSIDE-VIP"] },
    { id: "security", title: "Security", templates: ["CV 46"] },
    { id: "ncb", title: "NCB & Protection", templates: ["CV 47", "CV 172"] },
    { id: "classic", title: "Classic", templates: ["ABG001"] },
    { id: "core", title: "Core Cover", templates: ["COV-TPL", "COV-TPFT", "COV-COMP-OWN", "CV 999", "CV 1028", "CV 1029"] }
];
