import React, { lazy, Suspense } from 'react';
import '@/src/shared/lib/observability/sentry';
import { renderRoot } from '@/src/shared/app/renderRoot';
import { PublicSurfaceBootstrap } from '@/src/modules/workspaces';
const AppPublic = lazy(() => import('@/src/surfaces/public/AppPublic'));
renderRoot(() => <PublicSurfaceBootstrap><Suspense fallback={<p role="status">Opening insurance journey…</p>}><AppPublic /></Suspense></PublicSurfaceBootstrap>);
