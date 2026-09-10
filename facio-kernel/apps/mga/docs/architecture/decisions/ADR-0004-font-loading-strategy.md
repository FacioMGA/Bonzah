---
title: ADR-0004 Font loading strategy
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

## ADR-0004: Font loading strategy (Inter)

### Status
Accepted

### Context
CSS `@import` of Google Fonts adds latency and can block rendering. We want faster first paint while keeping behavior predictable in production.

### Decision
- Load Inter via `<link rel="stylesheet">` in `index.html`.
- Add `preconnect` hints for `fonts.googleapis.com` and `fonts.gstatic.com`.
- Update production CSP to allow those domains for styles/fonts.

### Consequences
- Faster font availability and less render blocking.
- Requires CSP allowlist maintenance.
