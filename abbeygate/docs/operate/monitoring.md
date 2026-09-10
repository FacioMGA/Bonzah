---
title: Monitoring
audience: operator
status: living
owner: platform-eng
reviewed: 2026-05-04
binding: false
supersedes:
  - docs/performance/MONITORING.md
---

# Monitoring

## APM
Azure Application Insights — request/response, dependency tracking (DB, Redis, external HTTP), exception telemetry, custom metrics via `performanceTracking` middleware. Config: `backend/platform/observability/appInsights.ts`.

Sentry — issue triage for API, worker, and Vite frontend errors. Both DSNs are **required** in the `production-aks` GH Environment: backend `SENTRY_DSN` is upserted into the K8s runtime secret by `aks-deploy.yml` on every deploy and required by Helm `secretKeys.SENTRY_DSN` (pod fails-fast at boot if absent — see `backend/platform/observability/instrument.ts`, loaded via `node --import` so OTel auto-instrumentation patches express/prisma/ioredis); frontend `VITE_SENTRY_DSN` is baked into the bundle by `azure-images.yml`. Optional `SENTRY_ORG` · `SENTRY_PROJECT` · `SENTRY_AUTH_TOKEN` enable sourcemap upload. Background errors (BullMQ workers, Redis EPIPE storms, suppressed uncaughtExceptions) reach Sentry via `captureBackgroundException` (60s per-fingerprint rate limit, dropped count attached as `extra.droppedSinceLastSend`). Verify wiring end-to-end: `curl -X POST -H "X-Sentry-Smoke-Token: $SENTRY_SMOKE_TOKEN" "https://<host>/api/__debug/sentry-smoke?type=express"` (or `manual`/`background`) returns a marker that appears in Sentry within 30s. `curl https://<host>/health/sentry` returns `{ initialized: true, dsnHost }`; frontend `window.__SENTRY_BOOT__` in DevTools shows the same. `/health/integrations` reports `degraded` in prod when DSN is absent. Linear issue creation is managed from the Sentry alert workflow after the Linear integration is installed.

## Server-side
| Signal | Tool | Source |
|---|---|---|
| Request timing | `Server-Timing` header | `backend/http/middleware/perfTiming.ts` |
| Slow queries | Prisma query log | `backend/platform/db/connection.ts` |
| Worker jobs | BullMQ dashboard metrics | `backend/platform/events/queue.ts` |
| Audit trail | DB-backed audit log | `backend/platform/audit/feed.ts` |
| Structured logs | Pino JSON (prod), pretty (dev) | `backend/platform/utils/logger.ts` |
| Cash Sheet lifecycle label | `PolicyListIndex` dates through canonical `resolveLifecycleStatus` | `backend/modules/reporting/app/boOperationalReports.ts` |

Canonical log keys + alert thresholds: [contracts/events-and-projections.md](../architecture/contracts/events-and-projections.md).

## Issuance Proof
`proof:issuance-spine` creates synthetic Motor, Home, and Travel policies, runs the canonical `DOC.GENERATE_ISSUED_POLICY_PACK` worker path, verifies every required PDF row, then delivers the queued welcome email through the communications worker.

Production Helm runs `abbeygate-issuance-proof` as a `*/10 * * * *` CronJob. The two proof mailboxes are split in the runtime secret so no human is spammed: `ISSUANCE_PROOF_WELCOME_TO` points at a non-human sub-address (absorbs the routine synthetic welcome emails) and only `ISSUANCE_PROOF_ALERT_TO` — a human inbox — receives the `CRITICAL … proof failed` alert. Both keys must be set before enabling the CronJob.

The issued-pack worker normally also fans a copy of the welcome email to the internal staff mailboxes (`onlinePolicyConfirmationCopyEmailsForCountry`, e.g. CY = Danny+Peter+Theo `@abbeygate.cy`) on every sale. Synthetic runs carry `source: 'ISSUANCE_PROOF'`, and `maybeSendWelcomeEmailForIssuedPack` **suppresses that internal staff copy for synthetic runs** (logged as `email.welcome.internal_copy.suppressed_synthetic`) so the canary never lands a fake "policy issued" in a staff inbox. Real issuances are unaffected.

Synthetic emails (issuance-proof welcome, Preview Centre "send test") are stamped with a `[SYNTHETIC TEST — NOT A REAL POLICY]` subject prefix + red body banner, and the transport fail-closes on a recipient allowlist (`syntheticRecipientAllowlist.ts`): only `SYNTHETIC_EMAIL_ALLOWLIST` entries plus the non-human `ISSUANCE_PROOF_WELCOME_TO` are deliverable — never the human `ISSUANCE_PROOF_ALERT_TO`. A blocked synthetic send fails with `SYNTHETIC_RECIPIENT_NOT_ALLOWLISTED`; check `SYNTHETIC_EMAIL_ALLOWLIST` in the runtime secret.

## Frontend
| Signal | Tool | Status |
|---|---|---|
| Bundle size | `tools/quality/perf/check-budgets.mjs` | Active in CI |
| Lighthouse CI | `tools/quality/perf/run-lhci.mjs` | On-demand (`node tools/quality/perf/run-lhci.mjs`; not wired into the reusable quality gate) |
| Bundle analysis | `rollup-plugin-visualizer` | On-demand (`ANALYZE=true`) |
| Error/session triage | Sentry browser SDK | Active when `VITE_SENTRY_DSN` is set |
| Core Web Vitals (RUM) | — | Planned |

## Caching
| Layer | Scope | TTL | Source |
|---|---|---|---|
| Auth user | Per-process | 60 s | `backend/http/middleware/auth.ts` |
| Webhook replay guard | Redis + fallback | Event-based | `backend/platform/security/webhookReplayGuard.ts` |
| Vehicle API | Browser | Session | `frontend/.../wizard/services/vehicleApi.ts` |
At API bootstrap, BullMQ and the general-purpose Redis client are warmed concurrently before the outbox relay/workers begin; check `redis.client.startup_retry` and `redis.client.ready` after Azure Cache incidents.

## Links
- Budgets: [../architecture/contracts/performance-budgets.md](../architecture/contracts/performance-budgets.md)
- Indexes: [../architecture/contracts/database-indexes.md](../architecture/contracts/database-indexes.md)
- Incidents: [incident-response.md](./incident-response.md)
