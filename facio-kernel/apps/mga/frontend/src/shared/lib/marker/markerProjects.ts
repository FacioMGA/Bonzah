/**
 * A country is not a feedback destination. No tenant-specific Marker integration
 * is registered by the platform contract yet, so the widget remains disabled.
 * The legacy function signature is retained for existing surface callers.
 */
export function getMarkerProjectForHost(_hostname?: string): string | null {
  return null;
}
