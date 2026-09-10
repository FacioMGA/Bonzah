/**
 * Motor vehicle enrichment — canonical contract.
 *
 * One source of truth for the CarDog → motor `QuoteData` mapping that powers
 * both the customer wizard (Step 3 trim picker) and the BO underwriting tab
 * (variant selection inside the questionnaire). Everything that used to live
 * in the backend service, the frontend API helper, the merge helper, the
 * Step 3 fallback path, and the BO controller now flows through this module.
 *
 * Responsibility split:
 *   - **Atomic normalizers** (`normalizeFuelType`, `normalizeVehicleType`,
 *     `normalizeCountry`, `inferCabrioFromBodyStyle`, `normalizeCabrio`):
 *     these own the canonical mapping of upstream/legacy values to the
 *     wizard-facing labels. Wizard option lists, Zod validators, and
 *     CarDog row mappers all consume the SAME function — there is no
 *     room for "fuelType is 'Petrol' on the dropdown but missing in the
 *     enrichment cache" drift.
 *   - **Row helpers** (`normalizeCardogRowToEnrichment`,
 *     `cardogRowToVariantOption`): convert a raw CarDog row into the
 *     two shapes our UI consumes. They share their own variantId
 *     derivation so the variant list and the variant detail cache stay
 *     keyed identically.
 *   - **Bridges** (`variantOptionToEnrichmentResult`,
 *     `enrichmentToQuoteDataUpdates`): keep wizard fallback paths,
 *     BO trim selection, and the customer trim selection on the same
 *     merge contract. The wizard's "backend cache miss" branch and the
 *     BO's `applyVariantEnrichmentToQuoteData` both go through these.
 *
 * Forbidden: re-declaring `VehicleEnrichmentFieldKey`, fuel-type
 * normalization, cabrio Yes/No coercion, or the enrichment-target field
 * set anywhere else in the repo. Add a new field here and let consumers
 * pick it up; do not fork the contract.
 */

export const VEHICLE_ENRICHMENT_FIELD_KEYS = [
  'registrationNumber',
  'make',
  'model',
  'year',
  'fuelType',
  'engineSize',
  'numberOfSeats',
  'vehicleType',
  'countryOfRegistration',
  'vehicleValue',
  'cabrio',
] as const;

export type VehicleEnrichmentFieldKey = (typeof VEHICLE_ENRICHMENT_FIELD_KEYS)[number];

export const ENRICHMENT_TARGET_FIELDS: ReadonlySet<VehicleEnrichmentFieldKey> = new Set(
  VEHICLE_ENRICHMENT_FIELD_KEYS,
);

export type VehicleVariantOption = {
  variantId: string;
  label: string;
  trimName?: string;
  make?: string;
  model?: string;
  year?: number;
  fuelType?: string;
  transmission?: string;
  bodyStyle?: string;
  driveType?: string;
  engineSizeCc?: number;
  numberOfSeats?: number;
  vehicleType?: string;
  cabrio?: boolean;
  vehicleValue?: number;
  countryOfRegistration?: string;
  confidence?: number;
};

export type VehicleEnrichmentNormalizedQuoteData = Partial<
  Record<VehicleEnrichmentFieldKey, string | number | boolean>
>;
export type VehicleEnrichmentFieldConfidence = Partial<Record<VehicleEnrichmentFieldKey, number>>;

export type VehicleEnrichmentResult = {
  source: 'cardog';
  variantId: string;
  normalizedQuoteData: VehicleEnrichmentNormalizedQuoteData;
  fieldConfidence: VehicleEnrichmentFieldConfidence;
  raw?: unknown;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function toStringValue(value: unknown): string {
  return String(value || '').trim();
}

function toNumberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// -----------------------------
// Atomic normalizers
// -----------------------------

/**
 * Map any upstream/legacy fuel-type token to the wizard-facing label.
 * Returns `undefined` for tokens we don't recognise — callers must NOT
 * fall back to a hardcoded default; an unrecognised value should leave
 * the field empty so the customer (or underwriter) makes an explicit
 * choice. Update this list together with `FUEL_TYPE_OPTIONS`.
 */
export function normalizeFuelType(value: unknown): string | undefined {
  const raw = toStringValue(value).toLowerCase();
  if (!raw) return undefined;
  if (raw.includes('plug') && raw.includes('hybrid')) return 'Hybrid';
  if (raw.includes('phev')) return 'Hybrid';
  if (raw.includes('hybrid') || raw.includes('mhev') || raw.includes('hev')) return 'Hybrid';
  if (
    raw === 'gasoline' ||
    raw === 'gas' ||
    raw === 'petrol' ||
    raw.includes('petrol') ||
    raw.includes('gasoline')
  ) {
    return 'Petrol';
  }
  if (raw.includes('diesel')) return 'Diesel';
  if (raw.includes('electric') || raw === 'ev' || raw === 'bev') return 'Electric';
  if (raw.includes('other')) return 'Other';
  return undefined;
}

/**
 * Map any upstream body-style/category token to the wizard `vehicleType`
 * label. Order is significant — narrower matches (e.g. `motorbike`)
 * win before the broader `Car` fallback for body styles like `coupe`.
 */
export function normalizeVehicleType(value: unknown): string | undefined {
  const raw = toStringValue(value).toLowerCase();
  if (!raw) return undefined;
  if (raw.includes('motorbike') || raw.includes('motorcycle') || raw.includes('scooter')) return 'Motorbike';
  if (raw.includes('pickup')) return 'Pickup';
  if (raw.includes('motorcaravan') || raw.includes('motorhome') || raw.includes('camper')) return 'Motorcaravan';
  if (raw.includes('classic') || raw.includes('vintage')) return 'Classic';
  if (raw.includes('van')) return 'Van to 3.5 tons';
  if (raw.includes('suv') || raw.includes('4x4') || raw.includes('mpv') || raw.includes('crossover')) return '4x4 or MPV';
  if (
    raw.includes('sedan') ||
    raw.includes('saloon') ||
    raw.includes('hatch') ||
    raw.includes('coupe') ||
    raw.includes('wagon') ||
    raw.includes('estate') ||
    raw.includes('convertible') ||
    raw.includes('cabrio') ||
    raw.includes('roadster') ||
    raw.includes('liftback') ||
    raw.includes('fastback') ||
    raw.includes('targa')
  ) {
    return 'Car';
  }
  return undefined;
}

/** Normalise a country-of-registration token to one of the supported labels. */
export function normalizeCountry(value: unknown): string | undefined {
  const raw = toStringValue(value).toLowerCase();
  if (!raw) return undefined;
  if (raw.includes('cyprus')) return 'Cyprus';
  if (raw === 'uk' || raw.includes('united kingdom') || raw.includes('great britain')) return 'UK';
  if (raw.includes('spain')) return 'Spain';
  if (raw.includes('portugal')) return 'Portugal';
  if (raw.includes('greece')) return 'Greece';
  if (raw.includes('gibraltar')) return 'Gibraltar';
  if (raw.includes('channel')) return 'Channel Islands';
  return undefined;
}

/**
 * Infer the cabrio boolean from a body-style token. Returns `undefined`
 * when the body style is unknown — callers must NOT default to `false`,
 * because that would mask new shapes ("targa", "shooting brake") and
 * silently mis-rate the policy.
 */
export function inferCabrioFromBodyStyle(bodyStyle: unknown): boolean | undefined {
  const raw = toStringValue(bodyStyle).toLowerCase();
  if (!raw) return undefined;
  if (raw.includes('convertible') || raw.includes('cabrio') || raw.includes('roadster') || raw.includes('targa')) {
    return true;
  }
  if (
    raw.includes('saloon') ||
    raw.includes('sedan') ||
    raw.includes('hatch') ||
    raw.includes('estate') ||
    raw.includes('wagon') ||
    raw.includes('suv') ||
    raw.includes('mpv') ||
    raw.includes('coupe') ||
    raw.includes('crossover') ||
    raw.includes('liftback') ||
    raw.includes('fastback') ||
    raw.includes('van') ||
    raw.includes('pickup') ||
    raw.includes('motorbike') ||
    raw.includes('motorcycle')
  ) {
    return false;
  }
  return undefined;
}

/**
 * Coerce any cabrio representation we might encounter (boolean,
 * `'true'`/`'false'`, `'Yes'`/`'No'`, `'y'`/`'n'`, `1`/`0`) to the
 * canonical wizard string `'Yes' | 'No'`. Used by the trim mapper, the
 * BO trim mapper, and the validation normalizer — there is exactly
 * one decision tree.
 */
export function normalizeCabrio(value: unknown): 'Yes' | 'No' | undefined {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (value === 1) return 'Yes';
    if (value === 0) return 'No';
    return undefined;
  }
  const raw = toStringValue(value).toLowerCase();
  if (!raw) return undefined;
  if (raw === 'yes' || raw === 'true' || raw === 'y' || raw === '1') return 'Yes';
  if (raw === 'no' || raw === 'false' || raw === 'n' || raw === '0') return 'No';
  return undefined;
}

/**
 * Apply the per-field type to a raw enrichment value, producing a value
 * shaped for `QuoteData[field]`. Used by the wizard merge function and
 * the BO variant-selection helper so the two paths cannot drift on
 * cabrio Yes/No or numeric coercion.
 */
export function normalizeEnrichmentTargetValue(
  field: VehicleEnrichmentFieldKey,
  value: unknown,
): string | number | undefined {
  switch (field) {
    case 'year':
    case 'engineSize':
    case 'numberOfSeats':
    case 'vehicleValue': {
      const n = Number(value);
      return Number.isFinite(n) ? Math.round(n) : undefined;
    }
    case 'cabrio': {
      return normalizeCabrio(value);
    }
    default: {
      const s = String(value ?? '').trim();
      return s ? s : undefined;
    }
  }
}

// -----------------------------
// Wizard option lists (synced to normalizers)
// -----------------------------

export const FUEL_TYPE_OPTIONS = [
  { value: 'Petrol', label: 'Petrol' },
  { value: 'Diesel', label: 'Diesel' },
  { value: 'Hybrid', label: 'Hybrid' },
  { value: 'Electric', label: 'Electric' },
  { value: 'Other', label: 'Other' },
] as const;

export const VEHICLE_TYPE_OPTIONS = [
  { value: 'Car', label: 'Car' },
  { value: '4x4 or MPV', label: '4x4 or MPV' },
  { value: 'Motorbike', label: 'Motorbike' },
  { value: 'Van to 3.5 tons', label: 'Van to 3.5 tons' },
  { value: 'Pickup', label: 'Pickup' },
  { value: 'Motorcaravan', label: 'Motorhome / Motor Caravan' },
  { value: 'Classic', label: 'Classic' },
] as const;

export const COUNTRY_OF_REGISTRATION_OPTIONS = [
  { value: 'Cyprus', label: 'Cyprus' },
  { value: 'UK', label: 'UK' },
  { value: 'Spain', label: 'Spain' },
  { value: 'Portugal', label: 'Portugal' },
  { value: 'Greece', label: 'Greece' },
  { value: 'Israel', label: 'Israel' },
  { value: 'Channel Islands', label: 'Channel Islands' },
  { value: 'Gibraltar', label: 'Gibraltar' },
] as const;

export const CABRIO_OPTIONS = [
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
] as const;

// -----------------------------
// CarDog row helpers
// -----------------------------

function resolveBodyStyle(row: UnknownRecord): string {
  return toStringValue(
    row.bodyStyle ||
      row.bodyType ||
      row.vehicleBody ||
      row.trimBodyStyle ||
      row.variantBodyStyle,
  );
}

function deriveVariantId(args: {
  row: UnknownRecord;
  make: string;
  model: string;
  year: number | undefined;
  trimLabel: string;
  engineSize: number | undefined;
}): string {
  const { row, make, model, year, trimLabel, engineSize } = args;
  const fallbackVariantId = [
    make || 'make',
    model || 'model',
    typeof year === 'number' ? String(Math.round(year)) : 'year',
    trimLabel || 'trim',
    typeof engineSize === 'number' ? String(Math.round(engineSize)) : 'cc',
  ]
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return toStringValue(
    row.variantId || row.id || row.trimId || row.variantCode || row.vin || fallbackVariantId,
  );
}

function confidenceForField(field: VehicleEnrichmentFieldKey, value: unknown): number | undefined {
  if (typeof value === 'undefined' || value === null || value === '') return undefined;
  if (field === 'vehicleValue') return 0.72;
  if (field === 'vehicleType') return 0.85;
  if (field === 'countryOfRegistration') return 0.78;
  return 0.95;
}

/**
 * Convert a raw CarDog row into a `VehicleEnrichmentResult` payload (sans
 * `source`). Returns `null` if the row lacks enough identity to derive
 * a variantId. Both the variant LIST endpoint (where each row is also
 * cached by variantId) and the VIN endpoint feed through this function,
 * so the cached enrichment shape is consistent across paths.
 */
export function normalizeCardogRowToEnrichment(
  rowInput: unknown,
): Omit<VehicleEnrichmentResult, 'source'> | null {
  const row = asRecord(rowInput);
  const spec = asRecord(row.spec);
  const extra = asRecord(row.extra);
  const rawSpecs = asRecord(extra.rawSpecs);

  const make = toStringValue(row.make || row.makeName);
  const model = toStringValue(row.model || row.modelName || row.variantModelName);
  const year = toNumberValue(row.year || row.modelYear);
  const engineSize = toNumberValue(
    row.engineSizeCc ||
      row.engineCc ||
      row.engineDisplacement ||
      row.displacementCc ||
      spec.displacement ||
      spec.engineSizeCc ||
      spec.engineDisplacement ||
      rawSpecs.displacement,
  );
  const trimLabel = toStringValue(
    row.trimName || row.trim || row.variantName || row.label || row.styleName || row.bodyStyle || row.bodyType || 'trim',
  );

  const variantId = deriveVariantId({ row, make, model, year, trimLabel, engineSize });
  if (!variantId) return null;

  const bodyStyle = resolveBodyStyle(row);
  const fuelType = normalizeFuelType(
    row.fuelType ||
      row.fuel ||
      row.engineFuelType ||
      row.powertrainType ||
      spec.fuelType ||
      spec.engineFuelType ||
      rawSpecs.fuelType,
  );
  const vehicleType = normalizeVehicleType(bodyStyle || row.vehicleType || row.category);
  const countryOfRegistration = normalizeCountry(
    row.countryOfRegistration || row.registrationCountry || row.country,
  );
  const cabrio =
    typeof row.cabrio === 'boolean'
      ? row.cabrio
      : typeof spec.cabrio === 'boolean'
        ? (spec.cabrio as boolean)
        : inferCabrioFromBodyStyle(bodyStyle);
  const seats = toNumberValue(
    row.numberOfSeats ||
      row.seats ||
      row.seatingCapacity ||
      spec.seats ||
      spec.seatingCapacity ||
      rawSpecs.seats,
  );
  const registrationNumber = toStringValue(
    row.registrationNumber || row.registration || row.plate || row.plateNumber,
  );
  const vehicleValue = toNumberValue(
    row.vehicleValue || row.msrp || row.estimatedValue || row.priceEur || row.price,
  );

  const normalizedQuoteData: VehicleEnrichmentNormalizedQuoteData = {};
  if (registrationNumber) normalizedQuoteData.registrationNumber = registrationNumber;
  if (make) normalizedQuoteData.make = make;
  if (model) normalizedQuoteData.model = model;
  if (typeof year === 'number') normalizedQuoteData.year = Math.round(year);
  if (fuelType) normalizedQuoteData.fuelType = fuelType;
  if (typeof engineSize === 'number') normalizedQuoteData.engineSize = Math.round(engineSize);
  if (typeof seats === 'number') normalizedQuoteData.numberOfSeats = Math.round(seats);
  if (vehicleType) normalizedQuoteData.vehicleType = vehicleType;
  if (countryOfRegistration) normalizedQuoteData.countryOfRegistration = countryOfRegistration;
  if (typeof vehicleValue === 'number') normalizedQuoteData.vehicleValue = Math.round(vehicleValue);
  if (typeof cabrio === 'boolean') normalizedQuoteData.cabrio = cabrio;

  const fieldConfidence: VehicleEnrichmentFieldConfidence = {};
  for (const [field, value] of Object.entries(normalizedQuoteData) as Array<
    [VehicleEnrichmentFieldKey, unknown]
  >) {
    const confidence = confidenceForField(field, value);
    if (typeof confidence === 'number') fieldConfidence[field] = confidence;
  }

  return { variantId, normalizedQuoteData, fieldConfidence, raw: rowInput };
}

/**
 * Convert a raw CarDog row into the dropdown-friendly `VehicleVariantOption`.
 * Reuses `normalizeCardogRowToEnrichment` so the displayed trim-line label
 * cannot diverge from the data the form will populate after selection.
 */
export function cardogRowToVariantOption(rowInput: unknown): VehicleVariantOption | null {
  const normalized = normalizeCardogRowToEnrichment(rowInput);
  if (!normalized) return null;
  const row = asRecord(rowInput);
  const spec = asRecord(row.spec);
  const data = normalized.normalizedQuoteData;

  const make = String(data.make || '');
  const model = String(data.model || '');
  const trimName = toStringValue(
    row.trimName || row.trim || row.variantName || row.styleName || row.variantLabel,
  );
  const transmission = toStringValue(row.transmission || spec.transmission);
  const bodyStyle = toStringValue(row.bodyStyle || row.bodyType || spec.bodyStyle || spec.bodyType);
  const driveType = toStringValue(row.driveType || spec.driveType);
  const fuelType = typeof data.fuelType === 'string' ? data.fuelType : undefined;
  const engineSizeCc = typeof data.engineSize === 'number' ? data.engineSize : undefined;
  const numberOfSeats = typeof data.numberOfSeats === 'number' ? data.numberOfSeats : undefined;
  const vehicleType = typeof data.vehicleType === 'string' ? data.vehicleType : undefined;
  const cabrio = typeof data.cabrio === 'boolean' ? data.cabrio : undefined;
  const vehicleValue = typeof data.vehicleValue === 'number' ? data.vehicleValue : undefined;
  const countryOfRegistration =
    typeof data.countryOfRegistration === 'string' ? data.countryOfRegistration : undefined;
  const year = typeof data.year === 'number' ? data.year : undefined;

  const label = toStringValue(
    row.label ||
      row.variantLabel ||
      trimName ||
      `${make} ${model} ${engineSizeCc ? `${engineSizeCc}cc` : ''} ${fuelType || ''}`.trim(),
  );
  if (!label) return null;

  return {
    variantId: normalized.variantId,
    label,
    trimName: trimName || undefined,
    make: make || undefined,
    model: model || undefined,
    year,
    fuelType,
    transmission: transmission || undefined,
    bodyStyle: bodyStyle || undefined,
    driveType: driveType || undefined,
    engineSizeCc,
    numberOfSeats,
    vehicleType,
    cabrio,
    vehicleValue,
    countryOfRegistration: countryOfRegistration || undefined,
    confidence: 0.93,
  };
}

// -----------------------------
// Bridges / merge helpers
// -----------------------------

/**
 * Synthesise a `VehicleEnrichmentResult` from a `VehicleVariantOption`.
 *
 * The wizard hits the variant-detail endpoint after the customer picks a
 * trim. If that call fails (provider rate-limit, pod-local enrichment
 * cache miss, …) the wizard falls back to whatever is already in the
 * variant-options list. Without this bridge that fallback used to
 * reimplement the enrichment shape inline and quietly forgot fields like
 * `cabrio` (string vs boolean) and `countryOfRegistration`. Now it just
 * calls this and reuses the canonical merge — see ADR-aligned guidance
 * in `canonical-ownership.md`.
 */
export function variantOptionToEnrichmentResult(option: VehicleVariantOption): VehicleEnrichmentResult {
  const normalizedQuoteData: VehicleEnrichmentNormalizedQuoteData = {};
  if (option.make) normalizedQuoteData.make = option.make;
  if (option.model) normalizedQuoteData.model = option.model;
  if (typeof option.year === 'number') normalizedQuoteData.year = option.year;
  if (option.fuelType) normalizedQuoteData.fuelType = option.fuelType;
  if (typeof option.engineSizeCc === 'number') normalizedQuoteData.engineSize = option.engineSizeCc;
  if (typeof option.numberOfSeats === 'number') normalizedQuoteData.numberOfSeats = option.numberOfSeats;
  if (option.vehicleType) normalizedQuoteData.vehicleType = option.vehicleType;
  if (option.countryOfRegistration) {
    normalizedQuoteData.countryOfRegistration = option.countryOfRegistration;
  }
  if (typeof option.vehicleValue === 'number') normalizedQuoteData.vehicleValue = option.vehicleValue;
  if (typeof option.cabrio === 'boolean') normalizedQuoteData.cabrio = option.cabrio;

  const fieldConfidence: VehicleEnrichmentFieldConfidence = {};
  for (const [field, value] of Object.entries(normalizedQuoteData) as Array<
    [VehicleEnrichmentFieldKey, unknown]
  >) {
    const confidence = confidenceForField(field, value);
    if (typeof confidence === 'number') fieldConfidence[field] = confidence;
  }

  return {
    source: 'cardog',
    variantId: option.variantId,
    normalizedQuoteData,
    fieldConfidence,
  };
}

/**
 * Project a `VehicleEnrichmentResult` to the per-field updates the form
 * should apply, with each value already coerced to the QuoteData shape
 * (`cabrio: 'Yes' | 'No'`, numbers rounded, blanks dropped).
 */
export function enrichmentToQuoteDataUpdates(
  enrichment: VehicleEnrichmentResult,
): Partial<Record<VehicleEnrichmentFieldKey, string | number>> {
  const result: Partial<Record<VehicleEnrichmentFieldKey, string | number>> = {};
  const normalized = asRecord(enrichment.normalizedQuoteData);
  for (const field of Object.keys(normalized) as VehicleEnrichmentFieldKey[]) {
    const next = normalizeEnrichmentTargetValue(field, normalized[field]);
    if (typeof next === 'undefined') continue;
    result[field] = next;
  }
  return result;
}
