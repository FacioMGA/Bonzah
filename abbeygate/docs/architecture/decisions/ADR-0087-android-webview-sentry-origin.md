---
title: ADR-0087 Android WebView Sentry origin
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-28
binding: true
---

# ADR-0087: Android WebView Sentry origin

## Decision

`initFrontendSentry` may drop only the exact `Error invoking <method>: Java
object is gone` event when its captured stack contains
`navigation_performance_logger_android`. This injected Facebook/Instagram
Android WebView script is the error origin. Sentry adding Abbeygate's global
capture frame does not change that provenance.

All first-party-only events, different messages, and bridge events without the
injected origin remain reportable. The canonical decision point remains
`shouldSuppressAndroidWebViewBridgeSentryReport`; no UI/browser workaround or
second Sentry filter is permitted.

## Consequences

The known third-party teardown noise no longer opens customer-impact alerts.
The match remains narrow and regression-tested against the live mixed-stack
event from ABY-491, preserving visibility of actual Abbeygate failures.
