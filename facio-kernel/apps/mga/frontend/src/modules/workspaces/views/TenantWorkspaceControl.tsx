import { Button } from '@/src/shared/ui';
import React from 'react';
import { Link } from 'react-router-dom';
import { useOperatingTenant } from '@/src/shared/lib/tenant/TenantBrand';

export function TenantWorkspaceControl({ compact = false }: { compact?: boolean }) {
  const tenant = useOperatingTenant();
  if (!tenant) return null;
  const switchWorkspace = () => {
    if (
      window.confirm(
        'Change workspace? Save unfinished changes first. This closes the current page and reloads the selected tenant.',
      )
    )
      window.location.assign('/workspaces');
  };
  return (
    <div className={'flex min-w-0 items-center gap-3 ' + (compact ? 'text-xs' : 'text-sm')}>
      <div className="min-w-0">
        <p className="font-black truncate max-w-[220px]" title={tenant.displayName}>
          {tenant.displayName || tenant.profile.runtimeSettings?.branding.displayName}
        </p>
        {!compact && (
          <p className="text-xs text-slate-500">
            {tenant.profile.countryCode} · {tenant.profile.currency} · {tenant.role}
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="secondary"
        onClick={switchWorkspace}
        className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 font-bold hover:bg-slate-50"
      >
        Switch workspace
      </Button>
      {!compact && (
        <Link
          className="shrink-0 text-slate-600 underline underline-offset-4"
          to="/configure/tenant-profile"
        >
          Tenant profile
        </Link>
      )}
    </div>
  );
}
