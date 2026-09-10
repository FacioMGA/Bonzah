---
title: Observability Telemetry Review 2026-03 (frozen)
status: archived
owner: platform-eng
binding: false
---

> **Frozen-on:** 2026-05-03
> **Replaced by:** [`docs/operate/monitoring.md`](../../operate/monitoring.md) and [`docs/architecture/contracts/events-and-projections.md`](../../architecture/contracts/events-and-projections.md)
> **Reason:** Historical review captures the App Insights vs OTel decision frame. Kept for evidence; not current guidance.

# Observability Telemetry Review (2026-03)

Purpose: capture the current state and decision frame for `applicationinsights` and OpenTelemetry coexistence.

## Current state (evidence)

- `applicationinsights` is actively used in:
  - `backend/platform/observability/appInsights.ts`
  - `backend/index.ts`
  - `backend/worker.ts`
- OTel baseline currently shows `applicationinsights` as the dominant source of `@opentelemetry/*` packages:
  - `docs/architecture/baselines/otel-dependency-baseline.md`

## What this means

- `applicationinsights` is not safe to remove right now (active runtime wiring).
- Active usage does not automatically imply architectural necessity.
- There is a meaningful review question: intentional coexistence vs transitional/double telemetry.

## Open questions to resolve

1. Is coexistence intentional?
   - Are we explicitly relying on Azure SDK behavior that bundles OTel under Application Insights?
2. Is there duplicate telemetry?
   - Are the same requests/dependencies/exceptions exported twice through overlapping pipelines?
3. What is the target operating model?
   - Keep AI SDK as authoritative telemetry path, or
   - move toward direct OTel SDK + exporter model.

## Decision checklist

- Define target telemetry architecture for API and worker.
- Document accepted duplication (if any) and why.
- Add/adjust dashboards and alert semantics if export path changes.
- Plan migration/deprecation only after replacement evidence exists.

## Decision status

- Current recommendation: **keep `applicationinsights` for now**, schedule architecture review, no removal in cleanup PRs.
