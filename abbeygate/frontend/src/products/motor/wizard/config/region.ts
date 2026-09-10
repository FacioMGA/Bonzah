import { getOperatingCountryFromHost, getOperatingCountryName } from '@/src/shared/lib/tenant/operatingCountry';

// Country / registration defaults follow the operating tenant host
// (e.g. Portugal on abbeygate-pt.facio.io), not a hardcoded Cyprus.
// Host-unknown contexts (dev, tests) fall back to Cyprus.
const hostRegionCode = getOperatingCountryFromHost();
const hostCountryName = getOperatingCountryName();

export const REGION_CONFIG = {
    defaultCountry: hostCountryName ?? 'Cyprus',
    defaultRegionCode: hostRegionCode ?? 'CY',
    priorityCountries: ['Cyprus', 'Portugal', 'Spain', 'United Kingdom'],
    // Comprehensive list (truncated for MVP, typically would be larger)
    otherCountries: ['France', 'Germany', 'Greece', 'Ireland', 'Italy', 'Malta', 'Netherlands', 'Poland', 'Sweden'],
    // Canonical Nationality contract — country name, not a demonym.
    defaultNationality: 'United Kingdom',
    defaultLicenseIssuedIn: 'United Kingdom'
};
