/**
 * Canonical Travel add-on catalogue — single source of truth for every
 * surface that names, prices, displays, or documents a travel add-on.
 *
 * Consumers (must read from here, must not re-declare these keys/labels):
 *   - Backend rate engine `backend/products/travel/pricing/travelCalculator.ts`
 *     emits `calculationTrace.steps` + the canonical `TravelBreakdown.lines`
 *     using `TRAVEL_ADDON_LABELS[key]`.
 *   - Backend doc-pack view-model `backend/products/travel/documents/viewModel.ts`
 *     resolves on-PDF add-on labels through the same map.
 *   - Frontend wizard `frontend/src/products/travel/wizard/travelAddons.ts`
 *     extends the catalogue with `description` for the option cards but
 *     re-exports `TRAVEL_ADDON_CATALOG` so the labels never drift.
 *   - Frontend payment-step + BO premium tab both render `breakdown.lines`
 *     as produced by the calculator, so they pick the labels up
 *     automatically — no per-surface formatting.
 *
 * The MBE endorsement template `code` for each add-on lives next to the
 * label so the runtime mapper (`runtime.ts:TRAVEL_ADDON_CODE_TO_FLAG`)
 * doesn't need a second source either.
 *
 * Per ADR-0011 / `docs/architecture/contracts/canonical-ownership.md`,
 * any second place that defines an add-on key or its label is drift —
 * delete it and read from this module instead.
 */

export type TravelAddonKey =
  | 'winterSports'
  | 'businessCover'
  | 'golfCover'
  | 'terrorism'
  | 'sportsEquipment'
  | 'wedding'
  | 'gadget';

export interface TravelAddonCatalogEntry {
  /** Internal flag name on `quoteData.addons.<key>`. */
  key: TravelAddonKey;
  /** Customer-facing label, used in wizard, payment summary, BO breakdown, PDF schedule. */
  label: string;
  /** MBE endorsement template code that represents this add-on on the contract spine. */
  endorsementCode: string;
}

/**
 * Ordered catalogue. The order here drives every consumer's display
 * order (wizard option cards, payment-step breakdown lines, BO Premium
 * tab line items, PDF "optional extensions" list) — keep it stable.
 */
export const TRAVEL_ADDON_CATALOG: readonly TravelAddonCatalogEntry[] = Object.freeze([
  { key: 'winterSports', label: 'Winter Sports', endorsementCode: 'TRAVEL-WINTER-SPORTS' },
  { key: 'businessCover', label: 'Business Cover', endorsementCode: 'TRAVEL-BUSINESS-COVER' },
  { key: 'golfCover', label: 'Golf Cover', endorsementCode: 'TRAVEL-GOLF-COVER' },
  { key: 'terrorism', label: 'Terrorism Cover', endorsementCode: 'TRAVEL-TERRORISM' },
  { key: 'sportsEquipment', label: 'Sports / Cycle Equipment', endorsementCode: 'TRAVEL-SPORTS-EQUIPMENT' },
  { key: 'wedding', label: 'Wedding', endorsementCode: 'TRAVEL-WEDDING' },
  { key: 'gadget', label: 'Gadget', endorsementCode: 'TRAVEL-GADGET' },
]);

export const TRAVEL_ADDON_KEYS: readonly TravelAddonKey[] = Object.freeze(
  TRAVEL_ADDON_CATALOG.map((entry) => entry.key),
);

const ADDON_LABEL_BY_KEY: Readonly<Record<TravelAddonKey, string>> = Object.freeze(
  Object.fromEntries(TRAVEL_ADDON_CATALOG.map((e) => [e.key, e.label])) as Record<TravelAddonKey, string>,
);

const ADDON_CODE_BY_KEY: Readonly<Record<TravelAddonKey, string>> = Object.freeze(
  Object.fromEntries(TRAVEL_ADDON_CATALOG.map((e) => [e.key, e.endorsementCode])) as Record<TravelAddonKey, string>,
);

const ADDON_KEY_BY_CODE: Readonly<Record<string, TravelAddonKey>> = Object.freeze(
  Object.fromEntries(TRAVEL_ADDON_CATALOG.map((e) => [e.endorsementCode.toUpperCase(), e.key])),
);

export function isTravelAddonKey(value: unknown): value is TravelAddonKey {
  return typeof value === 'string' && (TRAVEL_ADDON_KEYS as readonly string[]).includes(value);
}

/**
 * Resolve the customer-facing label for an add-on key. Falls back to a
 * title-cased version of the key for any future addon that has been
 * added to `TRAVEL_ADDON_CATALOG` but not yet to consumers' visual
 * tests — that is a guarded edge case, not a runtime path, and the
 * fallback is intentionally readable so debug surfaces don't show
 * "Add-on: undefined".
 */
export function getTravelAddonLabel(key: string): string {
  if (isTravelAddonKey(key)) return ADDON_LABEL_BY_KEY[key];
  const raw = String(key || '').trim();
  if (!raw) return '';
  return raw
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (ch) => ch.toUpperCase())
    .trim();
}

/** MBE endorsement template code for an add-on key. */
export function getTravelAddonEndorsementCode(key: TravelAddonKey): string {
  return ADDON_CODE_BY_KEY[key];
}

/** Inverse — resolve the add-on key from an MBE endorsement code, or `null`. */
export function travelAddonKeyFromEndorsementCode(code: string): TravelAddonKey | null {
  const normalized = String(code || '').trim().toUpperCase();
  return ADDON_KEY_BY_CODE[normalized] ?? null;
}
