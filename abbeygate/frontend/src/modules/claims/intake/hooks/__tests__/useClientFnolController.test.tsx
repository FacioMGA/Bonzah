/**
 * useClientFnolController — surface smoke contract.
 *
 * The controller orchestrates ~470 LOC of FNOL intake (policy fetch,
 * navigation, uploads, submit) and depends on real-router params,
 * three API clients, and React Router context — a deep behavioural
 * test belongs at tier 2/3 (FNOL journey + integration).
 *
 * This tier-1 contract pins the hook's existence + canonical export
 * name so a rename/removal trips CI before FnolPage silently breaks.
 * Per-action proof lives in clientFnol.submit.test.ts and the motor
 * intake suites (motorRenderRules / motorGateFieldMap).
 */
import { describe, expect, it } from 'vitest';
import * as controllerModule from '../useClientFnolController';

describe('useClientFnolController — export surface', () => {
  it('exports the canonical useClientFnolController hook', () => {
    expect(typeof controllerModule.useClientFnolController).toBe('function');
  });
});
