import { Button } from '@/src/shared/ui';
import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import LoginPage from '@/src/modules/auth/LoginPage';
import { installSelectedTenant } from '@/src/shared/lib/tenant/runtimeProfile';
import {
  platformApi,
  PlatformError,
  clearOperatingSession,
  retainSelectedSession,
  type PlatformSession,
  WorkspacePicker,
} from '@/src/modules/workspaces';

// Import products only after the server profile has been installed: wizard defaults are module-scoped.
const OperatingApplication = lazy(() => import('@/src/surfaces/bo/AppBo'));

export function PlatformEntry() {
  const legacyStudio = /^\/studio\/?$/.test(window.location.pathname);
  return legacyStudio ? <LegacyStudioRedirect /> : <PlatformWorkspace />;
}

function LegacyStudioRedirect() {
  useEffect(() => {
    window.location.replace('/workspaces');
  }, []);
  return <Status message="Opening workspace selection…" />;
}

function PlatformWorkspace() {
  const [signedIn, setSignedIn] = useState(() => Boolean(localStorage.getItem('platform_token')));
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(signedIn);
  const [retry, setRetry] = useState(0);
  const [authConfig, setAuthConfig] = useState<{
    providers: Array<{ id: string; label: string }>;
    passwordLoginEnabled: boolean;
  } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const pickerPath = window.location.pathname === '/workspaces';
  const refresh = useCallback(async () => {
    setSession(await platformApi.session());
  }, []);
  const logout = useCallback(() => {
    void platformApi
      .logout()
      .then(() => {
        clearOperatingSession();
        localStorage.removeItem('platform_token');
        window.location.assign('/login');
      })
      .catch((failure) =>
        setError(failure instanceof Error ? failure.message : 'Sign-out could not be confirmed.'),
      );
  }, []);
  useEffect(() => {
    let active = true;
    setAuthLoading(true);
    void platformApi
      .authConfig()
      .then(async (config) => {
        if (!active) return;
        setAuthConfig(config);
        if (!localStorage.getItem('platform_token')) {
          try {
            const cookieSession = await platformApi.authSession();
            if (!active) return;
            localStorage.setItem('platform_token', cookieSession.token);
            setSignedIn(true);
          } catch (failure) {
            if (!(failure instanceof PlatformError && failure.status === 401)) throw failure;
          }
        }
      })
      .catch((failure) => {
        if (active)
          setError(failure instanceof Error ? failure.message : 'Sign-in options are unavailable.');
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
    void platformApi
      .session(controller.signal)
      .then(async (value) => {
        if (!active) return;
        setSession(value);
        const target = localStorage.getItem('active_operating_tenant_id');
        if (!pickerPath && target) {
          const selected = await platformApi.select(target);
          if (!active) return;
          installSelectedTenant(selected.tenant);
          retainSelectedSession(selected);
          setReady(true);
        } else {
          clearOperatingSession();
          if (target && !pickerPath)
            setError(
              'Your previous tenant is no longer in the authorized list. Select an available workspace.',
            );
        }
      })
      .catch((failure) => {
        if (!active) return;
        if (failure instanceof PlatformError && failure.status === 401) {
          clearOperatingSession();
          localStorage.removeItem('platform_token');
          setSignedIn(false);
        } else
          setError(
            failure instanceof Error ? failure.message : 'Workspace access could not be verified.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [signedIn, retry, pickerPath]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (['platform_token', 'active_operating_tenant_id'].includes(event.key || ''))
        window.location.reload();
    };
    window.addEventListener('storage', changed);
    window.addEventListener('facio:platform-logout', logout);
    return () => {
      window.removeEventListener('storage', changed);
      window.removeEventListener('facio:platform-logout', logout);
    };
  }, [logout]);
  useEffect(() => {
    const expired = () => {
      if (!localStorage.getItem('auth_token') && ready) window.location.assign('/workspaces');
    };
    window.addEventListener('facio:user_info_updated', expired);
    return () => window.removeEventListener('facio:user_info_updated', expired);
  }, [ready]);
  const login = (token: string) => {
    clearOperatingSession();
    localStorage.setItem('platform_token', token);
    setSignedIn(true);
  };
  const select = async (id: string) => {
    const selected = await platformApi.select(id);
    installSelectedTenant(selected.tenant);
    retainSelectedSession(selected);
    window.location.assign('/policies');
  };
  if (authLoading) return <Status message="Loading organization sign-in…" />;
  if (!signedIn && authConfig)
    return (
      <BrowserRouter>
        <LoginPage
          onLogin={login}
          platformMode
          organizationProviders={authConfig.providers}
          passwordLoginEnabled={authConfig.passwordLoginEnabled}
        />
      </BrowserRouter>
    );
  if (!authConfig)
    return (
      <main className="h-screen grid place-items-center p-6">
        <div className="ui-card ui-card-pad">
          <h1 className="text-2xl font-black">Sign-in options unavailable</h1>
          <p role="alert" className="mt-3">
            {error}
          </p>
          <Button
            className="mt-4 underline font-bold"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry sign-in options
          </Button>
        </div>
      </main>
    );
  if (ready)
    return (
      <>
        <div
          role="alert"
          className={
            error ? 'fixed top-0 inset-x-0 z-[100] bg-rose-50 p-4 text-rose-900' : 'hidden'
          }
        >
          {error}
        </div>
        <Suspense fallback={<Status message="Opening your insurance workspace…" />}>
          <OperatingApplication />
        </Suspense>
      </>
    );
  if (loading) return <Status message="Verifying organization and tenant access…" />;
  if (!session)
    return (
      <main className="h-screen overflow-auto grid place-items-center p-6">
        <div className="ui-card ui-card-pad max-w-xl">
          <h1 className="text-2xl font-black">Workspace access unavailable</h1>
          <p role="alert" className="mt-4 text-rose-800">
            {error}
          </p>
          <div className="flex gap-3 mt-5">
            <Button
              className="rounded-xl bg-slate-900 text-white px-5 py-3"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry access check
            </Button>
            <Button className="rounded-xl border px-5 py-3" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      </main>
    );
  return (
    <>
      <div role="status" className={error ? 'bg-amber-50 p-4 text-amber-900' : 'hidden'}>
        {error}
      </div>
      <WorkspacePicker session={session} onSelect={select} onRefresh={refresh} onLogout={logout} />
    </>
  );
}

function Status({ message }: { message: string }) {
  return (
    <main className="h-screen flex items-center justify-center p-6">
      <p role="status" className="font-bold text-slate-600">
        {message}
      </p>
    </main>
  );
}
