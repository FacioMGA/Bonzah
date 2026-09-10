---
title: ADR-0045 Public media assets use Cross-Origin-Resource-Policy cross-origin
audience: architect
status: living
owner: platform-eng
reviewed: 2026-06-24
binding: true
---

# ADR-0045: Serve public branding media with `Cross-Origin-Resource-Policy: cross-origin`

## Status

Accepted.

## Context

The global Helmet middleware (`backend/index.ts`) applies its default
`Cross-Origin-Resource-Policy: same-origin` (CORP) to every response. CORP
`same-origin` instructs the browser to refuse loading the resource from any
document whose origin differs from the resource's origin.

This is the correct posture for application code and data (JS, CSS, JSON, source
maps) and the API. It is wrong for public branding media. The wizard header
logo (`/assets/branding/logo-icon.svg`) and the Lloyd's mark are public,
non-sensitive, fingerprinted files.

ABY-358 reported the logos rendering as broken-image placeholders in Marker.io
bug-capture screenshots on mobile. Investigation (WebKit, the Safari engine, at
the reported iPhone viewport) confirmed:

- The asset serves a clean `200 image/svg+xml`; SPA and assets are same-origin.
- Same-origin load in WebKit renders the SVG (`naturalWidth=119`).
- Cross-origin load is blocked **solely** by `Cross-Origin-Resource-Policy: same-origin` (`naturalWidth=0`).

Real users (same-origin) are unaffected. But Marker.io renders a serialized DOM
snapshot from its own origin, so CORP `same-origin` blocks the images and every
captured report shows broken logos — degrading the bug-reporting workflow the
team relies on. The same block affects any legitimate cross-origin embedder of
the public brand assets.

## Decision

Public media assets (images and fonts) are served with
`Cross-Origin-Resource-Policy: cross-origin`. The scope is a single predicate,
`isPublicMediaAsset` (`backend/http/crossOriginAssets.ts`), matched in the
`express.static` `setHeaders` hook. It covers `png jpg jpeg gif webp avif svg ico
woff woff2 ttf otf eot` only.

Application code and data keep the global `same-origin` posture. CORP is **not**
relaxed for JS, CSS, JSON, source maps, the API, or the HTML app shell.

## Consequences

- Marker.io snapshots and other cross-origin embedders can load the public logos/media.
- No sensitive surface is exposed: these files are already publicly downloadable; CORP only governs which documents may embed them.
- Same-origin posture for application code (SD-002 family) is preserved.
- Pinned by `backend/http/__tests__/crossOriginAssets.test.ts` (media eligible; JS/CSS/JSON/HTML not).
