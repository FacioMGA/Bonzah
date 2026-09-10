/**
 * SPA fallback path classifier.
 *
 * The production express app at `backend/index.ts` mounts
 * `express.static(frontendPath)` followed by a catch-all
 * `app.get('*')` that serves `index.html` for client-side routing.
 * The catch-all must NOT serve `index.html` for requests that look
 * like fingerprinted static-asset URLs — when the asset is missing
 * (e.g. a stale chunk hash from a previous release that no longer
 * exists on disk after a deploy), serving the SPA shell back with
 * `Content-Type: text/html` makes the browser's strict ESM loader
 * reject the response with `TypeError: 'text/html' is not a valid
 * JavaScript MIME type` (Sentry: ABBEYGATE-REACT-3, first surfaced
 * on iOS Safari 18.7).
 *
 * `isStaticAssetPath(p)` is the single source of truth for "this
 * looks like a fingerprinted static asset; if static middleware
 * could not serve it, return 404 instead of falling through to the
 * SPA shell." Pinned by `__tests__/spaFallback.test.ts`.
 */

const FINGERPRINTED_ASSET_PATH = /^\/assets\//;
const STATIC_ASSET_EXTENSION = /\.(?:js|mjs|cjs|css|map|json|woff2?|ttf|otf|eot|png|jpg|jpeg|gif|webp|avif|svg|ico)$/i;

export function isStaticAssetPath(path: string): boolean {
  if (!path) return false;
  return FINGERPRINTED_ASSET_PATH.test(path) || STATIC_ASSET_EXTENSION.test(path);
}
