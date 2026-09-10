/**
 * ProductKit
 * ----------
 * A minimal, program-driven boundary for brand/product configuration.
 *
 * Design goals:
 * - A published programme definition is the only runtime source.
 * - Product-specific document fields are validated only by the product that
 *   consumes them; another product never needs to invent Motor data.
 * - Keep the shape small and explicit; expand only through a typed product
 *   component.
 */
export type ProductKitBrandV1 = {
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
};

export type MotorProductKitBrandV1 = ProductKitBrandV1 & {
  /** Green Card issuer block, used only by Motor documents. */
  greenCardAuthority: string;
  greenCardIssuerName: string;
  greenCardIssuerAddress: string;
  /** Product-owned, approved signature asset key for issued documents. */
  uwSignatureAsset: string;
};

export type ProductKitV1 = {
  schemaVersion: 1;
  /** Used by MagicB registry filtering and other program-scoped registries. */
  programCode: string;
  brand: ProductKitBrandV1;
};

export type MotorProductKitV1 = Omit<ProductKitV1, 'brand'> & { brand: MotorProductKitBrandV1 };

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Parses the document component of a published programme definition. This is
 * used by issuing documents and BO previews; neither surface may substitute
 * generic identity or legal wording for missing authority.
 */
export function parsePublishedProductKit(raw: unknown): ProductKitV1 {
  if (!isObject(raw) || raw.schemaVersion !== 1) throw new Error('Published product kit requires schemaVersion 1.');
  const programCode = typeof raw.programCode === 'string' ? raw.programCode.trim() : '';
  if (!programCode) throw new Error('Published product kit requires programCode.');
  const brand = isObject(raw.brand) ? raw.brand : null;
  if (!brand) throw new Error('Published product kit requires brand.');
  const requireBrandValue = (key: keyof ProductKitBrandV1): string => {
    const value = typeof brand[key] === 'string' ? brand[key].trim() : '';
    if (!value) throw new Error(`Published product kit brand.${key} is required.`);
    return value;
  };
  return {
    schemaVersion: 1,
    programCode,
    brand: {
      brokerDisplayName: requireBrandValue('brokerDisplayName'),
      brokerLegalName: requireBrandValue('brokerLegalName'),
      brokerAddressMultiline: requireBrandValue('brokerAddressMultiline'),
      brokerAddressOneLine: requireBrandValue('brokerAddressOneLine'),
      brokerRegulatoryLine: requireBrandValue('brokerRegulatoryLine'),
      uwTeamName: requireBrandValue('uwTeamName'),
      coverholderStatement: requireBrandValue('coverholderStatement'),
      dataControllerName: requireBrandValue('dataControllerName'),
    },
  };
}

/** Motor documents need their additional, regulated Green Card authority. */
export function parsePublishedMotorProductKit(raw: unknown): MotorProductKitV1 {
  const kit = parsePublishedProductKit(raw);
  const rawBrand = isObject(raw) && isObject(raw.brand) ? raw.brand : null;
  if (!rawBrand) throw new Error('Published Motor product kit requires brand.');
  const requireMotorBrandValue = (key: keyof Omit<MotorProductKitBrandV1, keyof ProductKitBrandV1>): string => {
    const value = typeof rawBrand[key] === 'string' ? rawBrand[key].trim() : '';
    if (!value) throw new Error(`Published Motor product kit brand.${key} is required.`);
    return value;
  };
  return {
    ...kit,
    brand: {
      ...kit.brand,
      greenCardAuthority: requireMotorBrandValue('greenCardAuthority'),
      greenCardIssuerName: requireMotorBrandValue('greenCardIssuerName'),
      greenCardIssuerAddress: requireMotorBrandValue('greenCardIssuerAddress'),
      uwSignatureAsset: requireMotorBrandValue('uwSignatureAsset'),
    },
  };
}

export function parsePublishedProductKitForProduct(productType: string, raw: unknown): ProductKitV1 {
  return String(productType || '').trim().toUpperCase() === 'MOTOR'
    ? parsePublishedMotorProductKit(raw)
    : parsePublishedProductKit(raw);
}

/** Only the explicitly enabled Green Card capability consumes these signing/issuer fields. */
export function parsePublishedMotorProductKitForSources(raw: unknown, documentTypes: readonly string[]) {
  if (documentTypes.includes('MOTOR_GREEN_CARD_PDF')) return parsePublishedMotorProductKit(raw);
  const kit = parsePublishedProductKit(raw);
  const brand = isObject(raw) && isObject(raw.brand) ? raw.brand : {};
  return { ...kit, brand: { ...kit.brand,
    ...Object.fromEntries(['greenCardAuthority', 'greenCardIssuerName', 'greenCardIssuerAddress', 'uwSignatureAsset'].flatMap(key => typeof brand[key] === 'string' && brand[key].trim() ? [[key, brand[key].trim()]] : [])),
  } };
}
