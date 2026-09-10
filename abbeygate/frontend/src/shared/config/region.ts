// Region defaults are read directly from `import.meta.env` — typed via the
// canonical `ImportMetaEnv` augmentation at
// `frontend/src/shared/types/vite-sentry-env.d.ts`. The previous
// laundered cast that re-shaped `import.meta` into a nested record of
// records existed only because the LLM that wrote it didn't trust
// Vite's typing; with every key declared in `ImportMetaEnv`, dot-access
// is type-safe and no laundering is needed.
import { getOperatingCountryFromHost, getOperatingCountryName } from '@/src/shared/lib/tenant/operatingCountry';

function envStr(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

// The operating tenant is the authoritative source for the country a
// customer is quoting in: on `abbeygate-pt.facio.io` the wizard must
// default to Portugal, not Cyprus. We derive it from the browser host
// (the only tenant signal available client-side — see
// `operatingCountry.ts`). When the host is unknown (localhost dev,
// preview deploys, unit tests) we fall back to the build-time env, and
// finally to Cyprus as the historical dev default. We deliberately do
// NOT bake a Cyprus default into a production tenant host.
const hostRegionCode = getOperatingCountryFromHost();
const hostCountryName = getOperatingCountryName();

export const REGION_CONFIG = {
  defaultCountry: hostCountryName ?? envStr(import.meta.env.VITE_DEFAULT_COUNTRY, 'Cyprus'),
  defaultRegionCode: hostRegionCode ?? envStr(import.meta.env.VITE_DEFAULT_REGION_CODE, 'CY'),
  defaultCurrency: envStr(import.meta.env.VITE_DEFAULT_CURRENCY, 'EUR'),
  // Canonical Nationality contract (`@facio/validation` →
  // `NATIONALITY_OPTIONS`) requires a country name, not a demonym. The
  // env override MUST also be a canonical country name; the consistency
  // guard would flag a `'British'` default at CI time. Nationality is
  // NOT host-derived: the expat customer base is predominantly British
  // regardless of which jurisdiction they are quoting in.
  defaultNationality: envStr(import.meta.env.VITE_DEFAULT_NATIONALITY, 'United Kingdom'),
  defaultPhoneRegionCode: hostRegionCode ?? envStr(import.meta.env.VITE_DEFAULT_PHONE_REGION_CODE, 'CY'),
  priorityCountries: envStr(import.meta.env.VITE_PRIORITY_COUNTRIES, 'Cyprus,Portugal,Spain,United Kingdom').split(',').map(s => s.trim()),
} as const;
