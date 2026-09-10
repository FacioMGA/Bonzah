import { getSelectedTenant } from './runtimeProfile';

/** Legacy function name retained for callers. Hostnames never select an operating tenant. */
export function getOperatingCountryFromHost(_hostname?: string): string | null {
  return getSelectedTenant()?.profile.countryCode || null;
}
export function getOperatingCountryName(_hostname?: string): string | null {
  return getSelectedTenant()?.profile.country || null;
}
