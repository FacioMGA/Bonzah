import React, { Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import '@/src/products';
import { useSession } from '@/src/modules/auth/useSession';
import type { AppUser } from '@/src/shared/types/session';
import Login from '@/src/modules/auth/LoginPage';
import { ClientLayout } from '@/src/surfaces/client/layout/ClientLayout';
import { buildClientSurfaceRouteElements } from '@/src/surfaces/client/router';
import { initMarkerIo } from '@/src/shared/lib/marker/initMarkerIo';

const SurfaceScope = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    const isCustomerSurface = pathname.startsWith('/client');
    const surface = isCustomerSurface ? 'customer' : 'bo';
    document.body.dataset.surface = surface;
    document.documentElement.dataset.surface = surface;
  }, [pathname]);
  return null;
};

const ClientProtectedRoute = ({
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
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <ClientLayout user={user} onLogout={onLogout}>{children}</ClientLayout>;
};

const AppClient: React.FC = () => {
  const { isAuthenticated, user, handleLogin, handleLogout } = useSession();

  useEffect(() => {
    initMarkerIo();
  }, []);

  const LoginEntry = () => {
    const loc = useLocation();
    const sp = new URLSearchParams(loc.search || '');
    const next = String(sp.get('next') || '').trim();
    return !isAuthenticated ? <Login onLogin={handleLogin} /> : <Navigate to={next || '/client'} replace />;
  };

  const wrapClientProtected = React.useCallback((element: React.ReactElement) => (
    <ClientProtectedRoute isAuthenticated={isAuthenticated} user={user} onLogout={handleLogout}>
      {element}
    </ClientProtectedRoute>
  ), [handleLogout, isAuthenticated, user]);

  return (
    <Router>
      <SurfaceScope />
      <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="text-slate-400 font-bold">Loading...</div></div>}>
        <Routes>
          <Route path="/login" element={<LoginEntry />} />
          {buildClientSurfaceRouteElements({ wrapProtected: wrapClientProtected })}
          <Route path="*" element={<Navigate to="/client" replace />} />
        </Routes>
      </Suspense>
    </Router>
  );
};

export default AppClient;
