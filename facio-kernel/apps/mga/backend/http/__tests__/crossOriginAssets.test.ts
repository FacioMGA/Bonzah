import { describe, expect, it } from 'vitest';
import { isPublicMediaAsset } from '../crossOriginAssets';

/**
 * ABY-358 regression. Public branding media must be served with
 * `Cross-Origin-Resource-Policy: cross-origin` so external renderers (e.g. the
 * Marker.io bug-capture DOM snapshot) can load the logos instead of showing
 * broken-image placeholders. Application code (JS/CSS/JSON/source maps) must
 * keep the same-origin posture.
 */
describe('isPublicMediaAsset — cross-origin static media classifier', () => {
  it('treats branding logos and images as public media (cross-origin eligible)', () => {
    expect(isPublicMediaAsset('/path/dist/assets/branding/logo-icon.svg')).toBe(true);
    expect(isPublicMediaAsset('/path/dist/assets/branding/logo-white.png')).toBe(true);
    expect(isPublicMediaAsset('/path/dist/assets/lloyds-CcO897us.png')).toBe(true);
    expect(isPublicMediaAsset('/path/dist/assets/branding/favicon.svg')).toBe(true);
  });

  it('treats fonts as public media (cross-origin eligible)', () => {
    expect(isPublicMediaAsset('/path/dist/assets/inter-latin.woff2')).toBe(true);
    expect(isPublicMediaAsset('/path/dist/assets/icons.ttf')).toBe(true);
  });

  it('covers common raster/vector image extensions', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico']) {
      expect(isPublicMediaAsset(`/x/image.${ext}`)).toBe(true);
    }
  });

  it('does NOT relax application code or data payloads (keep same-origin)', () => {
    expect(isPublicMediaAsset('/path/dist/assets/index-Ceif57sg.js')).toBe(false);
    expect(isPublicMediaAsset('/path/dist/assets/index-Cl3Aw_xX.css')).toBe(false);
    expect(isPublicMediaAsset('/path/dist/assets/index.js.map')).toBe(false);
    expect(isPublicMediaAsset('/path/dist/manifest.json')).toBe(false);
    expect(isPublicMediaAsset('/path/dist/index.html')).toBe(false);
  });

  it('is case-insensitive and tolerant of empty input', () => {
    expect(isPublicMediaAsset('/X/LOGO.SVG')).toBe(true);
    expect(isPublicMediaAsset('/X/PHOTO.PNG')).toBe(true);
    expect(isPublicMediaAsset('')).toBe(false);
  });
});
