import { getSelectedTenant } from '@/src/shared/lib/tenant/runtimeProfile';

/** Presentation defaults from the resolved tenant. An unanswered field remains empty. */
export const REGION_CONFIG = {
  get defaultCountry(): string {
    return getSelectedTenant()?.profile.country || '';
  },
  get defaultRegionCode(): string {
    return getSelectedTenant()?.profile.countryCode || '';
  },
  get defaultCurrency(): string {
    return getSelectedTenant()?.profile.currency || '';
  },
  get defaultNationality(): string {
    return getSelectedTenant()?.profile.defaultNationality || '';
  },
  get defaultPhoneRegionCode(): string {
    return getSelectedTenant()?.profile.countryCode || '';
  },
  get priorityCountries(): string[] {
    return getSelectedTenant()?.profile.priorityCountries || [];
  },
};
