import markerSDK, { type MarkerSdk } from '@marker.io/browser';

import { getMarkerProjectForHost } from '@/src/shared/lib/marker/markerProjects';

// The widget is a singleton per loaded app bundle. `initMarkerIo` runs from a
// mount effect on every surface, so we memoise the in-flight/loaded widget to
// avoid loading it more than once. On failure we clear the handle so a later
// route/surface mount can retry.
let widgetPromise: Promise<MarkerSdk> | null = null;

/**
 * Loads the Marker.io feedback widget for the current territory using the
 * official `@marker.io/browser` SDK.
 *
 * The project is resolved at runtime from the browser host (see
 * `markerProjects.ts`); a non-territory host returns no project and the widget
 * is not loaded. This is the vendor-recommended install method — typed,
 * versioned, and it hands back a widget instance for programmatic control.
 */
export function initMarkerIo(): void {
  const markerEnabledOverride = String(import.meta.env.VITE_ENABLE_MARKER || '').trim().toLowerCase();
  const markerEnabled = markerEnabledOverride === 'true' || (!import.meta.env.DEV && markerEnabledOverride !== 'false');
  if (!markerEnabled) return;

  const project = getMarkerProjectForHost();
  if (!project) return;

  if (widgetPromise) return;

  widgetPromise = markerSDK.loadWidget({ project, source: 'snippet' });
  widgetPromise.catch(() => {
    widgetPromise = null;
  });
}
