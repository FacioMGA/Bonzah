import React, { Suspense, useEffect, useRef, useState } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import '@/src/products';
import { useSession } from '@/src/modules/auth/useSession';
import type { AppUser } from '@/src/shared/types/session';
import { isInternalRole } from '@/src/modules/auth/session';
import Login from '@/src/modules/auth/LoginPage';
import { usersApiClient } from '@/src/modules/auth/api/usersApiClient';
import { BoLayout } from '@/src/surfaces/bo/layout/BoLayout';
import { BoModeProvider, useBoMode } from '@/src/surfaces/bo/mode';
import { buildBoSurfaceRouteElements } from '@/src/surfaces/bo/router';
import { initMarkerIo } from '@/src/shared/lib/marker/initMarkerIo';
import { buildBoLoginTarget } from '@/src/surfaces/bo/protectedRouteTarget';

const SurfaceScope = () => {
  const { pathname } = useLocation();
  const { mode } = useBoMode();
  useEffect(() => {
    const isCustomerSurface = pathname.startsWith('/client');
    const surface = isCustomerSurface ? 'customer' : 'bo';
    document.body.dataset.surface = surface;
    document.documentElement.dataset.surface = surface;
    if (!isCustomerSurface) {
      document.body.dataset.appMode = mode;
      document.documentElement.dataset.appMode = mode;
    } else {
      delete document.body.dataset.appMode;
      delete document.documentElement.dataset.appMode;
    }
  }, [mode, pathname]);
  return null;
};

const BOProtectedRoute = ({
  children,
  isAuthenticated,
  user,
  onLogout,
}: {
  children: React.ReactElement;
  isAuthenticated: boolean;
  user: AppUser | null;
  onLogout: () => void;
}) => {
  const location = useLocation();
  if (!isAuthenticated) return <Navigate to={buildBoLoginTarget(location)} replace />;
  if (!user || !isInternalRole(user.role)) return <Navigate to="/client" replace />;
  return <BoLayout user={user} onLogout={onLogout}>{children}</BoLayout>;
};

const AppBo: React.FC = () => {
  const attemptedUserRefreshRef = useRef<Set<string>>(new Set());
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const saved = localStorage.getItem('facio.dashboardMonth');
    if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved;
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  });
  const { isAuthenticated, user, handleLogin, syncUser, handleLogout } = useSession();

  useEffect(() => {
    initMarkerIo();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('facio.dashboardMonth', selectedMonth);
    } catch {
      // ignore
    }
  }, [selectedMonth]);

  useEffect(() => {
    if (!isAuthenticated || !user || !isInternalRole(user.role) || Array.isArray(user.effectivePermissions)) {
      return;
    }

    const refreshKey = String(user.id || user.email || user.name || user.role || '').trim();
    if (refreshKey && attemptedUserRefreshRef.current.has(refreshKey)) {
      return;
    }
    if (refreshKey) {
      attemptedUserRefreshRef.current.add(refreshKey);
    }

    let cancelled = false;

    void usersApiClient.getCurrentUser()
      .then((payload) => {
        if (cancelled) return;
        if (!payload || typeof payload !== 'object') return;
        // `payload` is `ApiResponse<UnknownRecord>` (`{ success, data?, error? }`).
        // Access-control endpoints also return flat shapes — when `payload.data`
        // is absent, the user record sits on `payload` itself
        // (see `httpTransport.ts::isApiResponse`).
        const userRecord = payload.data && typeof payload.data === 'object'
          ? payload.data
          : payload;
        const candidate = userRecord as { effectivePermissions?: unknown };
        // Force `effectivePermissions: []` (rather than undefined) so the
        // refresh effect doesn't keep re-running when the backend omits
        // the field — the precondition above is
        // `Array.isArray(user.effectivePermissions)`.
        syncUser({
          ...userRecord,
          effectivePermissions: Array.isArray(candidate.effectivePermissions)
            ? candidate.effectivePermissions
            : [],
        });
      })
      .catch(() => {
        // Keep the cached user if the refresh fails.
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, syncUser, user]);

  const LoginEntry = () => {
    const loc = useLocation();
    const sp = new URLSearchParams(loc.search || '');
    const next = String(sp.get('next') || '').trim();
    return !isAuthenticated ? <Login onLogin={handleLogin} /> : <Navigate to={next || '/'} replace />;
  };

  const wrapBoProtected = React.useCallback((element: React.ReactElement) => (
    <BOProtectedRoute isAuthenticated={isAuthenticated} user={user} onLogout={handleLogout}>
      {element}
    </BOProtectedRoute>
  ), [handleLogout, isAuthenticated, user]);

  return (
    <Router>
      <BoModeProvider>
        <SurfaceScope />
        <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="text-slate-400 font-bold">Loading...</div></div>}>
          <Routes>
            <Route path="/login" element={<LoginEntry />} />
            {buildBoSurfaceRouteElements({
              wrapProtected: wrapBoProtected,
              dashboardProps: {
                user,
                selectedMonth,
                onMonthChange: setSelectedMonth,
                isInternalRole,
              },
            })}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BoModeProvider>
    </Router>
  );
};

export default AppBo;
