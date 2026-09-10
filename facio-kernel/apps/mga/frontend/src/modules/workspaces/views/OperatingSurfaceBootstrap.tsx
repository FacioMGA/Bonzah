import React, { useEffect, useState } from 'react';
import { Button } from '@/src/shared/ui';
import { installSelectedTenant } from '@/src/shared/lib/tenant/runtimeProfile';
import { clearOperatingSession, platformApi, retainSelectedSession } from '../api/platformClient';

/** Resolve the selected workspace before importing module-scoped wizard defaults. */
export function OperatingSurfaceBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void (async () => {
      if (!localStorage.getItem('platform_token')) {
        const session = await platformApi.authSession();
        if (!active) return;
        localStorage.setItem('platform_token', session.token);
      }
      await platformApi.session(controller.signal);
      const id = localStorage.getItem('active_operating_tenant_id');
      const requestedWorkspace = new URLSearchParams(window.location.search).get('workspace');
      if (requestedWorkspace && requestedWorkspace !== id)
        throw new Error(
          'This journey belongs to a different workspace. Select that workspace before reopening it.',
        );
      if (!id)
        throw new Error('Select an authorized workspace before opening this insurance journey.');
      const selected = await platformApi.select(id);
      if (!active) return;
      installSelectedTenant(selected.tenant);
      retainSelectedSession(selected);
      setReady(true);
    })().catch((failure: unknown) => {
      if (active)
        setError(
          failure instanceof Error ? failure.message : 'Workspace access could not be verified.',
        );
    });
    const changed = (event: StorageEvent) => {
      if (['platform_token', 'active_operating_tenant_id'].includes(event.key || ''))
        window.location.reload();
    };
    const logout = () => {
      void platformApi
        .logout()
        .then(() => {
          clearOperatingSession();
          localStorage.removeItem('platform_token');
          window.location.assign('/workspaces');
        })
        .catch(() => {
          setReady(false);
          setError('Sign-out could not be confirmed. Retry the access check.');
        });
    };
    window.addEventListener('storage', changed);
    window.addEventListener('facio:platform-logout', logout);
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener('storage', changed);
      window.removeEventListener('facio:platform-logout', logout);
    };
  }, [retry]);
  if (ready) return <>{children}</>;
  return (
    <main className="h-screen grid place-items-center bg-brand-canvas p-6">
      <div className="ui-card ui-card-pad max-w-lg space-y-4">
        <h1 className="text-2xl font-black">Insurance workspace</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <p className="text-sm text-slate-600">
              This journey requires its authorized operating workspace. No customer configuration is
              inferred from the address.
            </p>
            <a href="/workspaces" className="block underline font-bold">
              Sign in and select workspace
            </a>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setError('');
                setRetry((value) => value + 1);
              }}
            >
              Retry access check
            </Button>
          </>
        ) : (
          <p role="status">Verifying the selected insurance workspace…</p>
        )}
      </div>
    </main>
  );
}
