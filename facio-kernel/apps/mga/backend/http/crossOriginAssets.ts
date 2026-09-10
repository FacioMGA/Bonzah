/**
 * Cross-origin eligibility for public media assets.
 *
 * The global Helmet posture (backend/index.ts) applies the default
 * `Cross-Origin-Resource-Policy: same-origin` to every response, which is the
 * correct stance for application code (JS/CSS/JSON/source maps) and the API.
 *
 * Public branding media — logos, images, fonts — are non-sensitive, public,
 * fingerprinted files that legitimately need to load from a cross-origin
 * context. In particular the Marker.io bug-capture tool renders a serialized
 * DOM snapshot from its own origin; with `same-origin` CORP the browser refuses
 * to load these images and every captured screenshot shows broken-image
 * placeholders instead of the real logos (ABY-358).
 *
 * This predicate is the single source of truth for "serve this static file with
 * `Cross-Origin-Resource-Policy: cross-origin`". It is deliberately scoped to
 * media/font extensions so the same-origin posture of application code is
 * preserved.
 */
const PUBLIC_MEDIA_ASSET = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot)$/i;

export function isPublicMediaAsset(filePath: string): boolean {
  return PUBLIC_MEDIA_ASSET.test(String(filePath || ''));
}
