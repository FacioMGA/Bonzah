/**
 * Per-product flow contract conformance.
 *
 * Lives next to the flow it exercises (Amendment #6 — `shared/lib/wizard/` may
 * not import `@/src/products/**`). When more product flows arrive, copy
 * this file alongside each one. If/when a shared `flowRegistry` is
 * introduced, fold these per-product tests into a single shared spec that
 * iterates the registry.
 */

import { describe, expect, it } from 'vitest';
import { motorFlow } from '../motor.flow';

const flows = [motorFlow];

describe('motor flow contracts', () => {
  it('all step ids are unique per flow', () => {
    for (const flow of flows) {
      const ids = flow.steps.map((step) => step.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('all transition targets exist', () => {
    for (const flow of flows) {
      const stateKeys = new Set(Object.keys(flow.states));
      for (const state of Object.values(flow.states)) {
        const on = state.on || {};
        for (const transitionOrList of Object.values(on)) {
          const list = Array.isArray(transitionOrList) ? transitionOrList : [transitionOrList];
          for (const transition of list) {
            expect(stateKeys.has(transition.target)).toBe(true);
          }
        }
      }
    }
  });
});
