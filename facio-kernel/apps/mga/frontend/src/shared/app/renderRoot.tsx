import React from 'react';
import ReactDOM from 'react-dom/client';
import { reactErrorHandler } from '@sentry/react';
import { QueryClientProvider } from '@tanstack/react-query';

import { SessionAwareErrorBoundary } from '@/src/shared/app/SessionAwareErrorBoundary';
import { GlobalTabIndicator } from '@/src/shared/app/GlobalTabIndicator';
import { installStaleChunkRecovery, attemptStaleChunkRecovery, shouldSuppressStaleChunkSentryReport } from '@/src/shared/app/staleChunkRecovery';
import { queryClient } from '@/src/shared/lib/queryClient';
import '@/src/shared/styles/index.css';

function staleChunkAwareReactErrorHandler(
  callback?: (error: unknown, errorInfo: React.ErrorInfo) => void,
) {
  const baseHandler = reactErrorHandler(callback);
  return (error: unknown, errorInfo: React.ErrorInfo) => {
    // Recover before suppressing/reporting — React 19 surfaces some lazy-import
    // failures only through these handlers, not as unhandled rejections.
    if (attemptStaleChunkRecovery(error)) return;
    if (shouldSuppressStaleChunkSentryReport(error)) return;
    baseHandler(error, errorInfo);
  };
}

export function renderRoot(AppComponent: React.ComponentType) {
  // ABY-240 — install stale-chunk recovery BEFORE React mounts so
  // any lazy-import failure during the very first render is also
  // caught and one-shot-reloads the page on the fresh build.
  installStaleChunkRecovery();

  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Could not find root element to mount to');
  }

  const root = ReactDOM.createRoot(rootElement, {
    onUncaughtError: staleChunkAwareReactErrorHandler(),
    onCaughtError: staleChunkAwareReactErrorHandler(),
    onRecoverableError: staleChunkAwareReactErrorHandler(),
  });
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <SessionAwareErrorBoundary>
          <GlobalTabIndicator />
          <AppComponent />
        </SessionAwareErrorBoundary>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}
