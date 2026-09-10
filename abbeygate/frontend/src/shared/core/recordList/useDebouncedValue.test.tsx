/* @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  it('does not debounce the first render (URL hydration)', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 250));
    expect(result.current.debounced).toBe('a');
    expect(result.current.isDebouncing).toBe(false);
  });

  it('debounces subsequent updates', () => {
    vi.useFakeTimers();

    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 250), { initialProps: { v: 'a' } });
    expect(result.current.debounced).toBe('a');

    rerender({ v: 'b' });
    expect(result.current.debounced).toBe('a');
    expect(result.current.isDebouncing).toBe(true);

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(result.current.debounced).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.debounced).toBe('b');
    expect(result.current.isDebouncing).toBe(false);

    vi.useRealTimers();
  });
});

