/**
 * ProductKit
 * ----------
 * A minimal, program-driven boundary for brand/product configuration.
 *
 * Design goals:
 * - Safe defaults (current Abbeygate Motor behavior preserved)
 * - Program metadata override (Program.metadata.productKit)
 * - Keep the shape small and boring; expand only when needed
 */
export type ProductKitV1 = {
  schemaVersion: 1;
  /** Used by MagicB registry filtering and other program-scoped registries. */
  programCode: string;
  brand: {
    /** Display name used in headers (short). */
    brokerDisplayName: string;
    /** Legal name used in certificates/footers. */
    brokerLegalName: string;
    /** Broker address used in statement-of-fact and schedule fineprint. */
    brokerAddressMultiline: string;
    /** One-line address (when needed). */
    brokerAddressOneLine: string;
    /** Regulatory line shown on certificate. */
    brokerRegulatoryLine: string;
    /** Generic team/contact label used for invoice/support copy. */
    uwTeamName: string;
    /** Coverholder statement (footer). */
    coverholderStatement: string;
    /** Statement-of-fact copy placeholders. */
    dataControllerName: string;
    /** Green Card issuer block. */
    greenCardIssuerName: string;
    greenCardIssuerAddress: string;
  };
};

export type ProductKit = ProductKitV1;

const DEFAULT_PROGRAM_CODE = process.env.DEFAULT_PROGRAM_CODE || 'default_program';

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === 'object' && !Array.isArray(x);
}

export function buildDefaultProductKit(programCode = DEFAULT_PROGRAM_CODE): ProductKitV1 {
  // Keep the fallback brand neutral. Product- or partner-specific identity
  // must be supplied via Program metadata rather than baked into shared code.
  const brokerDisplayName = 'Insurance Platform';
  const brokerLegalName = 'Insurance Platform Ltd';
  const brokerAddressMultiline = 'Program configuration required';
  const brokerAddressOneLine = 'Program configuration required';

  const greenCardIssuerAddress = 'Program configuration required';

  return {
    schemaVersion: 1,
    programCode,
    brand: {
      brokerDisplayName,
      brokerLegalName,
      brokerAddressMultiline,
      brokerAddressOneLine,
      brokerRegulatoryLine: 'Program configuration required',
      uwTeamName: 'Underwriting',
      coverholderStatement: 'Program configuration required',
      dataControllerName: 'Program configuration required',
      greenCardIssuerName: 'Program configuration required',
      greenCardIssuerAddress,
    },
  };
}

export function normalizeProductKit(raw: unknown): ProductKitV1 {
  const fallback = buildDefaultProductKit(DEFAULT_PROGRAM_CODE);
  if (!isObject(raw)) return fallback;

  const programCode =
    typeof raw.programCode === 'string' && raw.programCode.trim()
      ? raw.programCode.trim()
      : fallback.programCode;

  const brandRaw = isObject(raw.brand) ? raw.brand : {};
  const sanitizedBrand = Object.fromEntries(
    Object.entries(brandRaw).filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
  );
  const next: ProductKitV1 = {
    schemaVersion: 1,
    programCode,
    brand: {
      ...fallback.brand,
      ...sanitizedBrand,
    },
  };

  // Ensure coverholderStatement is never blank.
  if (!String(next.brand.coverholderStatement || '').trim()) {
    next.brand.coverholderStatement = `${next.brand.brokerLegalName} is an authorised Lloyd’s Coverholder.`;
  }

  // Ensure issuer fields are never blank.
  if (!String(next.brand.greenCardIssuerName || '').trim()) {
    next.brand.greenCardIssuerName = `${next.brand.brokerDisplayName} on behalf of\nLloyd's Insurance Company S.A.`;
  }
  if (!String(next.brand.greenCardIssuerAddress || '').trim()) {
    next.brand.greenCardIssuerAddress = fallback.brand.greenCardIssuerAddress;
  }

  return next;
}

