// Travel wizard addon catalogue + addon-summary assembly.
//
// The KEY / LABEL / ORDER live in `@facio/products` (`travel/addons.ts`)
// as the single canonical source — that's what `backend/products/travel/pricing/travelCalculator.ts`
// uses to label every line on `breakdown.lines`, and what
// `backend/products/travel/documents/viewModel.ts` uses to label the
// PDF schedule's "Optional Extensions" list. This module only adds the
// wizard-specific `description` text used by the Step 5 option cards.
//
// Duplicating keys/labels here was the original failure mode behind
// ABY-241 / ABY-242 (Gadget price disappearing on Step 6) and ABY-261
// (Business Cover / Golf Cover label duplication). Per ADR-0011,
// keep this file as a thin extension of the canonical catalogue —
// don't reintroduce a parallel keys list, don't override labels.

import {
  TRAVEL_ADDON_CATALOG,
  type TravelAddonCatalogEntry,
  type TravelAddonKey,
} from '@facio/products';
import { asRecord } from '@/src/shared/lib/record';

export type TravelAddon = TravelAddonCatalogEntry & {
  /** Wizard-only long-form description for the Step 5 option card. */
  description: string;
};

const DESCRIPTIONS: Readonly<Record<TravelAddonKey, string>> = Object.freeze({
  winterSports:
    'Protect yourself against medical expenses while you are taking part in skiing, snowboarding and other winter sports activities as well as all the following: hiring replacement ski equipment; the cost of a lost or a stolen lift pass; costs due to a piste closure and avalanche cover. AMT total of 17 days cover. Single trips cover for full duration of trip.',
  businessCover:
    'If you are using the policy for a business trip, add cover for lost, stolen or damaged business equipment, documents and records, business money and enhanced personal accident cover. Fly in replacement staff to cover meetings you cannot attend due to illness or injury.',
  golfCover:
    'Get cover for lost or damaged golf equipment, both owned and hired; cover for hiring replacement golf equipment and for pre-paid green fees.',
  terrorism:
    'Cover yourself for the costs of cancelling your trip, or, whilst on a trip you have to be evacuated from the country you are visiting, or you choose to cut short your trip — all due to terrorist activity.',
  sportsEquipment:
    'Cover yourself for the loss, theft or damage to sports equipment or cycles which you take on a trip and for the cost of hiring replacement sports or cycle equipment if they are lost, damaged or delayed by more than 12 hours on your outward or onward journey.',
  wedding:
    'If you are getting married during a trip away from home, protect your wedding attire against loss or damage, your rings against loss or theft, your wedding gifts against loss or damage, and the loss of photographs or video recordings because the pre-booked photographer or videographer was either unable to attend the wedding, or was unable to provide the photos or recordings because they have been lost or damaged before you return from your honeymoon.',
  gadget:
    'Get extra protection for gadgets that you take on a trip against accidental or malicious damage, theft, loss, liquid damage and unauthorised calls, texts or data use.',
});

/**
 * The wizard addon catalogue. Reads keys + labels from the canonical
 * `@facio/products` catalogue (`TRAVEL_ADDON_CATALOG`) and decorates
 * each entry with the wizard's long-form description. The order
 * mirrors the canonical catalogue so the wizard option cards, payment
 * sidebar lines, BO Premium tab lines and PDF schedule all use the
 * same display order without any per-surface ordering hack.
 */
export const TRAVEL_ADDONS: ReadonlyArray<TravelAddon> = Object.freeze(
  TRAVEL_ADDON_CATALOG.map((entry) =>
    Object.freeze({ ...entry, description: DESCRIPTIONS[entry.key] }),
  ),
);

/**
 * Fully-typed addons selection map: every key from the canonical
 * catalogue is present and maps to a boolean. This is the shape the
 * wizard form is required to hold at `quoteData.addons` and what the
 * live-rate hook (`useTravelAddonAutoRate`) consumes.
 */
export type TravelAddonSelection = Record<TravelAddonKey, boolean>;

/**
 * Project an unknown value (e.g. the result of `form.watch('addons')`
 * or a server-side `quoteData.addons`) into a `TravelAddonSelection`.
 *
 * Returns `undefined` when the input is not an object — that signal is
 * what the live-rate hook uses to distinguish "haven't loaded yet"
 * from "explicit no-addons", so the boot-time snapshot can't drift.
 *
 * Per-key reads coerce non-`true` values to `false`, matching the
 * server-side rating contract: only an explicit `true` enables an
 * addon. This makes the function safe to feed any historic snapshot
 * (e.g. quotes saved before a new addon was added — the new key
 * defaults to `false`, no manual migration needed).
 */
export function readSelectedAddons(value: unknown): TravelAddonSelection | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source: Record<string, unknown> = value as Record<string, unknown>;
  // Object-literal form (not a loop + cast) so that adding a new
  // catalogue entry to `TRAVEL_ADDONS` becomes a compile error here —
  // forcing every projector to acknowledge the new key instead of
  // silently dropping it through a string-keyed loop.
  const result: TravelAddonSelection = {
    winterSports: source.winterSports === true,
    businessCover: source.businessCover === true,
    golfCover: source.golfCover === true,
    terrorism: source.terrorism === true,
    sportsEquipment: source.sportsEquipment === true,
    wedding: source.wedding === true,
    gadget: source.gadget === true,
  };
  return result;
}

export type TravelAddonSummary = {
  /** Display labels in canonical catalogue order, only for addons the customer selected. */
  labels: string[];
  /** Prices in the same order as `labels`, taken from `quoteResponse.addonPrices`. Defaults to 0 when missing. */
  prices: number[];
  /** Sum of `prices`. Already rounded to 2dp. */
  total: number;
  /** Convenience zipped pairs for callers that prefer the joined shape. */
  lines: Array<{ key: string; label: string; price: number }>;
};

type AddonsRecord = Record<string, boolean | undefined>;

type QuoteResponseShape = {
  /**
   * ABY-272 — single source of truth for per-addon line prices. Emitted
   * by the backend rate calculator with the exact number that will
   * appear on the breakdown's addon line when the option is selected.
   * Replaces the legacy `addonGrossPrices` field (which rolled admin
   * fee + IPT swings into the card price and disagreed with the
   * order summary).
   */
  addonPrices?: Record<string, number>;
} | null | undefined;

/**
 * ABY-264 — canonical breakdown line shape, identical to the
 * backend's `TravelBreakdownLine` (`backend/products/travel/pricing/
 * travelCalculator.ts`). Re-declared here so the wizard does not
 * import a backend type; the FE consumes the field as-is from
 * `quoteResponse.primaryOption.breakdown.lines`.
 */
export type TravelBreakdownLine = {
  code: string;
  label: string;
  amount: number;
  kind: 'base' | 'addon' | 'loading' | 'tax' | 'fee' | 'total';
};

/**
 * Project the canonical `breakdown.lines` out of a `quoteResponse`.
 *
 * Single helper so every wizard step that renders the order summary
 * sidebar reads the same field path and gets the same defensive
 * empty-array fallback. The lines are already pre-ordered (base →
 * addons → tax → fee → total) and zero-amount lines are already
 * omitted by the calculator — consumers should NOT re-sort or
 * re-filter, or they re-introduce the per-surface drift the spine
 * exists to prevent.
 */
export function readTravelBreakdownLines(quoteResponse: unknown): ReadonlyArray<TravelBreakdownLine> {
  // Narrow through the shared `asRecord` helper at every nesting level
  // rather than re-introducing broad map casts at boundaries (the
  // `no-new-any` diff ratchet enforces a single narrowing entry point
  // at boundaries — `@/src/shared/lib/record:asRecord`).
  const root = asRecord(quoteResponse);
  const primary = asRecord(root.primaryOption);
  const breakdown = asRecord(primary.breakdown);
  const raw = breakdown.lines;
  if (!Array.isArray(raw)) return [];
  const out: TravelBreakdownLine[] = [];
  for (const entry of raw) {
    const e = asRecord(entry);
    const code = String(e.code || '');
    const label = String(e.label || '');
    const amount = Number(e.amount);
    const kind = String(e.kind || '');
    if (!code || !label || !Number.isFinite(amount)) continue;
    if (kind !== 'base' && kind !== 'addon' && kind !== 'loading' && kind !== 'tax' && kind !== 'fee' && kind !== 'total') continue;
    out.push({ code, label, amount, kind });
  }
  return out;
}

/**
 * Assemble the addon summary the order-summary sidebar needs.
 *
 * Iterates the canonical `TRAVEL_ADDONS` catalogue (so the order
 * is stable across all consumers), keeps only addons the
 * customer selected, and looks up the price from
 * `quoteResponse.addonPrices[key]` (ABY-272). The same number
 * appears on the addon card and on the breakdown line — one
 * writer (the backend rate calculator), one reader path.
 *
 * Missing prices fall back to `0` so the sidebar can still
 * display the line — better than hiding the addon entirely
 * (which is what produced ABY-241 in the first place).
 *
 * Pure function — no DOM, no React hooks. All hooks-vs-pure
 * choices live in the call site.
 */
export function buildSelectedTravelAddonSummary(args: {
  addons: AddonsRecord | null | undefined;
  quoteResponse: QuoteResponseShape;
}): TravelAddonSummary {
  const addons: AddonsRecord = args.addons ?? {};
  const addonPrices: Record<string, number> = (args.quoteResponse?.addonPrices ?? {}) as Record<string, number>;

  const labels: string[] = [];
  const prices: number[] = [];
  const lines: TravelAddonSummary['lines'] = [];
  let runningTotal = 0;

  for (const addon of TRAVEL_ADDONS) {
    if (!addons[addon.key]) continue;
    const rawPrice = addonPrices[addon.key];
    const price = Number.isFinite(rawPrice as number) ? Number(rawPrice) : 0;
    labels.push(addon.label);
    prices.push(price);
    lines.push({ key: addon.key, label: addon.label, price });
    runningTotal += price;
  }

  return {
    labels,
    prices,
    total: Number(runningTotal.toFixed(2)),
    lines,
  };
}
