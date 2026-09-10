/**
 * Regression suite for ABY-241 / ABY-242 — gadget addon price was
 * silently dropped from the travel `your-details` order summary
 * because Step6 never passed `selectedAddonPrices` to the shared
 * sidebar. Root cause was three copies of the same loop drifting
 * apart (Step5 vs Step6 vs TravelQuoteWizard payment summary).
 *
 * This file locks the contract for the single canonical owner:
 *   - prices come from `quoteResponse.addonPrices` by key (ABY-272)
 *   - selected addons appear in `TRAVEL_ADDONS` catalogue order
 *   - missing prices fall back to 0 (better than hiding the line)
 *   - the total is rounded to 2dp
 *
 * Add new addons to `TRAVEL_ADDONS` once and every consumer picks
 * them up automatically.
 */
import { describe, expect, it } from 'vitest';
import {
  buildSelectedTravelAddonSummary,
  readTravelBreakdownLines,
  TRAVEL_ADDONS,
} from '../travelAddons';

describe('buildSelectedTravelAddonSummary', () => {
  it('returns the gadget addon with its priced line item when selected (ABY-241 / ABY-242)', () => {
    const summary = buildSelectedTravelAddonSummary({
      addons: { gadget: true },
      quoteResponse: { addonPrices: { gadget: 18.75 } },
    });

    expect(summary.labels).toEqual(['Gadget']);
    expect(summary.prices).toEqual([18.75]);
    expect(summary.total).toBe(18.75);
    expect(summary.lines).toEqual([{ key: 'gadget', label: 'Gadget', price: 18.75 }]);
  });

  it('NEVER returns labels without their prices (the exact ABY-241 regression)', () => {
    // Before the fix, Step6 fed labels to the sidebar but no
    // prices — gadget appeared as a checkmark with no €. The
    // canonical helper now produces labels and prices as
    // paired arrays of the same length. If a future refactor
    // ever decouples them, this assertion fails first.
    const summary = buildSelectedTravelAddonSummary({
      addons: { gadget: true, businessCover: true },
      quoteResponse: { addonPrices: { gadget: 18.75, businessCover: 25.5 } },
    });

    expect(summary.labels.length).toBe(summary.prices.length);
    expect(summary.labels.length).toBe(summary.lines.length);
  });

  it('iterates in TRAVEL_ADDONS catalogue order regardless of `addons` insertion order', () => {
    // Step5 used `TRAVEL_ADDONS` order; Step6 used
    // `Object.entries(addons)` order. That mismatch alone could
    // produce visually inconsistent sidebars between two steps.
    // The canonical helper enforces TRAVEL_ADDONS order for every
    // consumer.
    const summary = buildSelectedTravelAddonSummary({
      addons: { gadget: true, winterSports: true },
      quoteResponse: { addonPrices: { gadget: 10, winterSports: 20 } },
    });

    expect(summary.labels).toEqual(['Winter Sports', 'Gadget']);
    expect(summary.prices).toEqual([20, 10]);
  });

  it('falls back to 0 when an addon is selected but its price is missing from quoteResponse', () => {
    // Better than hiding the line — the sidebar still shows
    // "Gadget €0.00" so the customer knows the addon was added
    // even when pricing data is stale. Hiding it was what caused
    // ABY-241 in the first place.
    const summary = buildSelectedTravelAddonSummary({
      addons: { gadget: true },
      quoteResponse: { addonPrices: {} },
    });

    expect(summary.labels).toEqual(['Gadget']);
    expect(summary.prices).toEqual([0]);
    expect(summary.total).toBe(0);
  });

  it('returns empty arrays when no addons are selected', () => {
    expect(
      buildSelectedTravelAddonSummary({
        addons: {},
        quoteResponse: { addonPrices: { gadget: 18.75 } },
      }),
    ).toEqual({ labels: [], prices: [], total: 0, lines: [] });
  });

  it('handles a null quoteResponse without throwing', () => {
    const summary = buildSelectedTravelAddonSummary({
      addons: { gadget: true },
      quoteResponse: null,
    });
    expect(summary.labels).toEqual(['Gadget']);
    expect(summary.prices).toEqual([0]);
  });

  it('rounds the total to 2dp to avoid floating-point noise in the displayed sum', () => {
    const summary = buildSelectedTravelAddonSummary({
      addons: { gadget: true, businessCover: true, golfCover: true },
      quoteResponse: {
        addonPrices: { gadget: 10.1, businessCover: 20.2, golfCover: 30.3 },
      },
    });
    expect(summary.total).toBe(60.6);
  });

  it('ignores keys that exist in `addons` but are not in the TRAVEL_ADDONS catalogue', () => {
    const summary = buildSelectedTravelAddonSummary({
      addons: { gadget: true, mysteryFutureAddon: true },
      quoteResponse: {
        addonPrices: { gadget: 18.75, mysteryFutureAddon: 99 },
      },
    });
    expect(summary.labels).toEqual(['Gadget']);
    expect(summary.lines.find((l) => l.key === 'mysteryFutureAddon')).toBeUndefined();
  });

  it('exports a TRAVEL_ADDONS catalogue that includes every addon we display on Step5', () => {
    // Cross-step parity guard. If a new addon is added to the
    // catalogue but a price source forgets to emit it, callers
    // still see the line (with price 0); but if a future refactor
    // accidentally drops `gadget` from the catalogue, this test
    // fails so the regression is caught before deploy.
    const keys = TRAVEL_ADDONS.map((addon) => addon.key);
    expect(keys).toContain('gadget');
    expect(keys).toContain('winterSports');
    expect(keys).toContain('businessCover');
    expect(keys).toContain('golfCover');
    expect(keys).toContain('terrorism');
    expect(keys).toContain('sportsEquipment');
    expect(keys).toContain('wedding');
  });
});

describe('readTravelBreakdownLines', () => {
  it('passes the underwriting profit loading line through (ADR-0035)', () => {
    // Regression: the sidebar filter used to drop any line whose `kind`
    // was not base/addon/tax/fee/total, so the 2% "Premium adjustment"
    // line vanished from the customer summary and the rows no longer
    // added up to the total (adding a +€10 add-on appeared to raise the
    // total by ~€11). The loading line MUST survive the projection.
    const lines = readTravelBreakdownLines({
      primaryOption: {
        breakdown: {
          lines: [
            { code: 'base', label: 'Base premium', amount: 100, kind: 'base' },
            { code: 'addon.golfCover', label: 'Golf cover', amount: 10, kind: 'addon' },
            { code: 'loading.uwProfit', label: 'Premium adjustment', amount: 2.2, kind: 'loading' },
            { code: 'tax.ipt', label: 'Insurance premium tax', amount: 10.1, kind: 'tax' },
            { code: 'fee.admin', label: 'Admin fee', amount: 7, kind: 'fee' },
            { code: 'total', label: 'Total', amount: 129.3, kind: 'total' },
          ],
        },
      },
    });

    const loading = lines.find((l) => l.code === 'loading.uwProfit');
    expect(loading).toEqual({ code: 'loading.uwProfit', label: 'Premium adjustment', amount: 2.2, kind: 'loading' });
    // base + addon + loading + tax + fee reconciles to the total row.
    const total = lines.find((l) => l.kind === 'total')!.amount;
    const sum = lines
      .filter((l) => l.kind !== 'total')
      .reduce((acc, l) => acc + l.amount, 0);
    expect(Number(sum.toFixed(2))).toBe(total);
  });
});
