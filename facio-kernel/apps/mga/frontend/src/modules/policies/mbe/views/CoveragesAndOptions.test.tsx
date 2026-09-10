import { describe, expect, it } from 'vitest';
import { applySelectionOptimistically } from './coverageSelectionMerge';

/**
 * Behavioural pin for the BO Coverage tab.
 *
 * The component intentionally separates two truths (kept for the
 * cutover note below):
 *   - checkbox truth = effective `item.selected` (server-merged
 *     defaults + overrides via `resolvedDefaultSelection`)
 *   - lifecycle badge truth = `endorsementInstance.status`
 *
 * On top of that, the optimistic-update step must respect the
 * `coverageSelection.selected` contract from
 * `backend/modules/policy/app/COVERAGE_SELECTION_CONTRACT.md`:
 * `selected` is sparse (explicit overrides only). Optimistic merges
 * MUST preserve `item.selected` for codes not present in the next
 * `selected` map — otherwise toggling one coverage visually unchecks
 * every default-on coverage until the next refetch heals the view.
 */

type ItemFixture = {
  code: string;
  selected: boolean;
  params: Record<string, unknown>;
  premiumImpact: number | null;
};

type ViewFixture = {
  savedSelection: { selected: Record<string, boolean>; params: Record<string, Record<string, unknown>>; programId: string };
  sections: Array<{ id: string; title: string; items: ItemFixture[] }>;
};

function buildView(): ViewFixture {
  return {
    savedSelection: {
      programId: 'prog_1',
      selected: {},
      params: {},
    },
    sections: [
      {
        id: 'liability',
        title: 'Liability',
        items: [
          { code: 'HOME-LIABILITY', selected: true, params: {}, premiumImpact: null },
        ],
      },
      {
        id: 'assistance',
        title: 'Assistance',
        items: [
          { code: 'HOME-EMERGENCY-TRAVEL', selected: true, params: {}, premiumImpact: null },
          { code: 'HOME-EUROP-ASSISTANCE', selected: false, params: {}, premiumImpact: null },
        ],
      },
    ],
  };
}

describe('CoveragesAndOptions contract', () => {
  it('documents that saved selection and applied status are distinct truths', () => {
    const savedSelection = { 'COV-ROADSIDE': false };
    const appliedStatuses = [{ code: 'COV-ROADSIDE', status: 'APPLIED' }];

    const selectedNow = Boolean(savedSelection['COV-ROADSIDE']);
    const appliedNow = appliedStatuses.some((inst) => inst.code === 'COV-ROADSIDE' && (inst.status === 'APPLIED' || inst.status === 'PENDING'));

    expect(selectedNow).toBe(false);
    expect(appliedNow).toBe(true);
    expect(selectedNow).not.toBe(appliedNow);
  });
});

describe('applySelectionOptimistically', () => {
  it('preserves default-on rows when toggling a single default-off coverage on', () => {
    const view = buildView();
    const next = {
      selected: { 'HOME-EUROP-ASSISTANCE': true },
      params: { 'HOME-EUROP-ASSISTANCE': { provider: 'Europ Assistance', premium_eur: 12 } },
    };

    const result = applySelectionOptimistically(view, next);
    if (!result) throw new Error('result must not be null');

    const flatItems = result.sections.flatMap((section) => section.items);
    const byCode = Object.fromEntries(flatItems.map((item) => [item.code, item.selected]));

    expect(byCode['HOME-LIABILITY']).toBe(true);
    expect(byCode['HOME-EMERGENCY-TRAVEL']).toBe(true);
    expect(byCode['HOME-EUROP-ASSISTANCE']).toBe(true);
  });

  it('flips a row to false only when its code is explicitly present and falsy', () => {
    const view = buildView();
    const next = {
      selected: { 'HOME-EMERGENCY-TRAVEL': false },
      params: {},
    };

    const result = applySelectionOptimistically(view, next);
    if (!result) throw new Error('result must not be null');

    const flatItems = result.sections.flatMap((section) => section.items);
    const byCode = Object.fromEntries(flatItems.map((item) => [item.code, item.selected]));

    expect(byCode['HOME-EMERGENCY-TRAVEL']).toBe(false);
    expect(byCode['HOME-LIABILITY']).toBe(true);
    expect(byCode['HOME-EUROP-ASSISTANCE']).toBe(false);
  });

  it('persists the sparse selection map as the new savedSelection.selected', () => {
    const view = buildView();
    const next = {
      selected: { 'HOME-EUROP-ASSISTANCE': true },
      params: { 'HOME-EUROP-ASSISTANCE': { provider: 'Europ Assistance', premium_eur: 12 } },
    };

    const result = applySelectionOptimistically(view, next);
    if (!result) throw new Error('result must not be null');

    expect(result.savedSelection.selected).toEqual({ 'HOME-EUROP-ASSISTANCE': true });
    expect(result.savedSelection.programId).toBe('prog_1');
  });

  it('returns prev untouched when prev is null', () => {
    const result = applySelectionOptimistically(null, { selected: {}, params: {} });
    expect(result).toBeNull();
  });

  it('preserves non-overridden item params and updates only the overridden ones', () => {
    const view = buildView();
    view.sections[1].items[0].params = { returnTicketLimit: 350 };
    const next = {
      selected: { 'HOME-EUROP-ASSISTANCE': true },
      params: { 'HOME-EUROP-ASSISTANCE': { provider: 'Europ Assistance' } },
    };

    const result = applySelectionOptimistically(view, next);
    if (!result) throw new Error('result must not be null');

    const emergency = result.sections[1].items.find((i) => i.code === 'HOME-EMERGENCY-TRAVEL');
    const europ = result.sections[1].items.find((i) => i.code === 'HOME-EUROP-ASSISTANCE');
    expect(emergency?.params).toEqual({ returnTicketLimit: 350 });
    expect(europ?.params).toEqual({ provider: 'Europ Assistance' });
  });
});
