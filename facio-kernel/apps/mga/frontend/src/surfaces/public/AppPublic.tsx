import React, { Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import '@/src/products';
import { useSession } from '@/src/modules/auth/useSession';
import Login from '@/src/modules/auth/LoginPage';
import { buildPublicSurfaceRouteElements } from '@/src/surfaces/public/router';
import { initMarkerIo } from '@/src/shared/lib/marker/initMarkerIo';

const SurfaceScope = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const isCustomerSurface =
      pathname.startsWith('/client') ||
      pathname.startsWith('/questionnaire') ||
      pathname.startsWith('/get-auto-quote') ||
      pathname.startsWith('/quote/') ||
      pathname.startsWith('/quote') ||
      pathname.startsWith('/fnol');

    const surface = isCustomerSurface ? 'customer' : 'bo';
    document.body.dataset.surface = surface;
    document.documentElement.dataset.surface = surface;
  }, [pathname]);

  return null;
};

const AppPublic: React.FC = () => {
  const { isAuthenticated, handleLogin } = useSession();

  useEffect(() => {
    initMarkerIo();
  }, []);

  const LoginEntry = () => {
    const loc = useLocation();
    const sp = new URLSearchParams(loc.search || '');
    const next = String(sp.get('next') || '').trim();
    return !isAuthenticated ? <Login onLogin={handleLogin} /> : <Navigate to={next || '/quote/start'} replace />;
  };

  return (
    <Router>
      <SurfaceScope />
      <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="text-slate-400 font-bold">Loading...</div></div>}>
        <Routes>
          {buildPublicSurfaceRouteElements({ LoginEntry })}
          <Route path="*" element={<Navigate to="/quote/start" replace />} />
        </Routes>
      </Suspense>
    </Router>
  );
};

export default AppPublic;
