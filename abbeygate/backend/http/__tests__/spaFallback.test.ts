import { describe, expect, it } from 'vitest';
import { isStaticAssetPath } from '../spaFallback';

/**
 * ABBEYGATE-REACT-3 regression. Pin both axes of the static-asset
 * classifier so a future refactor cannot regress the SPA fallback to
 * serving HTML for missing chunk URLs.
 *
 * Live event reproduced this exact failure mode on iOS Safari 18.7
 * (release `4b77c56c`): user held a stale tab open across a deploy,
 * followed an internal Suspense lazy-import to
 * `/assets/index-Ceif57sg.js` (a hash that no longer existed on disk),
 * and `app.get('*')` returned `index.html` with `Content-Type:
 * text/html`. The browser's strict ESM loader threw
 * `TypeError: 'text/html' is not a valid JavaScript MIME type`.
 */
describe('isStaticAssetPath — SPA fallback static-asset classifier', () => {
  it('identifies any path under /assets/ as a static asset (Vite default output dir)', () => {
    expect(isStaticAssetPath('/assets/index-Ceif57sg.js')).toBe(true);
    expect(isStaticAssetPath('/assets/react-vendor-DgJDF8co.js')).toBe(true);
    expect(isStaticAssetPath('/assets/ui-vendor-DMZOW7HP.js')).toBe(true);
    expect(isStaticAssetPath('/assets/index-Cl3Aw_xX.css')).toBe(true);
    expect(isStaticAssetPath('/assets/logo.png')).toBe(true);
    expect(isStaticAssetPath('/assets/path/with/sub/dirs/asset.js')).toBe(true);
  });

  it('identifies bare-path requests for static-asset extensions, even outside /assets/', () => {
    expect(isStaticAssetPath('/favicon.ico')).toBe(true);
    expect(isStaticAssetPath('/robots.txt' satisfies string)).toBe(false); // .txt is NOT in the list — robots.txt is hand-served, not a fingerprinted asset
    expect(isStaticAssetPath('/manifest.json')).toBe(true);
    expect(isStaticAssetPath('/sw.js')).toBe(true);
    expect(isStaticAssetPath('/image.webp')).toBe(true);
    expect(isStaticAssetPath('/font.woff2')).toBe(true);
    expect(isStaticAssetPath('/source.map')).toBe(true);
  });

  it('does NOT classify SPA navigation paths as static assets — those must hit the index.html fallback', () => {
    // These are real client-side routes from `frontend/src/surfaces/public/router.tsx`
    // and the BO surface. They MUST resolve to `index.html` so React
    // Router can take over after hydration.
    expect(isStaticAssetPath('/')).toBe(false);
    expect(isStaticAssetPath('/quote/start')).toBe(false);
    expect(isStaticAssetPath('/quote/health/new')).toBe(false);
    expect(isStaticAssetPath('/quote/ti-FlYEPM6OdnwTcEG9ay4AT9Noflodcudl_RWoHzEs')).toBe(false); // exact path from ABBEYGATE-REACT-3
    expect(isStaticAssetPath('/policies/abc-123')).toBe(false);
    expect(isStaticAssetPath('/login')).toBe(false);
    expect(isStaticAssetPath('/client/dashboard')).toBe(false);
  });

  it('does NOT classify deep BO paths that happen to contain a dot in a query/segment', () => {
    // Path-without-extension cases — these are SPA routes, not assets.
    expect(isStaticAssetPath('/admin/release-notes-2026.05.25')).toBe(false);
    expect(isStaticAssetPath('/quote/v1.2.3-beta')).toBe(false);
  });

  it('handles defensive inputs without throwing', () => {
    expect(isStaticAssetPath('')).toBe(false);
    // The express `req.path` is always a non-empty string starting
    // with '/', so we don't accept null/undefined; but guard against
    // the empty string just in case.
  });
});
