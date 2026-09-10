import { getOperatingCountryFromHost } from '@/src/shared/lib/tenant/operatingCountry';

/**
 * Per-territory Marker.io projects.
 *
 * The public build is one artifact served across every territory host
 * (`cy/pt/gr.abbeygate.com`, the `*.staging.abbeygate.com` mirrors and the
 * legacy `abbeygate-*.facio.io` hosts), so the project cannot be chosen at
 * build time. We resolve it at runtime from the browser host, reusing the
 * canonical host→country resolver in `operatingCountry.ts` so there is a
 * single owner of the host map.
 *
 * Fill each value with the `project` id from that territory's Marker.io
 * install snippet (Marker.io dashboard → the territory's project → Install →
 * the `project` value in `window.markerConfig`). An empty string means "no
 * project for this territory yet" → the widget stays disabled there. Per
 * `no-defensive-fallbacks` there is deliberately NO shared catch-all project:
 * an unknown or unconfigured territory shows no widget rather than routing
 * feedback to the wrong project.
 */
const MARKER_PROJECT_BY_COUNTRY: Record<string, string> = {
  CY: '6a5a7850f723addd97c777ce',
  PT: '6a5a786bb6bdc4d78040331d',
  GR: '6a5a788007e446f4a3cde575',
};

/**
 * Returns the Marker.io project id for the current browser host, or `null`
 * when the host is not a configured territory (localhost dev, preview
 * deploys, ES which has no online route yet, or a territory whose project id
 * has not been filled in above). Callers MUST treat `null` as "do not load
 * the widget".
 */
export function getMarkerProjectForHost(hostname?: string): string | null {
  const country = getOperatingCountryFromHost(hostname);
  if (!country) return null;
  const project = (MARKER_PROJECT_BY_COUNTRY[country] ?? '').trim();
  return project ? project : null;
}
