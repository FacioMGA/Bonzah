/* @vitest-environment happy-dom */
/**
 * useFnolGuidedFlowCore — pure React FNOL guided-flow state machine.
 *
 * Owns step navigation + per-field "should I show this error yet" logic
 * (the customer doesn't see "Required" until they touch the field OR
 * try to advance). No network. No DOM beyond standard React state.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';

import { useFnolGuidedFlowCore } from '../useFnolGuidedFlowCore';

type Form = { incidentType: string; description: string; date: string };

function useHarness(opts: {
  totalSteps: number;
  canContinueByStep: Record<number, boolean>;
  computedFieldErrors: Record<string, string | undefined>;
  groupedFieldSources?: Record<string, Array<keyof Form>>;
  initial?: Partial<Form>;
}) {
  const [formState, setFormState] = useState<Form>({
    incidentType: '',
    description: '',
    date: '',
    ...opts.initial,
  });
  const core = useFnolGuidedFlowCore<Form>({
    totalSteps: opts.totalSteps,
    canContinueByStep: opts.canContinueByStep,
    computedFieldErrors: opts.computedFieldErrors,
    groupedFieldSources: opts.groupedFieldSources,
    formState,
    setFormState,
  });
  return { core, formState };
}

describe('useFnolGuidedFlowCore', () => {
  it('starts at step 1 with no validation errors visible', () => {
    const { result } = renderHook(() =>
      useHarness({
        totalSteps: 3,
        canContinueByStep: { 1: true },
        computedFieldErrors: { incidentType: 'Required' },
      }),
    );
    expect(result.current.core.step).toBe(1);
    expect(result.current.core.visibleFieldErrors).toEqual({});
    expect(result.current.core.showValidationErrors).toBe(false);
  });

  it('advances to the next step when canContinueByStep allows', () => {
    const { result } = renderHook(() =>
      useHarness({
        totalSteps: 3,
        canContinueByStep: { 1: true, 2: true },
        computedFieldErrors: {},
      }),
    );
    act(() => {
      result.current.core.nextStep();
    });
    expect(result.current.core.step).toBe(2);
  });

  it('blocks advance and flips showValidationErrors when canContinueByStep is false', () => {
    const { result } = renderHook(() =>
      useHarness({
        totalSteps: 3,
        canContinueByStep: { 1: false },
        computedFieldErrors: { incidentType: 'Required' },
      }),
    );
    act(() => {
      result.current.core.nextStep();
    });
    expect(result.current.core.step).toBe(1);
    expect(result.current.core.showValidationErrors).toBe(true);
    expect(result.current.core.visibleFieldErrors).toEqual({ incidentType: 'Required' });
  });

  it('clamps the step into [1, totalSteps] when totalSteps shrinks', () => {
    const { result, rerender } = renderHook(
      (props: { total: number }) =>
        useHarness({
          totalSteps: props.total,
          canContinueByStep: { 1: true, 2: true, 3: true },
          computedFieldErrors: {},
        }),
      { initialProps: { total: 3 } },
    );
    act(() => {
      result.current.core.nextStep();
      result.current.core.nextStep();
    });
    expect(result.current.core.step).toBe(3);

    rerender({ total: 2 });
    expect(result.current.core.step).toBe(2);
  });

  it('prevStep never goes below 1', () => {
    const { result } = renderHook(() =>
      useHarness({
        totalSteps: 3,
        canContinueByStep: { 1: true },
        computedFieldErrors: {},
      }),
    );
    act(() => {
      result.current.core.prevStep();
    });
    expect(result.current.core.step).toBe(1);
  });

  it('setFormTracked reveals errors only for fields whose value actually changed', () => {
    const { result } = renderHook(() =>
      useHarness({
        totalSteps: 3,
        canContinueByStep: { 1: true },
        computedFieldErrors: { incidentType: 'Required', description: 'Required' },
      }),
    );
    expect(result.current.core.visibleFieldErrors).toEqual({});
    act(() => {
      result.current.core.setFormTracked((prev) => ({ ...prev, incidentType: 'collision' }));
    });
    // The touched field surfaces its (still-computed) error; the
    // untouched sibling stays silent until the user advances.
    expect(result.current.core.visibleFieldErrors).toHaveProperty('incidentType');
    expect(result.current.core.visibleFieldErrors).not.toHaveProperty('description');
  });

  it("groupedFieldSources lets a derived error become visible once any source field changes", () => {
    const { result } = renderHook(() =>
      useHarness({
        totalSteps: 3,
        canContinueByStep: { 1: true },
        computedFieldErrors: { lossWindow: 'Required' },
        groupedFieldSources: { lossWindow: ['date'] },
      }),
    );
    expect(result.current.core.visibleFieldErrors).toEqual({});
    act(() => {
      result.current.core.setFormTracked((prev) => ({ ...prev, date: '2026-05-20' }));
    });
    expect(result.current.core.visibleFieldErrors).toEqual({ lossWindow: 'Required' });
  });

  it('showValidationErrors=true reveals ALL computed errors at once (advance-attempt gate)', () => {
    const { result } = renderHook(() =>
      useHarness({
        totalSteps: 3,
        canContinueByStep: { 1: false },
        computedFieldErrors: { a: 'A required', b: 'B required' },
      }),
    );
    act(() => {
      result.current.core.nextStep();
    });
    expect(result.current.core.visibleFieldErrors).toEqual({ a: 'A required', b: 'B required' });
  });
});
