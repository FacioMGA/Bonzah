import React, { useState, useSyncExternalStore } from 'react';
import { getSelectedTenant, safeBrandUrl, subscribeTenant } from './runtimeProfile';

export function useOperatingTenant() {
  return useSyncExternalStore(subscribeTenant, getSelectedTenant, () => null);
}

export function TenantBrand({
  inverse = false,
  className = '',
}: {
  inverse?: boolean;
  className?: string;
}) {
  const tenant = useOperatingTenant();
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const name =
    tenant?.profile.runtimeSettings?.branding.displayName ||
    tenant?.displayName ||
    'Facio Platform';
  const logo = safeBrandUrl(
    inverse ? tenant?.profile.brandLogo.white : tenant?.profile.brandLogo.blue,
  );
  return logo && failedLogo !== logo ? (
    <img
      onError={() => setFailedLogo(logo)}
      src={logo}
      alt={name}
      className={'max-w-full object-contain ' + className}
    />
  ) : (
    <span
      className={
        'font-black tracking-tight text-xl break-words ' +
        (inverse ? 'text-white ' : 'text-slate-900 ') +
        className
      }
    >
      {name}
    </span>
  );
}
