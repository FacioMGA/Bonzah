/**
 * Pure helpers for the BO Coverage tab's optimistic-update step.
 *
 * Per `backend/modules/policy/app/COVERAGE_SELECTION_CONTRACT.md`,
 * `coverageSelection.selected` is the operator's *explicit overrides*
 * — sparse by design. Catalog/program defaults live in
 * `coverageSelection.defaults.selected` and are merged into each row's
 * effective `item.selected` server-side by `resolvedDefaultSelection`
 * (`backend/modules/policy/app/coverageOptionsView.ts`).
 *
 * The optimistic UI must therefore NOT overwrite a row's `selected`
 * boolean from a sparse map: codes not present in `next.selected` must
 * keep whatever effective truth the server already merged into
 * `item.selected`. Otherwise toggling one coverage visually unchecks
 * every default-on coverage until the next refetch heals the view —
 * the exact regression this helper exists to prevent.
 */

export type SelectionMap = Record<string, boolean>;
export type ParamMap = Record<string, Record<string, unknown>>;

export type CoverageSelectionDelta = {
  selected: SelectionMap;
  params: ParamMap;
};

type OptimisticItem = {
  code: string;
  selected: boolean;
  params: Record<string, unknown>;
};

type OptimisticSection = {
  items: OptimisticItem[];
};

type OptimisticView = {
  savedSelection?: Record<string, unknown>;
  sections: OptimisticSection[];
};

export function applySelectionOptimistically<View extends OptimisticView>(
  prev: View | null,
  next: CoverageSelectionDelta,
): View | null {
  if (!prev) return prev;
  return {
    ...prev,
    savedSelection: {
      ...(prev.savedSelection || {}),
      selected: next.selected,
      params: next.params,
    },
    sections: prev.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        selected: Object.prototype.hasOwnProperty.call(next.selected, item.code)
          ? Boolean(next.selected[item.code])
          : item.selected,
        params: next.params[item.code] || item.params,
      })),
    })),
  };
}
