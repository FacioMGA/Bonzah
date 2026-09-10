import React from 'react';
import { Button } from '@/src/shared/ui';

import { logger } from '@/src/shared/lib/logger';
import { captureFrontendException } from '@/src/shared/lib/observability/sentry';
import { attemptStaleChunkRecovery } from '@/src/shared/app/staleChunkRecovery';

function tokenFromUrl(): string | null {
  try {
    const path = window.location.pathname || '';
    const m = path.match(/\/quote\/([^/]+)/);
    if (m?.[1]) return decodeURIComponent(m[1]);
    const sp = new URLSearchParams(window.location.search || '');
    const ref = sp.get('ref');
    return ref ? String(ref) : null;
  } catch {
    return null;
  }
}

type BoundaryProps = {
  children: React.ReactNode;
};

type BoundaryState =
  | { hasError: false }
  | { hasError: true; error: Error; componentStack?: string; occurredAt: number };

class BoundaryImpl extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { hasError: true, error, occurredAt: Date.now() };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // ABY-240 — stale-chunk failures from a fresh deploy reach
    // here when React.lazy / Suspense surfaces the rejected
    // import as a render-time throw. Triggering a one-shot
    // reload from the fresh `index.html` is strictly better than
    // showing the "Something went wrong" UI for a problem the
    // user did not cause and a reload will silently fix.
    if (attemptStaleChunkRecovery(error)) return;

    // Best-effort logging; avoid crashing further.
    try {
      // A stale-chunk failure that was recovered returned above. Reaching the
      // boundary means recovery was unavailable or already exhausted, so the
      // persistent failure must be reported like any other unhandled UI error.
      captureFrontendException(error, {
        componentStack: info.componentStack,
        route: typeof window !== 'undefined' ? window.location.pathname : '',
      });
      logger.error('[SessionAwareErrorBoundary] Unhandled UI error', error, info);
    } catch {
      // ignore
    }
    this.setState((s) =>
      s.hasError ? { ...s, componentStack: info.componentStack || undefined } : s,
    );
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const token = tokenFromUrl();
    const error = this.state.error;

    return (
      <div className="min-h-screen bg-ui-canvas text-ui-text">
        <div className="mx-auto max-w-2xl px-6 py-16">
          <div className="rounded-3xl border border-ui-border bg-ui-surface p-8 shadow-xl">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
              <p className="text-sm text-ui-subtext">
                We saved your progress where possible. You can reload the session to recover.
              </p>
            </div>

            <div className="mt-6 space-y-3 text-sm">
              <div className="rounded-2xl bg-ui-muted p-4">
                <div className="font-semibold">Context</div>
                <div className="mt-2 grid gap-1">
                  <div>
                    <span className="text-ui-subtext">Route:</span>{' '}
                    <span className="font-mono">{typeof window !== 'undefined' ? window.location.pathname : ''}</span>
                  </div>
                  {token && (
                    <div>
                      <span className="text-ui-subtext">Session:</span>{' '}
                      <span className="font-mono break-all">{token}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-ui-border p-4">
                <div className="font-semibold">Error</div>
                <div className="mt-2 font-mono text-xs whitespace-pre-wrap break-words">
                  {error?.name}: {error?.message}
                </div>
              </div>

              {this.state.componentStack && (
                <details className="rounded-2xl border border-ui-border p-4">
                  <summary className="cursor-pointer font-semibold">Component stack</summary>
                  <pre className="mt-3 overflow-auto text-xs text-ui-subtext whitespace-pre-wrap">
                    {this.state.componentStack}
                  </pre>
                </details>
              )}
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                variant="primary"
                onClick={() => {
                  window.location.reload();
                }}
              >
                Reload session
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  try {
                    if (token && typeof window !== 'undefined') {
                      window.localStorage.removeItem(`facio.wizard.v2:${token}`);
                    }
                  } catch {
                    // ignore
                  }
                  window.location.reload();
                }}
              >
                Clear local snapshot
              </Button>
              <Button variant="ghost" onClick={() => (window.location.href = '/')}>
                Go home
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export function SessionAwareErrorBoundary({ children }: { children: React.ReactNode }) {
  return <BoundaryImpl children={children} />;
}
