/* @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_INACTIVITY_TIMEOUT_MS, useSession } from '../useSession';

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    get length() {
      return store.size;
    },
  } satisfies Storage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });
}

describe('useSession inactivity timeout', () => {
  beforeEach(() => {
    installLocalStorageMock();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T12:00:00.000Z'));
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('records login activity and expires an idle bearer-token session', () => {
    const { result } = renderHook(() => useSession());

    act(() => {
      result.current.handleLogin('token-1', { id: 'u1', email: 'user@example.com', role: 'CUSTOMER' });
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(localStorage.getItem('auth_token')).toBe('token-1');
    expect(localStorage.getItem('facio.session.lastActivityAt')).toBe(String(Date.now()));

    act(() => {
      vi.advanceTimersByTime(SESSION_INACTIVITY_TIMEOUT_MS + 30_000);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('facio.session.logoutReason')).toBe('inactivity');
  });

  it('keeps the session alive when user activity is recorded', () => {
    const { result } = renderHook(() => useSession());

    act(() => {
      result.current.handleLogin('token-2', { id: 'u2', email: 'user@example.com', role: 'CUSTOMER' });
      vi.advanceTimersByTime(20 * 60 * 1000);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
      vi.advanceTimersByTime(20 * 60 * 1000);
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(localStorage.getItem('auth_token')).toBe('token-2');
  });
});
