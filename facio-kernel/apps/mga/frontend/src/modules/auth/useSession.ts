import React from 'react';

import type { AppUser } from '@/src/shared/types/session';
import { parseUser } from './session';

type UseSessionResult = {
  isAuthenticated: boolean;
  user: AppUser | null;
  handleLogin: (token: string, userData: unknown) => void;
  syncUser: (userData: unknown) => void;
  handleLogout: () => void;
};

export const SESSION_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_ACTIVITY_THROTTLE_MS = 30 * 1000;
const SESSION_LAST_ACTIVITY_KEY = 'facio.session.lastActivityAt';
const SESSION_LOGOUT_REASON_KEY = 'facio.session.logoutReason';
const SESSION_USER_UPDATED_EVENT = 'facio:user_info_updated';

function nowMs(): number {
  return Date.now();
}

function readLastActivity(): number {
  const raw = Number(localStorage.getItem(SESSION_LAST_ACTIVITY_KEY) || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function markSessionActivity(at = nowMs()) {
  localStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(at));
  localStorage.removeItem(SESSION_LOGOUT_REASON_KEY);
}

function readStoredUser(): AppUser | null {
  const savedUser = localStorage.getItem('user_info');
  if (!savedUser) return null;
  try {
    return parseUser(JSON.parse(savedUser));
  } catch {
    return null;
  }
}

function notifyUserUpdated(): void {
  window.dispatchEvent(new Event(SESSION_USER_UPDATED_EVENT));
}

export function useSession(): UseSessionResult {
  const [isAuthenticated, setIsAuthenticated] = React.useState(() => Boolean(localStorage.getItem('auth_token')));
  const [user, setUser] = React.useState<AppUser | null>(() => readStoredUser());

  const handleLogin = React.useCallback((token: string, userData: unknown) => {
    if (token) localStorage.setItem('auth_token', token);
    markSessionActivity();
    setIsAuthenticated(true);
    const parsed = parseUser(userData);
    if (parsed) {
      localStorage.setItem('user_info', JSON.stringify(parsed));
    }
    setUser(parsed);
    notifyUserUpdated();
  }, []);

  const syncUser = React.useCallback((userData: unknown) => {
    const parsed = parseUser(userData);
    if (parsed) {
      localStorage.setItem('user_info', JSON.stringify(parsed));
    }
    setUser(parsed);
    notifyUserUpdated();
  }, []);

  const handleLogout = React.useCallback(() => {
    if (localStorage.getItem('platform_token')) {
      window.dispatchEvent(new Event('facio:platform-logout'));
      return;
    }
    localStorage.removeItem('auth_token');
    ['platform_token', 'active_operating_tenant_id', 'active_operating_tenant_slug', 'active_tenant_id'].forEach(key => localStorage.removeItem(key));
    localStorage.removeItem('user_info');
    localStorage.removeItem(SESSION_LAST_ACTIVITY_KEY);
    setIsAuthenticated(false);
    setUser(null);
    notifyUserUpdated();
  }, []);

  React.useEffect(() => {
    if (!isAuthenticated) return undefined;

    if (!readLastActivity()) markSessionActivity();
    let lastWriteAt = 0;
    const recordActivity = () => {
      const at = nowMs();
      if (at - lastWriteAt < SESSION_ACTIVITY_THROTTLE_MS) return;
      lastWriteAt = at;
      markSessionActivity(at);
    };

    const expireIfIdle = () => {
      const lastActivityAt = readLastActivity();
      const idleForMs = lastActivityAt ? nowMs() - lastActivityAt : 0;
      if (idleForMs < SESSION_INACTIVITY_TIMEOUT_MS) return;
      localStorage.setItem(SESSION_LOGOUT_REASON_KEY, 'inactivity');
      handleLogout();
    };

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    for (const eventName of events) {
      window.addEventListener(eventName, recordActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', recordActivity);
    const interval = window.setInterval(expireIfIdle, 30 * 1000);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'auth_token' || event.newValue) return;
      if (localStorage.getItem('platform_token')) {
        // Workspace selection is shared across tabs. Returning to the directory
        // clears only the operating session; it is not organization sign-out.
        setIsAuthenticated(false);
        setUser(null);
        notifyUserUpdated();
      } else handleLogout();
    };
    const onUserUpdated = () => {
      setIsAuthenticated(Boolean(localStorage.getItem('auth_token')));
      setUser(readStoredUser());
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(SESSION_USER_UPDATED_EVENT, onUserUpdated);

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, recordActivity);
      }
      document.removeEventListener('visibilitychange', recordActivity);
      window.clearInterval(interval);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SESSION_USER_UPDATED_EVENT, onUserUpdated);
    };
  }, [handleLogout, isAuthenticated]);

  return { isAuthenticated, user, handleLogin, syncUser, handleLogout };
}
