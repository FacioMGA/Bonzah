// Per-country Travel document presets + Service-of-Suit + complaints
// data live in the sibling `travelLegalContacts.ts` module — sourced
// verbatim from the BRIT TRAVEL DRAFT SCHEDULE V3 docx (Andy 2026-05-16).
import { JURISDICTION_TRAVEL_DOCUMENT_PRESETS } from './travelLegalContacts.js';

export type JurisdictionCountryCode = 'CY' | 'PT' | 'GR' | 'ES' | 'BE' | 'NL' | 'IT' | 'FR' | 'MT' | 'US';
export type JurisdictionProductCode = 'MOTOR' | 'HOME' | 'TRAVEL' | 'HEALTH' | 'BUSINESS' | 'OPEN_MARKET' | 'COMMERCIAL' | 'RENTAL';

// Profiles are first-class — every CONFIGS entry carries a real
// `TaxProfileCode`, and missing entries fail loud at resolve time
// (`spine/v2` Wave 5 removed the placeholder pattern). TRAVEL profile
// codes converged to `XX_TRAVEL_BRIT_BAA_2026` across the 9
// BRIT-authorised countries per ADR-0024; rates now come from
// `data/travel-eu-tax-rates.json` via `travelTaxes.ts`, not tenant config.
export type TaxProfileCode =
  | 'CY_COMMERCIAL_SYNTHETIC_NO_TAX'
  | 'US_RENTAL_DEMO_NO_TAX'
  | 'CY_MOTOR_ABBEYGATE_CURRENT'
  | 'PT_MOTOR_VOLANTE_BDX_12_9_CONVERGENCE'
  | 'ES_MOTOR_TENANT_IPT_CURRENT'
  | 'CY_HOME_TENANT_IPT_TEMPORARY'
  | 'PT_HOME_TENANT_IPT_TEMPORARY'
  | 'GR_HOME_TENANT_IPT_CURRENT'
  | 'ES_HOME_TENANT_IPT_CURRENT'
  | 'CY_TRAVEL_BRIT_BAA_2026'
  | 'PT_TRAVEL_BRIT_BAA_2026'
  | 'GR_TRAVEL_BRIT_BAA_2026'
  | 'ES_TRAVEL_BRIT_BAA_2026'
  | 'BE_TRAVEL_BRIT_BAA_2026'
  | 'NL_TRAVEL_BRIT_BAA_2026'
  | 'IT_TRAVEL_BRIT_BAA_2026'
  | 'FR_TRAVEL_BRIT_BAA_2026'
  | 'MT_TRAVEL_BRIT_BAA_2026'
  | 'CY_HEALTH_BRIT_BAA_2026'
  | 'CY_BUSINESS_MANUAL_2026'
  | 'CY_OPEN_MARKET_MANUAL_2026'
  | 'GR_BUSINESS_MANUAL_2026'
  | 'GR_OPEN_MARKET_MANUAL_2026'
  | 'PT_OPEN_MARKET_MANUAL_2026';

export type RoundingMode = 'HALF_UP' | 'BANKERS' | 'EXCEL_COMPAT';

export interface TaxBreakdown {
  code: string;
  amount: number;
  rate?: number;
  base?: number;
  rounding?: {
    mode: RoundingMode;
    precision: 2;
  };
}

export interface TaxRegimeConfig {
  profileCode: TaxProfileCode;
}

export interface DocumentJurisdictionConfig {
  locationLabel: string;
  wordingReference: string;
  assistanceProvider: string;
  assistanceTelephone: string;
  roadsideAssistanceLabel: string;
  legalAssistanceLabel: string;
  /**
   * Per-country local Charles Taylor / CEGA assistance numbers for
   * Travel only. Populated from Peter's BRIT BAA expansion email
   * (2026-05-16) for the 9 authorised Travel countries. Motor/Home
   * leave this undefined.
   */
  assistanceLocalNumbers?: Array<{ city: string; phone: string }>;
  /**
   * Per-country Service of Suit + complaints / ombudsman block — Travel
   * only. Populated from the BRIT TRAVEL DRAFT SCHEDULE V3 docx (Andy
   * 2026-05-16). When undefined for a Travel country, document
   * generation throws `MISSING_TRAVEL_LEGAL_CONTACTS` — the country can
   * be quoted but cannot be issued until BRIT supplies the wording.
   */
  travelLegal?: TravelLegalContacts;
  premiumDisplay: {
    showNet: boolean;
    showTaxBreakdown: boolean;
    ordering: string[];
    labels: Record<string, string>;
  };
}

/**
 * Travel-only Service of Suit + complaints / ombudsman block, sourced
 * from the BRIT TRAVEL DRAFT SCHEDULE V3 docx (2026-05-16).
 *
 * The schedule template (`backend/products/travel/documents/templates/
 * schedule.html`) consumes these fields verbatim — every change here
 * is wording that customers will see and Lloyd's auditors will read.
 *
 * Reference codes (`LBS0006A`, `LBS0081`, etc.) are the Lloyd's
 * standard wording references; do not invent new ones, do not edit
 * the date associated with a reference code.
 */
export interface TravelLegalContacts {
  /** Governing law / jurisdiction line on the schedule. */
  governingLaw: string;
  jurisdiction: string;
  /** Service of Suit recipients — one or more depending on the country. */
  serviceOfSuit: {
    recipients: Array<{ name: string; addressLines: string[] }>;
    referenceCode: string;
    referenceDate: string;
  };
  /** Local Lloyd's representative entity (e.g. "Lloyd's Cyprus Limited"). */
  lloydsLocalEntity?: { name: string; addressLines: string[] };
  /** Lloyd's general representative — name + role + address. */
  generalRepresentative?: { name: string; representativeFor: string; addressLines: string[] };
  /** Complaints / ombudsman contact for this jurisdiction. */
  complaints: {
    ombudsmanName: string;
    ombudsmanPostal: string;
    ombudsmanTel?: string;
    ombudsmanFax?: string;
    ombudsmanEmail?: string;
    ombudsmanWebsite?: string;
    /** Local insurance regulator / authority for escalation. */
    authorityName?: string;
    authorityPostal?: string;
    authorityTel?: string;
    authorityFax?: string;
    authorityWebsite?: string;
    /**
     * Verbatim per-country complaints procedure paragraphs from the
     * BRIT TRAVEL DRAFT SCHEDULE V3 docx. These differ structurally
     * per country (Cyprus: 2/15 business days; Portugal: 5/20 calendar
     * days; Spain: 5 business days / 2 months). Rendered in
     * `schedule.html` via Handlebars triple-braces — DO NOT edit
     * without an ADR; this is Lloyd's-approved wording.
     */
    procedureParagraphs: string[];
    referenceCode: string;
    referenceDate: string;
  };
}

export interface GreenCardJurisdictionConfig {
  bureauName: string;
  countryCode: string;
  codePrefix: string;
  insurerCode: string;
  territoryWording: string;
}

export interface BdxJurisdictionConfig {
  importDefaults: {
    defaultCountry?: string;
    defaultCity?: string;
    defaultProvince?: string;
    defaultPostcode?: string;
    defaultPhone?: string;
    defaultBedrooms?: number;
    defaultVehicleLocation?: string;
    defaultCountryOfRegistration?: string;
    defaultLicenseIssuedIn?: string;
    defaultNationality?: string | null;
    migrationSourceCode: string;
  };
  // `spine/v2` Wave 5 deleted `exportMapping`. It existed as a stub
  // (`taxCodeMapping`/`fieldNaming`/`aggregationRules` empty objects)
  // since the jurisdiction config was scaffolded; no consumer ever read
  // it. Lloyd's V52 export mapping for Motor lives in
  // `backend/modules/reporting/domain/crsV52Motor.ts`. Home/Travel BDX
  // export is not yet in scope. When it lands, add a real
  // `exportMapping` field with a populated shape and the consumers it
  // serves — don't reintroduce the empty placeholder.
}

/**
 * Statutory claims-handling timetable for a (country, product) pair.
 * Optional and additive (ADR-0065): only populated where a jurisdiction
 * imposes a regulated claims-handling timetable — today PT/MOTOR under
 * DL 291/2007. When absent, the jurisdiction has no encoded statutory
 * timetable and the Claims Desk shows no deadline tracker.
 *
 * All counts are WORKING days and are computed with a jurisdiction-aware
 * working-day calendar in `backend/modules/claims/domain/statutoryTimetable.ts`
 * — do NOT scatter `+ 2` / `+ 8` literals through the code. These are
 * LEGAL-VERIFY values: business-supplied, configurable and version
 * controlled because the legal interpretation may change (they must be
 * legally signed off before being asserted to third parties).
 */
export interface NonFaultMotorClaimsDeadlines {
  /** Working days from TP-insurer notification to first contact + arranging inspection. */
  contactWorkingDays: number;
  /** Working days to complete the inspection, counted after the contact period. */
  inspection: {
    standard: number;
    withDismantling: number;
    daaa: number;
    daaaWithDismantling: number;
  };
  /** Working days after inspection completion to make the report available. */
  inspectionReport: { standard: number; daaa: number };
  /** Working days after the contact period to communicate the liability decision. */
  liabilityDecision: { standard: number; daaa: number };
  /** Working days after accepted liability + payment documents to pay. */
  paymentWorkingDays: number;
  /** Working days for a complete/reasoned formal complaint response. */
  complaintResponseWorkingDays: number;
  /** Statutory articles referenced — audit/UI display only. */
  articles: string[];
}

export interface ClaimsHandlingConfig {
  /** e.g. 'DL 291/2007'. */
  regulatoryReference: string;
  nonFaultMotor?: NonFaultMotorClaimsDeadlines;
}

export interface JurisdictionProductConfig {
  countryCode: JurisdictionCountryCode;
  countryName: string;
  productCode: JurisdictionProductCode;
  binderId?: string;
  programId?: string;
  taxRegime: TaxRegimeConfig;
  documentConfig: DocumentJurisdictionConfig;
  greenCardConfig?: GreenCardJurisdictionConfig;
  bdxConfig: BdxJurisdictionConfig;
  claimsHandling?: ClaimsHandlingConfig;
  regulatoryConfig?: Record<string, unknown>;
}

export class ProductConfigurationError extends Error {
  readonly productCode?: string;
  readonly countryCode?: string;
  readonly reason: string;

  constructor(args: { productCode?: string; countryCode?: string; reason: string }) {
    super(`Product configuration error: ${args.productCode || 'UNKNOWN'}/${args.countryCode || 'UNKNOWN'} - ${args.reason}`);
    this.name = 'ProductConfigurationError';
    this.productCode = args.productCode;
    this.countryCode = args.countryCode;
    this.reason = args.reason;
  }
}

export type JurisdictionResolverInput = {
  productCode: string;
  program?: { id?: string | null; productType?: string | null; metadata?: unknown } | null;
  binder?: { id?: string | null; config?: unknown } | null;
  tenant?: { countryCode?: string | null; country?: string | null; tenantSlug?: string | null; kind?: string | null; status?: string | null; parentOrganizationId?: string | null } | null;
  source?: { countryCode?: string | null; tenantHost?: string | null; sourceCode?: string | null } | null;
  /**
   * Customer-declared country of residence — TRAVEL ONLY.
   *
   * Per ADR-0024, the BRIT BAA Travel expansion authorises a single
   * Abbeygate site (CY, PT) to bind for an expat resident in any of
   * the authorised territories (CY, PT, GR, ES, BE, NL, IT, FR, MT).
   * The customer-declared country drives the tax/regulatory dimension
   * of the resolved config; tenant remains the operating identity.
   *
   * Passing this for any product other than TRAVEL is a runtime
   * assertion failure (`assertCustomerOverrideOnlyForTravel`).
   */
  customerCountryOfResidence?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeProductCode(raw: unknown): JurisdictionProductCode {
  const value = String(raw || '').trim().toUpperCase();
  if (value === 'MOTOR' || value === 'HOME' || value === 'TRAVEL' || value === 'HEALTH' || value === 'BUSINESS' || value === 'OPEN_MARKET' || value === 'COMMERCIAL' || value === 'RENTAL') return value;
  throw new ProductConfigurationError({ productCode: value || undefined, reason: 'Unsupported product code' });
}

function normalizeCountryCode(raw: unknown): JurisdictionCountryCode | null {
  const value = String(raw || '').trim().toUpperCase();
  if (value === 'CY' || value === 'CYP' || value === 'CYPRUS' || value === 'REPUBLIC OF CYPRUS') return 'CY';
  if (value === 'PT' || value === 'PRT' || value === 'PORTUGAL') return 'PT';
  if (value === 'GR' || value === 'GRC' || value === 'GREECE') return 'GR';
  if (value === 'ES' || value === 'ESP' || value === 'SPAIN') return 'ES';
  if (value === 'BE' || value === 'BEL' || value === 'BELGIUM') return 'BE';
  if (value === 'NL' || value === 'NLD' || value === 'NETHERLANDS' || value === 'THE NETHERLANDS') return 'NL';
  if (value === 'IT' || value === 'ITA' || value === 'ITALY') return 'IT';
  if (value === 'FR' || value === 'FRA' || value === 'FRANCE') return 'FR';
  if (value === 'MT' || value === 'MLT' || value === 'MALTA') return 'MT';
  if (value === 'US' || value === 'USA' || value === 'UNITED STATES' || value === 'UNITED STATES OF AMERICA') return 'US';
  return null;
}

function countryFromTenantHost(raw: unknown): JurisdictionCountryCode | null {
  const host = String(raw || '').trim().toLowerCase();
  if (!host) return null;
  if (host.includes('abbeygate-pt') || host.includes('portugal')) return 'PT';
  if (host.includes('abbeygate-cy') || host.includes('cyprus')) return 'CY';
  if (host.includes('abbeygate-gr') || host.includes('greece')) return 'GR';
  if (host.includes('abbeygate-es') || host.includes('spain')) return 'ES';
  if (host.includes('united-states')) return 'US';
  return null;
}

/**
 * TRAVEL-only: passing `customerCountryOfResidence` for Motor/Home is
 * forbidden by ADR-0024 ("the customer-declared override is exclusive
 * to Travel"). Reaching this branch with a non-Travel product means a
 * caller has wired the override into the wrong leaf — fail loud.
 */
function assertCustomerOverrideOnlyForTravel(productCode: JurisdictionProductCode, override: unknown): void {
  if (override === undefined || override === null || String(override).trim() === '') return;
  if (productCode === 'TRAVEL') return;
  throw new ProductConfigurationError({
    productCode,
    reason:
      `customerCountryOfResidence is TRAVEL-only (ADR-0024). ` +
      `Passing it for ${productCode} is forbidden — remove the override from the call site.`,
  });
}

function resolveCountryCode(
  input: JurisdictionResolverInput,
  productCode: JurisdictionProductCode,
): JurisdictionCountryCode {
  // ADR-0024: TRAVEL accepts a customer-declared override that takes
  // precedence over tenant/program/binder/source candidates. Motor/Home
  // resolution is unchanged. If the customer-declared value is present
  // but does NOT normalise to an authorised country, fail loud — silent
  // tenant fallback would mask an off-list residence (e.g. Switzerland)
  // by quietly applying the tenant-country tax. `no-defensive-fallbacks`
  // applies; the customer's answer must round-trip exactly.
  if (productCode === 'TRAVEL') {
    const customerSupplied = String(input.customerCountryOfResidence || '').trim();
    if (customerSupplied) {
      const fromCustomer = normalizeCountryCode(customerSupplied);
      if (fromCustomer) return fromCustomer;
      throw new ProductConfigurationError({
        productCode,
        countryCode: customerSupplied.toUpperCase(),
        reason: 'Country code is not supported by jurisdiction product configuration',
      });
    }
  }

  const binderConfig = asRecord(input.binder?.config);
  const programMetadata = asRecord(input.program?.metadata);
  const candidates = [
    input.source?.countryCode,
    binderConfig.countryCode,
    asRecord(binderConfig.jurisdiction).countryCode,
    programMetadata.countryCode,
    input.tenant?.countryCode,
    input.tenant?.country,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeCountryCode(candidate);
    if (normalized) return normalized;
  }
  const fromHost = countryFromTenantHost(input.source?.tenantHost || input.tenant?.tenantSlug);
  if (fromHost) return fromHost;
  // For TRAVEL, also surface the rejected customer override (if any) in
  // the error message so the call site can debug a non-authorised value.
  const suppliedCountry =
    productCode === 'TRAVEL' && input.customerCountryOfResidence
      ? input.customerCountryOfResidence
      : candidates.find((candidate) => String(candidate || '').trim());
  throw new ProductConfigurationError({
    productCode,
    countryCode: suppliedCountry ? String(suppliedCountry).trim().toUpperCase() : undefined,
    reason: suppliedCountry
      ? 'Country code is not supported by jurisdiction product configuration'
      : 'Country code not supplied by Binder, Tenant, or Source',
  });
}

// Per-jurisdiction document presentation. No `if (countryCode === 'X')`
// branches in `makeConfig` — every CONFIGS row passes its own
// `document` block. Adding a country = add a JURISDICTION_DOCUMENT
// entry + a CONFIGS row. No core code change.
//
// Travel-specific presets live in `JURISDICTION_TRAVEL_DOCUMENT_PRESETS`
// (per ADR-0024). Travel countries use the EU standard wording, CEGA /
// Charles Taylor as the assistance provider, and a per-country list of
// local Charles Taylor numbers from Peter's 2026-05-16 email. Motor and
// Home keep the country-scoped preset above.
type JurisdictionDocumentPreset = Omit<DocumentJurisdictionConfig, 'locationLabel'>;

const JURISDICTION_DOCUMENT_PRESETS: Partial<Record<JurisdictionCountryCode, JurisdictionDocumentPreset>> = {
  CY: {
    wordingReference: 'Volante /CY/Abbeygate/05.2024',
    assistanceProvider: 'ODYKY',
    assistanceTelephone: '+357 25 561 582',
    roadsideAssistanceLabel: 'Legal & Roadside Assistance (Cyprus)',
    legalAssistanceLabel: 'Legal Assistance (Cyprus)',
    premiumDisplay: {
      showNet: true,
      showTaxBreakdown: false,
      ordering: ['NET_PREMIUM', 'MIF', 'STAMP_DUTY'],
      labels: {
        NET_PREMIUM: 'PREMIUM',
        MIF: 'MIF',
        STAMP_DUTY: 'STAMP_DUTY',
      },
    },
  },
  PT: {
    wordingReference: 'Volante /PT/Abbeygate/2026',
    assistanceProvider: 'Portugal Assistance Provider',
    assistanceTelephone: '+351 000 000 000',
    roadsideAssistanceLabel: 'Roadside Assistance (Portugal)',
    legalAssistanceLabel: 'Legal Assistance (Portugal)',
    premiumDisplay: {
      showNet: true,
      showTaxBreakdown: true,
      ordering: ['NET_PREMIUM', 'TOTAL_TAX_VALUE', 'STAMP_DUTY', 'FGA_TPO', 'FGA', 'INEM', 'GREEN_CARD_FEE'],
      labels: {
        NET_PREMIUM: 'Net Premium',
        TOTAL_TAX_VALUE: 'Total Tax Value',
        STAMP_DUTY: 'Stamp Duty',
        FGA_TPO: 'FGA (TPO)',
        FGA: 'FGA',
        INEM: 'INEM',
        GREEN_CARD_FEE: 'Green Card Fee',
      },
    },
  },
  GR: {
    wordingReference: 'Volante /GR/Abbeygate/2026',
    assistanceProvider: 'Greece Assistance Provider',
    assistanceTelephone: '+30 210 000 0000',
    roadsideAssistanceLabel: 'Roadside Assistance (Greece)',
    legalAssistanceLabel: 'Legal Assistance (Greece)',
    premiumDisplay: {
      showNet: true,
      showTaxBreakdown: true,
      ordering: ['NET_PREMIUM', 'IPT'],
      labels: {
        NET_PREMIUM: 'Net Premium',
        IPT: 'Insurance Premium Tax',
      },
    },
  },
  ES: {
    wordingReference: 'Volante /ES/Abbeygate/2026',
    assistanceProvider: 'Spain Assistance Provider',
    assistanceTelephone: '+34 900 000 000',
    roadsideAssistanceLabel: 'Roadside Assistance (Spain)',
    legalAssistanceLabel: 'Legal Assistance (Spain)',
    premiumDisplay: {
      showNet: true,
      showTaxBreakdown: true,
      ordering: ['NET_PREMIUM', 'IPT'],
      labels: {
        NET_PREMIUM: 'Net Premium',
        IPT: 'Insurance Premium Tax',
      },
    },
  },
  US: {
    wordingReference: 'Synthetic rental protection demo specimen',
    assistanceProvider: 'Not configured for demonstration',
    assistanceTelephone: '',
    roadsideAssistanceLabel: 'Not included',
    legalAssistanceLabel: 'Not included',
    premiumDisplay: {
      showNet: true,
      showTaxBreakdown: false,
      ordering: ['NET_PREMIUM'],
      labels: { NET_PREMIUM: 'Demonstration premium' },
    },
  },
};

// HEALTH (Brit Immigration Medical Insurance) document preset.
// CY-only Phase 1 — Cyprus expat immigration cover. No roadside/legal
// assistance fields (medical product), no Green Card. Premium display
// shows gross premium + tax breakdown when applicable. Sister to
// `JURISDICTION_DOCUMENT_PRESETS` and `JURISDICTION_TRAVEL_DOCUMENT_PRESETS`.
const JURISDICTION_HEALTH_DOCUMENT_PRESETS: Partial<Record<JurisdictionCountryCode, JurisdictionDocumentPreset>> = {
  CY: {
    wordingReference: 'Brit Immigration Medical Wording April 2025 (Section A only)',
    assistanceProvider: 'Abbeygate Insurance Brokers Ltd',
    assistanceTelephone: '+357 26 819 175',
    roadsideAssistanceLabel: 'Medical Assistance (Cyprus)',
    legalAssistanceLabel: 'Legal Assistance (Cyprus)',
    premiumDisplay: {
      showNet: true,
      showTaxBreakdown: false,
      ordering: ['NET_PREMIUM', 'IPT', 'ADMIN_FEE'],
      labels: {
        NET_PREMIUM: 'Net Premium',
        IPT: 'Insurance Premium Tax',
        ADMIN_FEE: 'Admin Fee',
      },
    },
  },
};


/**
 * Resolve Travel legal contacts for a documented country, throwing
 * `MISSING_TRAVEL_LEGAL_CONTACTS` for BRIT-authorised countries that
 * don't yet have wording in the data table. Used by the Travel
 * document pipeline at issuance time.
 */
export class MissingTravelLegalContactsError extends Error {
  readonly code = 'MISSING_TRAVEL_LEGAL_CONTACTS' as const;
  readonly countryCode: JurisdictionCountryCode;
  constructor(countryCode: JurisdictionCountryCode) {
    super(
      `MISSING_TRAVEL_LEGAL_CONTACTS: Travel Service-of-Suit + complaints wording is not yet defined for country '${countryCode}'. ` +
        'Quote can be rated but issuance is blocked until BRIT supplies the schedule wording. Add an entry to TRAVEL_LEGAL_CONTACTS.',
    );
    this.name = 'MissingTravelLegalContactsError';
    this.countryCode = countryCode;
  }
}

export function getTravelLegalContacts(config: JurisdictionProductConfig): TravelLegalContacts {
  if (config.productCode !== 'TRAVEL') {
    throw new Error(`getTravelLegalContacts called for non-Travel product '${config.productCode}'.`);
  }
  const data = config.documentConfig.travelLegal;
  if (!data) {
    throw new MissingTravelLegalContactsError(config.countryCode);
  }
  return data;
}

function makeConfig(args: {
  countryCode: JurisdictionCountryCode;
  countryName: string;
  productCode: JurisdictionProductCode;
  taxProfile: TaxProfileCode;
  document?: Partial<DocumentJurisdictionConfig>;
  greenCard?: GreenCardJurisdictionConfig;
  bdxImport: BdxJurisdictionConfig['importDefaults'];
  claimsHandling?: ClaimsHandlingConfig;
  regulatory?: Record<string, unknown>;
}): JurisdictionProductConfig {
  // Travel uses its own per-country preset (CEGA assistance, EU standard
  // wording, local Charles Taylor numbers per Peter 2026-05-16). Health
  // uses its own preset (medical assistance, no roadside, no Green Card).
  // Motor and Home keep the country-scoped preset that has been in place
  // since spine/v2 Wave 5.
  const preset =
    args.productCode === 'TRAVEL'
      ? (JURISDICTION_TRAVEL_DOCUMENT_PRESETS as Partial<Record<JurisdictionCountryCode, JurisdictionDocumentPreset>>)[args.countryCode]
      : args.productCode === 'HEALTH'
        ? JURISDICTION_HEALTH_DOCUMENT_PRESETS[args.countryCode]
        : JURISDICTION_DOCUMENT_PRESETS[args.countryCode];
  if (!preset) {
    throw new ProductConfigurationError({
      productCode: args.productCode,
      countryCode: args.countryCode,
      reason:
        args.productCode === 'TRAVEL'
          ? 'Missing JURISDICTION_TRAVEL_DOCUMENT_PRESETS entry for country'
          : args.productCode === 'HEALTH'
            ? 'Missing JURISDICTION_HEALTH_DOCUMENT_PRESETS entry for country'
            : 'Missing JURISDICTION_DOCUMENT_PRESETS entry for country',
    });
  }
  return {
    countryCode: args.countryCode,
    countryName: args.countryName,
    productCode: args.productCode,
    taxRegime: { profileCode: args.taxProfile },
    documentConfig: {
      locationLabel: args.countryName,
      ...preset,
      ...(args.document || {}),
    },
    ...(args.greenCard ? { greenCardConfig: args.greenCard } : {}),
    bdxConfig: { importDefaults: args.bdxImport },
    ...(args.claimsHandling ? { claimsHandling: args.claimsHandling } : {}),
    ...(args.regulatory ? { regulatoryConfig: args.regulatory } : {}),
  };
}

// DL 291/2007 non-fault motor claims-handling timetable (Peter Sheppard,
// ABB/VL/00118, 2026-08-06). WORKING-day counts; LEGAL-VERIFY. Keyed to
// PT/MOTOR jurisdiction config — NOT the binder's `workingDaysJurisdiction`,
// because PT motor rides a mirrored CY binder that would otherwise apply
// the CY value (see ADR-0065).
const PT_MOTOR_CLAIMS_HANDLING: ClaimsHandlingConfig = {
  regulatoryReference: 'DL 291/2007',
  nonFaultMotor: {
    contactWorkingDays: 2,
    inspection: { standard: 8, withDismantling: 12, daaa: 4, daaaWithDismantling: 6 },
    inspectionReport: { standard: 4, daaa: 2 },
    liabilityDecision: { standard: 30, daaa: 15 },
    paymentWorkingDays: 8,
    complaintResponseWorkingDays: 20,
    articles: ['31', '34', '35', '36', '38', '40', '42', '43', '44', '86', '87'],
  },
};

const CY_GREEN_CARD: GreenCardJurisdictionConfig = {
  bureauName: "Motor Insurers' Bureau (Cyprus)",
  countryCode: 'CY',
  codePrefix: 'CY',
  insurerCode: '903',
  territoryWording: 'Green Card territory applies according to the Cyprus Motor Insurers Bureau rules.',
};

const PT_GREEN_CARD: GreenCardJurisdictionConfig = {
  bureauName: 'Portuguese Green Card Bureau',
  countryCode: 'PT',
  codePrefix: 'PT',
  insurerCode: '903',
  territoryWording: 'Green Card territory applies according to the Portuguese Green Card Bureau rules.',
};

const ES_GREEN_CARD: GreenCardJurisdictionConfig = {
  bureauName: 'Spanish Motor Insurers Bureau',
  countryCode: 'ES',
  codePrefix: 'ES',
  insurerCode: '903',
  territoryWording: 'Green Card territory applies according to the Spanish Motor Insurers Bureau rules.',
};

const CONFIGS: Record<string, JurisdictionProductConfig> = {
  'US/RENTAL': makeConfig({
    countryCode: 'US',
    countryName: 'United States',
    productCode: 'RENTAL',
    taxProfile: 'US_RENTAL_DEMO_NO_TAX',
    bdxImport: {
      defaultCountry: 'United States', defaultCity: 'Denver', defaultProvince: 'Colorado',
      defaultPostcode: '00000', defaultPhone: '+15550000000', defaultVehicleLocation: 'United States',
      defaultCountryOfRegistration: 'United States', defaultLicenseIssuedIn: 'United States',
      defaultNationality: null, migrationSourceCode: 'RENTAL_DEMO_NO_IMPORT',
    },
    regulatory: { executionMode: 'DEMO', taxCalculation: 'NOT_CONFIGURED', liveInsuranceAuthority: false },
  }),
  'CY/MOTOR': makeConfig({
    countryCode: 'CY',
    countryName: 'Cyprus',
    productCode: 'MOTOR',
    taxProfile: 'CY_MOTOR_ABBEYGATE_CURRENT',
    document: { wordingReference: 'AB/S/1/2026' },
    greenCard: CY_GREEN_CARD,
    bdxImport: {
      defaultCountry: 'Cyprus',
      defaultCity: 'Nicosia',
      defaultProvince: 'Nicosia',
      defaultPostcode: '0000',
      defaultPhone: '+35722000000',
      defaultVehicleLocation: 'Cyprus',
      defaultCountryOfRegistration: 'Cyprus',
      defaultLicenseIssuedIn: 'Cyprus',
      // Canonical Nationality contract — country name only.
      defaultNationality: 'Cyprus',
      migrationSourceCode: 'BDX_VOLANTE_CYPRUS_DEC_2025',
    },
  }),
  'PT/MOTOR': makeConfig({
    countryCode: 'PT',
    countryName: 'Portugal',
    productCode: 'MOTOR',
    taxProfile: 'PT_MOTOR_VOLANTE_BDX_12_9_CONVERGENCE',
    document: { wordingReference: 'AB/S/1/2026' },
    greenCard: PT_GREEN_CARD,
    claimsHandling: PT_MOTOR_CLAIMS_HANDLING,
    bdxImport: {
      defaultCountry: 'Portugal',
      defaultCity: 'Lisbon',
      defaultProvince: 'Lisbon',
      defaultPostcode: '0000-000',
      defaultPhone: '+351000000000',
      defaultVehicleLocation: 'Portugal',
      defaultCountryOfRegistration: 'Portugal',
      defaultLicenseIssuedIn: 'Portugal',
      defaultNationality: 'Portugal',
      migrationSourceCode: 'BDX_VOLANTE_PORTUGAL_2026',
    },
  }),
  'ES/MOTOR': makeConfig({
    countryCode: 'ES',
    countryName: 'Spain',
    productCode: 'MOTOR',
    taxProfile: 'ES_MOTOR_TENANT_IPT_CURRENT',
    document: { wordingReference: 'AB/S/1/2026' },
    greenCard: ES_GREEN_CARD,
    bdxImport: {
      defaultCountry: 'Spain',
      defaultCity: 'Madrid',
      defaultProvince: 'Madrid',
      defaultPostcode: '00000',
      defaultPhone: '+34900000000',
      defaultVehicleLocation: 'Spain',
      defaultCountryOfRegistration: 'Spain',
      defaultLicenseIssuedIn: 'Spain',
      defaultNationality: 'Spain',
      migrationSourceCode: 'BDX_VOLANTE_SPAIN_2026',
    },
  }),
  'CY/HOME': makeConfig({
    countryCode: 'CY',
    countryName: 'Cyprus',
    productCode: 'HOME',
    taxProfile: 'CY_HOME_TENANT_IPT_TEMPORARY',
    bdxImport: {
      defaultCountry: 'Cyprus',
      defaultCity: 'Nicosia',
      defaultPhone: '+35722000000',
      defaultBedrooms: 1,
      defaultNationality: 'Cyprus',
      migrationSourceCode: 'BDX_HOME_CYPRUS',
    },
  }),
  'PT/HOME': makeConfig({
    countryCode: 'PT',
    countryName: 'Portugal',
    productCode: 'HOME',
    taxProfile: 'PT_HOME_TENANT_IPT_TEMPORARY',
    bdxImport: {
      defaultCountry: 'Portugal',
      defaultCity: 'Lisbon',
      defaultPhone: '+351900000000',
      defaultBedrooms: 1,
      defaultNationality: null,
      migrationSourceCode: 'BDX_HOME_PORTUGAL',
    },
  }),
  'GR/HOME': makeConfig({
    countryCode: 'GR',
    countryName: 'Greece',
    productCode: 'HOME',
    taxProfile: 'GR_HOME_TENANT_IPT_CURRENT',
    bdxImport: {
      defaultCountry: 'Greece',
      defaultCity: 'Athens',
      defaultPhone: '+302100000000',
      defaultBedrooms: 1,
      defaultNationality: null,
      migrationSourceCode: 'BDX_HOME_GREECE',
    },
  }),
  'ES/HOME': makeConfig({
    countryCode: 'ES',
    countryName: 'Spain',
    productCode: 'HOME',
    taxProfile: 'ES_HOME_TENANT_IPT_CURRENT',
    bdxImport: {
      defaultCountry: 'Spain',
      defaultCity: 'Madrid',
      defaultPhone: '+34900000000',
      defaultBedrooms: 1,
      defaultNationality: null,
      migrationSourceCode: 'BDX_HOME_SPAIN',
    },
  }),
  // Travel CONFIGS rows use the new BRIT BAA 2026 profile codes (ADR-0024).
  // The legacy `XX_TRAVEL_TENANT_IPT_*` profiles are deleted; rates come
  // from `data/travel-eu-tax-rates.json` via `travelTaxes.ts`. The 9
  // BRIT-authorised countries are CY, PT, GR, ES, BE, NL, IT, FR, MT.
  // Germany excluded pending written BRIT FOS confirmation (Peter 2026-05-16).
  'CY/TRAVEL': makeConfig({
    countryCode: 'CY',
    countryName: 'Cyprus',
    productCode: 'TRAVEL',
    taxProfile: 'CY_TRAVEL_BRIT_BAA_2026',
    bdxImport: {
      defaultCountry: 'Cyprus',
      defaultCity: 'Nicosia',
      defaultPhone: '+35722000000',
      // Nationality is collected by the canonical Travel profile from
      // 2026-05-16 (ADR-0025) for the objective expat eligibility
      // questions. BDX migration still drops historical source-row
      // nationality values — defaultNationality remains null until
      // the BDX importer is updated to map the new field.
      defaultNationality: null,
      migrationSourceCode: 'BDX_TRAVEL_CYPRUS',
    },
  }),
  'PT/TRAVEL': makeConfig({
    countryCode: 'PT',
    countryName: 'Portugal',
    productCode: 'TRAVEL',
    taxProfile: 'PT_TRAVEL_BRIT_BAA_2026',
    bdxImport: {
      defaultCountry: 'Portugal',
      defaultCity: 'Lisbon',
      defaultPhone: '+351900000000',
      defaultNationality: null,
      migrationSourceCode: 'BDX_TRAVEL_PORTUGAL',
    },
  }),
  'GR/TRAVEL': makeConfig({
    countryCode: 'GR',
    countryName: 'Greece',
    productCode: 'TRAVEL',
    taxProfile: 'GR_TRAVEL_BRIT_BAA_2026',
    bdxImport: {
      defaultCountry: 'Greece',
      defaultCity: 'Athens',
      defaultPhone: '+302100000000',
      defaultNationality: null,
      migrationSourceCode: 'BDX_TRAVEL_GREECE',
    },
  }),
  'ES/TRAVEL': makeConfig({
    countryCode: 'ES',
    countryName: 'Spain',
    productCode: 'TRAVEL',
    taxProfile: 'ES_TRAVEL_BRIT_BAA_2026',
    bdxImport: {
      defaultCountry: 'Spain',
      defaultCity: 'Madrid',
      defaultPhone: '+34900000000',
      defaultNationality: null,
      migrationSourceCode: 'BDX_TRAVEL_SPAIN',
    },
  }),
  'BE/TRAVEL': makeConfig({
    countryCode: 'BE',
    countryName: 'Belgium',
    productCode: 'TRAVEL',
    taxProfile: 'BE_TRAVEL_BRIT_BAA_2026',
    bdxImport: {
      defaultCountry: 'Belgium',
      defaultCity: 'Brussels',
      defaultPhone: '+3220000000',
      defaultNationality: null,
      migrationSourceCode: 'BDX_TRAVEL_BELGIUM',
    },
  }),
  'NL/TRAVEL': makeConfig({
    countryCode: 'NL',
    countryName: 'Netherlands',
    productCode: 'TRAVEL',
    taxProfile: 'NL_TRAVEL_BRIT_BAA_2026',
    bdxImport: {
      defaultCountry: 'Netherlands',
      defaultCity: 'Amsterdam',
      defaultPhone: '+3120000000',
      defaultNationality: null,
      migrationSourceCode: 'BDX_TRAVEL_NETHERLANDS',
    },
  }),
  'IT/TRAVEL': makeConfig({
    countryCode: 'IT',
    countryName: 'Italy',
    productCode: 'TRAVEL',
    taxProfile: 'IT_TRAVEL_BRIT_BAA_2026',
    bdxImport: {
      defaultCountry: 'Italy',
      defaultCity: 'Rome',
      defaultPhone: '+390600000000',
      defaultNationality: null,
      migrationSourceCode: 'BDX_TRAVEL_ITALY',
    },
  }),
  'FR/TRAVEL': makeConfig({
    countryCode: 'FR',
    countryName: 'France',
    productCode: 'TRAVEL',
    taxProfile: 'FR_TRAVEL_BRIT_BAA_2026',
    bdxImport: {
      defaultCountry: 'France',
      defaultCity: 'Paris',
      defaultPhone: '+33100000000',
      defaultNationality: null,
      migrationSourceCode: 'BDX_TRAVEL_FRANCE',
    },
  }),
  'MT/TRAVEL': makeConfig({
    countryCode: 'MT',
    countryName: 'Malta',
    productCode: 'TRAVEL',
    taxProfile: 'MT_TRAVEL_BRIT_BAA_2026',
    bdxImport: {
      defaultCountry: 'Malta',
      defaultCity: 'Valletta',
      defaultPhone: '+35621000000',
      defaultNationality: null,
      migrationSourceCode: 'BDX_TRAVEL_MALTA',
    },
  }),
  // HEALTH Phase 1 — Brit Immigration Medical Insurance, Cyprus only.
  // Rides the existing BRIT travel binder family (UMR B176023EEA6153
  // shown on schedule samples). IPT assumed exempt for CY medical
  // until Peter confirms otherwise — the calculator's tax line will be
  // €0 against this profile and the schedule will not render a tax row.
  'CY/HEALTH': makeConfig({
    countryCode: 'CY',
    countryName: 'Cyprus',
    productCode: 'HEALTH',
    taxProfile: 'CY_HEALTH_BRIT_BAA_2026',
    bdxImport: {
      defaultCountry: 'Cyprus',
      defaultCity: 'Nicosia',
      defaultPhone: '+35726819175',
      defaultNationality: null,
      migrationSourceCode: 'BDX_HEALTH_CYPRUS',
    },
  }),
  // BUSINESS / OPEN_MARKET are local manual products for the first iteration:
  // Cyprus-only, no automated tax calculator, no production deployment until
  // the commercial binder/tax treatment is confirmed.
  'CY/BUSINESS': makeConfig({
    countryCode: 'CY',
    countryName: 'Cyprus',
    productCode: 'BUSINESS',
    taxProfile: 'CY_BUSINESS_MANUAL_2026',
    bdxImport: {
      defaultCountry: 'Cyprus',
      defaultCity: 'Nicosia',
      defaultPhone: '+35722000000',
      defaultNationality: null,
      migrationSourceCode: 'BDX_BUSINESS_CYPRUS',
    },
  }),
  'CY/OPEN_MARKET': makeConfig({
    countryCode: 'CY',
    countryName: 'Cyprus',
    productCode: 'OPEN_MARKET',
    taxProfile: 'CY_OPEN_MARKET_MANUAL_2026',
    bdxImport: {
      defaultCountry: 'Cyprus',
      defaultCity: 'Nicosia',
      defaultPhone: '+35722000000',
      defaultNationality: null,
      migrationSourceCode: 'BDX_OPEN_MARKET_CYPRUS',
    },
  }),
  // BUSINESS / OPEN_MARKET for Greece — brings GR to Cyprus product parity.
  // Same manual-referral posture as Cyprus (no automated tax calculator; the
  // profile code is a label only). The GR programs + manual binder authority
  // are seeded by migration `20260723120000_seed_gr_business_open_market_manual_products`.
  'GR/BUSINESS': makeConfig({
    countryCode: 'GR',
    countryName: 'Greece',
    productCode: 'BUSINESS',
    taxProfile: 'GR_BUSINESS_MANUAL_2026',
    bdxImport: {
      defaultCountry: 'Greece',
      defaultCity: 'Athens',
      defaultPhone: '+302100000000',
      defaultNationality: null,
      migrationSourceCode: 'BDX_BUSINESS_GREECE',
    },
  }),
  'GR/OPEN_MARKET': makeConfig({
    countryCode: 'GR',
    countryName: 'Greece',
    productCode: 'OPEN_MARKET',
    taxProfile: 'GR_OPEN_MARKET_MANUAL_2026',
    bdxImport: {
      defaultCountry: 'Greece',
      defaultCity: 'Athens',
      defaultPhone: '+302100000000',
      defaultNationality: null,
      migrationSourceCode: 'BDX_OPEN_MARKET_GREECE',
    },
  }),
  // Portugal Immigration is collected as a manual Open Market referral only.
  // It is deliberately not a PT HEALTH product: no Portugal rate, payment,
  // document or automated issuance authority exists yet.
  'PT/OPEN_MARKET': makeConfig({
    countryCode: 'PT',
    countryName: 'Portugal',
    productCode: 'OPEN_MARKET',
    taxProfile: 'PT_OPEN_MARKET_MANUAL_2026',
    bdxImport: {
      defaultCountry: 'Portugal',
      defaultCity: 'Lisbon',
      defaultPhone: '+351000000000',
      defaultNationality: null,
      migrationSourceCode: 'BDX_OPEN_MARKET_PORTUGAL',
    },
  }),
};

export function resolveJurisdictionProductConfig(input: JurisdictionResolverInput): JurisdictionProductConfig {
  const productCode = normalizeProductCode(input.productCode || input.program?.productType);
  // ADR-0024: customer-declared override is TRAVEL-only. Fail loud if a
  // Motor/Home caller passes it — surfaces the wiring bug rather than
  // silently using the override for the wrong product.
  assertCustomerOverrideOnlyForTravel(productCode, input.customerCountryOfResidence);
  const countryCode = resolveCountryCode(input, productCode);
  if (productCode === 'COMMERCIAL') {
    if (countryCode !== 'CY' || input.tenant?.kind !== 'SYNTHETIC' || input.tenant.status !== 'ACTIVE' || !input.tenant.parentOrganizationId) {
      throw new ProductConfigurationError({ productCode, countryCode, reason: 'Commercial execution is registered only for an active synthetic Cyprus operating tenant; no live jurisdiction authority is configured.' });
    }
    return {
      countryCode, countryName: 'Cyprus', productCode,
      ...(input.program?.id ? { programId: String(input.program.id) } : {}),
      ...(input.binder?.id ? { binderId: String(input.binder.id) } : {}),
      taxRegime: { profileCode: 'CY_COMMERCIAL_SYNTHETIC_NO_TAX' },
      documentConfig: {
        locationLabel: 'Synthetic training only', wordingReference: 'Selected published commercial programme',
        assistanceProvider: 'Not configured for synthetic training', assistanceTelephone: '',
        roadsideAssistanceLabel: 'Not included', legalAssistanceLabel: 'Not included',
        premiumDisplay: { showNet: true, showTaxBreakdown: false, ordering: ['NET_PREMIUM'], labels: { NET_PREMIUM: 'Synthetic premium' } },
      },
      bdxConfig: { importDefaults: { migrationSourceCode: 'COMMERCIAL_SYNTHETIC_NO_IMPORT' } },
      regulatoryConfig: { executionMode: 'SYNTHETIC', taxCalculation: 'NOT_CONFIGURED', liveInsuranceAuthority: false },
    };
  }
  const config = CONFIGS[`${countryCode}/${productCode}`];
  if (!config) {
    throw new ProductConfigurationError({
      productCode,
      countryCode,
      reason: 'Jurisdiction product config not defined',
    });
  }
  return {
    ...config,
    ...(input.program?.id ? { programId: String(input.program.id) } : {}),
    ...(input.binder?.id ? { binderId: String(input.binder.id) } : {}),
  };
}
