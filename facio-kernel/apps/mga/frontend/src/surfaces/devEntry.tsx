import { PublicSurfaceBootstrap } from '@/src/modules/workspaces';
import React, { lazy, Suspense } from 'react';
import { PlatformEntry } from '@/src/surfaces/bo/PlatformEntry';
const AppClient = lazy(() => import('@/src/surfaces/client/AppClient'));
const AppPublic = lazy(() => import('@/src/surfaces/public/AppPublic'));
import { renderRoot } from '@/src/shared/app/renderRoot';

function resolveSurfaceApp(pathname: string) {
  const path = String(pathname || '/');
  if (
    path.startsWith('/quote') ||
    path.startsWith('/get-auto-quote') ||
    path.startsWith('/questionnaire') ||
    path.startsWith('/client/public') ||
    path.startsWith('/fnol') ||
    path.startsWith('/verify-email') ||
    path.startsWith('/auth/reset')
  ) {
    return () => <PublicSurfaceBootstrap><AppPublic /></PublicSurfaceBootstrap>;
  }
  if (path.startsWith('/client')) {
    return AppClient;
  }
  return PlatformEntry;
}

const SurfaceApp = resolveSurfaceApp(window.location.pathname);
renderRoot(() => (
  <Suspense fallback={<p role="status">Opening workspace…</p>}>
    <SurfaceApp />
  </Suspense>
));
