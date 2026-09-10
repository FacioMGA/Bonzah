import React, { useEffect, useState } from 'react';
import { installSelectedTenant, type SelectedTenant, type TenantProfile } from '@/src/shared/lib/tenant/runtimeProfile';

type PublicTenantResponse = TenantProfile & {
  id: string;
  tenantSlug: string;
  displayName: string;
};

function requestedWorkspaceSlug(): string {
  const params = new URLSearchParams(window.location.search);
  return String(params.get('workspace') || '').trim().toLowerCase();
}

/**
 * Resolves the public journey tenant without requiring a back-office login.
 * The server still owns the slug-to-tenant mapping and every subsequent API
 * request is scoped by the resolved tenant middleware.
 */
export function PublicSurfaceBootstrap({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<SelectedTenant | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const workspace = requestedWorkspaceSlug();
    const headers = workspace ? { 'X-Tenant-Slug': workspace } : undefined;
    void fetch('/api/tenant/resolve', { headers, signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as PublicTenantResponse | null;
        if (!response.ok || !body?.id || !body.tenantSlug || !body.runtimeSettings) {
          throw new Error('This quote link is not connected to an active insurance workspace.');
        }
        const selected: SelectedTenant = {
          id: body.id,
          tenantSlug: body.tenantSlug,
          displayName: body.displayName,
          role: 'PUBLIC',
          accountScopeId: body.id,
          profile: body,
        };
        installSelectedTenant(selected);
        setTenant(selected);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(failure instanceof Error ? failure.message : 'The insurance workspace could not be opened.');
      });
    return () => controller.abort();
  }, []);

  if (tenant) return <>{children}</>;
  return (
    <main className="min-h-screen grid place-items-center bg-[#fff8fb] p-6">
      <section className="w-full max-w-lg rounded-3xl border border-[#f2d7e5] bg-white p-8 text-center shadow-xl">
        <h1 className="text-2xl font-black text-[#1d1e29]">Bonzah rental protection</h1>
        {error ? <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p> : <p role="status" className="mt-3 text-sm text-slate-600">Opening your secure quote…</p>}
      </section>
    </main>
  );
}
