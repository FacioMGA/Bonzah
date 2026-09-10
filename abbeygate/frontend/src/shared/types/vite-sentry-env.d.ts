// Canonical augmentation for Vite's `ImportMeta.env` (single source of truth
// for every `VITE_*` key referenced via `import.meta.env`). Vite's stock
// `ImportMetaEnv` ships with a permissive string-keyed index signature whose
// value type resolves to the unsafe top type, so an unlisted key returns
// that top type at the call site — that's what made the laundered cast in
// `shared/config/region.ts` look necessary. Listing every key we use here
// lets `import.meta.env.VITE_X` resolve to a precise type.
interface ImportMetaEnv {
  // Sentry / observability
  readonly VITE_API_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_RELEASE?: string;
  readonly VITE_SENTRY_ERROR_SAMPLE_RATE?: string;
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
  readonly VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE?: string;
  readonly VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE?: string;
  readonly VITE_SENTRY_SEND_DEFAULT_PII?: string;
  // Region defaults (consumed by frontend/src/shared/config/region.ts)
  readonly VITE_DEFAULT_COUNTRY?: string;
  readonly VITE_DEFAULT_REGION_CODE?: string;
  readonly VITE_DEFAULT_CURRENCY?: string;
  readonly VITE_DEFAULT_NATIONALITY?: string;
  readonly VITE_DEFAULT_PHONE_REGION_CODE?: string;
  readonly VITE_PRIORITY_COUNTRIES?: string;
  // Logging
  readonly VITE_LOG_LEVEL?: string;
  // Feature flags
  readonly VITE_USE_POLICY_STATE?: string;
  // Third-party integrations
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_ENABLE_MARKER?: string;
}
